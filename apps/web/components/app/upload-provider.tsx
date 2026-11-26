"use client";

import { useQueryClient } from "@tanstack/react-query";
import { FilePlus2, FileStack } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { toast } from "sonner";
import { UploadDialog } from "@/components/app/upload-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const PDF_ACCEPT = { "application/pdf": [".pdf"] };

/** A page that accepts drops as "new version of this document" registers itself here. */
export interface VersionTarget {
  documentId: string;
  title: string;
  nextVersion: number;
}

/** A new document whose upload is still in flight (lives only in this tab until the API answers). */
export interface PendingUpload {
  id: string; // "pending-…"
  file: File;
  type: string;
  title: string;
  status: "uploading" | "failed";
  error?: string;
}

/** A new version of an existing document whose upload is in flight. */
export interface VersionUpload {
  file: File;
  version: number;
  status: "uploading" | "failed";
  error?: string;
}

interface UploadContextValue {
  openNewDocument: (file?: File) => void;
  startUpload: (input: { file: File; type: string; title: string }) => void;
  retryPending: (id: string) => void;
  pending: Record<string, PendingUpload>;
  uploadNewVersion: (target: VersionTarget, file: File) => void;
  versionUploads: Record<string, VersionUpload>;
  setVersionTarget: (t: VersionTarget | null) => void;
}

const UploadContext = createContext<UploadContextValue | null>(null);

export function useUpload() {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error("useUpload must be used inside <UploadProvider>");
  return ctx;
}

/** Registers the current page as the drop target for new versions while it is mounted. */
export function useVersionDropTarget(target: VersionTarget | null) {
  const { setVersionTarget } = useUpload();
  const key = target ? `${target.documentId}:${target.nextVersion}:${target.title}` : "";
  useEffect(() => {
    setVersionTarget(target);
    return () => setVersionTarget(null);
  }, [key, setVersionTarget]);
}

export function rejectionMessage(rejections: FileRejection[]) {
  const code = rejections[0]?.errors[0]?.code;
  if (code === "file-too-large") return "That PDF is larger than 20 MB.";
  if (code === "file-invalid-type") return "Only PDF files can be reviewed.";
  if (code === "too-many-files") return "Drop one PDF at a time.";
  return "That file can't be uploaded.";
}

export function UploadProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [dialog, setDialog] = useState<{ open: boolean; file?: File }>({ open: false });
  const [versionTarget, setVersionTarget] = useState<VersionTarget | null>(null);
  const [pendingDrop, setPendingDrop] = useState<{ file: File; target: VersionTarget } | null>(null);
  const [pending, setPending] = useState<Record<string, PendingUpload>>({});
  const [versionUploads, setVersionUploads] = useState<Record<string, VersionUpload>>({});

  const runUpload = useCallback(
    async (p: PendingUpload) => {
      setPending((m) => ({ ...m, [p.id]: { ...p, status: "uploading", error: undefined } }));
      try {
        const doc = await api.upload({ file: p.file, type: p.type, title: p.title });
        qc.setQueryData(["document", doc.id, null], doc);
        qc.invalidateQueries({ queryKey: ["documents"] });
        // swap the placeholder page for the real document without a history entry
        router.replace(`/documents/${doc.id}`);
        setPending(({ [p.id]: _done, ...rest }) => rest);
      } catch (e) {
        setPending((m) => ({ ...m, [p.id]: { ...p, status: "failed", error: (e as Error).message } }));
      }
    },
    [qc, router],
  );

  // Navigate first, upload second: the document page shows the "Uploading" stage right away.
  const startUpload = useCallback(
    (input: { file: File; type: string; title: string }) => {
      const p: PendingUpload = { id: `pending-${crypto.randomUUID()}`, status: "uploading", ...input };
      setPending((m) => ({ ...m, [p.id]: p }));
      router.push(`/documents/${p.id}`);
      void runUpload(p);
    },
    [router, runUpload],
  );

  const retryPending = useCallback(
    (id: string) => {
      const p = pending[id];
      if (p) void runUpload(p);
    },
    [pending, runUpload],
  );

  const uploadNewVersion = useCallback(
    async (target: VersionTarget, file: File) => {
      setVersionUploads((m) => ({ ...m, [target.documentId]: { file, version: target.nextVersion, status: "uploading" } }));
      try {
        const res = await api.uploadVersion(target.documentId, file);
        qc.setQueryData(["document", target.documentId, null], res);
        qc.invalidateQueries({ queryKey: ["document", target.documentId] });
        qc.invalidateQueries({ queryKey: ["documents"] });
        if (res.duplicate) toast(`Identical to v${res.currentVersion}. Nothing to re-extract.`);
        setVersionUploads(({ [target.documentId]: _done, ...rest }) => rest);
      } catch (e) {
        setVersionUploads((m) => ({
          ...m,
          [target.documentId]: { file, version: target.nextVersion, status: "failed", error: (e as Error).message },
        }));
        toast.error((e as Error).message);
      }
    },
    [qc],
  );

  const openNewDocument = useCallback((file?: File) => setDialog({ open: true, file }), []);

  // The dropzone's own drag counter can get stuck (drag cancelled outside the window, odd targets).
  // Track a drag in progress ourselves: on at dragenter with files; off at drop/dragend/leaving the
  // window, or any pointer move (pointer events don't fire during a real drag).
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const on = (e: DragEvent) => e.dataTransfer?.types.includes("Files") && setDragging(true);
    const off = () => setDragging(false);
    const leave = (e: DragEvent) => e.relatedTarget == null && setDragging(false);
    window.addEventListener("dragenter", on, true);
    window.addEventListener("dragleave", leave, true);
    window.addEventListener("drop", off, true);
    window.addEventListener("dragend", off, true);
    window.addEventListener("pointermove", off, true);
    window.addEventListener("pointerdown", off, true);
    return () => {
      window.removeEventListener("dragenter", on, true);
      window.removeEventListener("dragleave", leave, true);
      window.removeEventListener("drop", off, true);
      window.removeEventListener("dragend", off, true);
      window.removeEventListener("pointermove", off, true);
      window.removeEventListener("pointerdown", off, true);
    };
  }, []);

  // App-wide drop zone (Midday-style full-cover overlay while dragging).
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: PDF_ACCEPT,
    maxSize: MAX_PDF_BYTES,
    maxFiles: 1,
    multiple: false,
    noClick: true,
    noKeyboard: true,
    disabled: dialog.open, // the dialog has its own drop area
    onDropAccepted: ([file]) => {
      if (!file) return;
      if (versionTarget) setPendingDrop({ file, target: versionTarget });
      else openNewDocument(file);
    },
    onDropRejected: (r) => toast.error(rejectionMessage(r)),
  });

  const value = useMemo(
    () => ({ openNewDocument, startUpload, retryPending, pending, uploadNewVersion, versionUploads, setVersionTarget }),
    [openNewDocument, startUpload, retryPending, pending, uploadNewVersion, versionUploads],
  );

  return (
    <UploadContext.Provider value={value}>
      <div {...getRootProps({ className: "relative min-h-svh outline-none" })}>
        <input {...getInputProps()} />
        {children}
        {isDragActive && dragging && !pendingDrop && (
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-[2px] animate-in fade-in-0">
            <div className="flex w-[min(28rem,90vw)] flex-col items-center gap-3 border border-dashed border-foreground/30 bg-card px-8 py-10 text-center">
              {versionTarget ? <FileStack className="size-6 text-muted-foreground" /> : <FilePlus2 className="size-6 text-muted-foreground" />}
              <p className="font-serif text-xl">{versionTarget ? `New version of ${versionTarget.title}` : "Start a new document"}</p>
              <p className="text-xs text-muted-foreground">
                {versionTarget
                  ? `Drop the revised PDF to upload it as v${versionTarget.nextVersion}. Reviews whose evidence is unchanged carry over.`
                  : "Drop a PDF anywhere to upload it for extraction and review."}
              </p>
            </div>
          </div>
        )}
      </div>

      <UploadDialog
        open={dialog.open}
        initialFile={dialog.file}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        onSubmit={(input) => {
          setDialog({ open: false });
          startUpload(input);
        }}
      />

      <AlertDialog open={!!pendingDrop} onOpenChange={(o) => !o && setPendingDrop(null)}>
        <AlertDialogContent className="data-[size=default]:max-w-[calc(100vw-2rem)] data-[size=default]:sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif text-xl font-normal break-words">
              Upload as v{pendingDrop?.target.nextVersion} of {pendingDrop?.target.title}?
            </AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              <span className="font-medium break-all text-foreground">{pendingDrop?.file.name}</span> will be extracted as a new
              version. Values whose evidence didn&apos;t change keep their review; changed values come back for review with
              the previous version beside them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-wrap sm:flex-row sm:items-center sm:justify-between">
            <Button
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => {
                const f = pendingDrop?.file;
                setPendingDrop(null);
                if (f) openNewDocument(f);
              }}
            >
              Start a new document instead
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (pendingDrop) uploadNewVersion(pendingDrop.target, pendingDrop.file);
                  setPendingDrop(null);
                }}
              >
                Upload new version
              </AlertDialogAction>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </UploadContext.Provider>
  );
}
