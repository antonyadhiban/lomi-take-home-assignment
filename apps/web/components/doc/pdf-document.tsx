"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { VALUE_META } from "@/components/app/status";
import { displayStatus, fieldLabel } from "@/lib/format";
import type { Value } from "@/lib/types";

import type * as PdfJsModule from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";

type PdfJs = typeof PdfJsModule;

interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

interface PageModel {
  width: number;
  height: number;
  /** page text rebuilt from pdf.js items (same engine the worker parsed with) */
  text: string;
  /** for each char of `text`: index of its item, or -1 for separators */
  charItem: Int32Array;
  /** offset of each char inside its item */
  charOffset: Int32Array;
  items: TextItem[];
  /** PDF user space -> CSS px at scale 1 */
  toViewport: (x: number, y: number) => [number, number];
}

interface Box {
  valueId: string;
  page: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfJs() {
  pdfjsPromise ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    return m;
  });
  return pdfjsPromise;
}

function buildPage(items: TextItem[], viewport: { width: number; height: number; convertToViewportPoint: (x: number, y: number) => number[] }): PageModel {
  let text = "";
  const ci: number[] = [];
  const co: number[] = [];
  items.forEach((it, idx) => {
    for (let k = 0; k < it.str.length; k++) {
      text += it.str[k];
      ci.push(idx);
      co.push(k);
    }
    const sep = it.hasEOL ? "\n" : " ";
    text += sep;
    ci.push(-1);
    co.push(-1);
  });
  return {
    width: viewport.width,
    height: viewport.height,
    text,
    charItem: Int32Array.from(ci),
    charOffset: Int32Array.from(co),
    items,
    toViewport: (x, y) => viewport.convertToViewportPoint(x, y) as [number, number],
  };
}

/** Boxes (CSS px at scale 1) covering the characters of each value's evidence. */
function locateBoxes(pages: PageModel[], values: Value[]): Box[] {
  const boxes: Box[] = [];
  for (const v of values) {
    if (!v.evidence) continue;
    const words = v.evidence.trim().split(/\s+/).filter(Boolean).map(escape);
    if (!words.length) continue;
    const re = new RegExp(words.join("\\s*"));
    for (let p = 0; p < pages.length; p++) {
      const page = pages[p]!;
      const m = re.exec(page.text);
      if (!m) continue;
      // group matched chars by item, then one rectangle per item slice
      const slices = new Map<number, [number, number]>();
      for (let c = m.index; c < m.index + m[0].length; c++) {
        const item = page.charItem[c]!;
        if (item < 0) continue;
        const off = page.charOffset[c]!;
        const s = slices.get(item);
        slices.set(item, s ? [Math.min(s[0], off), Math.max(s[1], off + 1)] : [off, off + 1]);
      }
      for (const [idx, [a, b]] of slices) {
        const it = page.items[idx]!;
        const [, , , d, e, f] = it.transform as [number, number, number, number, number, number];
        const fontH = it.height || Math.abs(d) || 10;
        const len = Math.max(1, it.str.length);
        const x0 = e + (a / len) * it.width;
        const x1 = e + (b / len) * it.width;
        const [vx0, vy0] = page.toViewport(x0, f + fontH * 0.92);
        const [vx1, vy1] = page.toViewport(x1, f - fontH * 0.28);
        boxes.push({
          valueId: v.id,
          page: p,
          left: Math.min(vx0, vx1),
          top: Math.min(vy0, vy1),
          width: Math.abs(vx1 - vx0),
          height: Math.abs(vy1 - vy0),
        });
      }
      break; // first page with a match wins
    }
  }
  return mergeLines(boxes);
}

/** pdf.js often splits one line into several items ("Total Due:" + "$6,126.45"): one box per line per field. */
function mergeLines(boxes: Box[]): Box[] {
  const out: Box[] = [];
  for (const b of boxes) {
    const same = out.find(
      (o) =>
        o.valueId === b.valueId &&
        o.page === b.page &&
        Math.min(o.top + o.height, b.top + b.height) - Math.max(o.top, b.top) > Math.min(o.height, b.height) * 0.5,
    );
    if (!same) {
      out.push({ ...b });
      continue;
    }
    const left = Math.min(same.left, b.left);
    const top = Math.min(same.top, b.top);
    same.width = Math.max(same.left + same.width, b.left + b.width) - left;
    same.height = Math.max(same.top + same.height, b.top + b.height) - top;
    same.left = left;
    same.top = top;
  }
  return out;
}

/**
 * The original PDF, rendered with pdf.js, with a box over each field's
 * evidence in its review-state colour. Hover previews, click pins.
 */
export function PdfDocument({
  url,
  values,
  focusedId,
  onHover,
  onSelect,
}: {
  url: string;
  values: Value[];
  focusedId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const boxRefs = useRef(new Map<string, HTMLElement>());
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PageModel[]>([]);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // load the document + every page's text layout once per URL
  useEffect(() => {
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | null = null;
    setDoc(null);
    setPages([]);
    setError(null);
    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        const loadingTask = pdfjs.getDocument({ url });
        task = loadingTask;
        const loaded = await loadingTask.promise;
        const models: PageModel[] = [];
        for (let i = 1; i <= loaded.numPages; i++) {
          const page = await loaded.getPage(i);
          const viewport = page.getViewport({ scale: 1 });
          const content = await page.getTextContent();
          models.push(buildPage(content.items.filter((x): x is TextItem & typeof x => "str" in x) as TextItem[], viewport));
        }
        if (cancelled) return;
        setDoc(loaded);
        setPages(models);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [url]);

  // fit the page to the canvas column
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.min(820, Math.floor(entry!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = pages[0] && width ? width / pages[0].width : 1;

  // render pages to canvas at device pixel ratio
  useEffect(() => {
    if (!doc || !width) return;
    let cancelled = false;
    const tasks: { cancel: () => void }[] = [];
    (async () => {
      for (let i = 0; i < pages.length; i++) {
        const canvas = canvasRefs.current[i];
        if (!canvas || cancelled) continue;
        const page = await doc.getPage(i + 1);
        const viewport = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const task = page.render({ canvas, viewport });
        tasks.push(task);
        await task.promise.catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
      tasks.forEach((t) => t.cancel());
    };
  }, [doc, pages, width, scale]);

  const boxes = useMemo(() => locateBoxes(pages, values), [pages, values]);
  const byId = useMemo(() => new Map(values.map((v) => [v.id, v])), [values]);

  useEffect(() => {
    if (focusedId) boxRefs.current.get(focusedId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedId]);

  return (
    <div ref={containerRef} className="mx-auto w-full max-w-[820px]">
      {error && <div className="border bg-paper px-6 py-16 text-center text-sm text-gap">Couldn&apos;t render the PDF: {error}</div>}
      {!error && !pages.length && (
        <div className="flex items-center justify-center gap-2 border bg-paper px-6 py-24 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Rendering PDF…
        </div>
      )}
      <div className="space-y-4">
        {pages.map((p, i) => (
          <div
            key={i}
            className="relative mx-auto bg-white shadow-[0_1px_0_0_var(--border),0_12px_32px_-16px_rgb(0_0_0/0.25)]"
            style={{ width: p.width * scale, height: p.height * scale }}
          >
            <canvas ref={(el) => { canvasRefs.current[i] = el; }} className="absolute inset-0 h-full w-full" />
            {boxes
              .filter((b) => b.page === i)
              .map((b, k) => {
                const v = byId.get(b.valueId)!;
                const meta = VALUE_META[displayStatus(v)];
                return (
                  <span
                    key={`${b.valueId}-${k}`}
                    ref={(el) => {
                      if (el && !boxRefs.current.has(v.id)) boxRefs.current.set(v.id, el);
                      if (!el) boxRefs.current.delete(v.id);
                    }}
                    className="evidence-box"
                    style={{
                      ["--hl" as string]: meta.hl,
                      left: b.left * scale - 3,
                      top: b.top * scale - 2,
                      width: b.width * scale + 6,
                      height: b.height * scale + 4,
                    }}
                    data-active={focusedId === v.id}
                    data-dim={focusedId != null && focusedId !== v.id}
                    title={`${fieldLabel(v.field)} · ${meta.label}`}
                    onMouseEnter={() => onHover(v.id)}
                    onMouseLeave={() => onHover(null)}
                    onClick={() => onSelect(v.id)}
                  />
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}
