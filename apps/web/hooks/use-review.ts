"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { DocumentDetail, Progress, ReviewEvent, ReviewInput, Value, ValueStatus } from "@/lib/types";

export const isOptimistic = (id: string | null | undefined) => !!id?.startsWith("optimistic-");

function progressOf(values: Value[]): Progress {
  const p: Progress = { total: values.length, pending: 0, approved: 0, corrected: 0, carried_over: 0, gaps: 0 };
  for (const v of values) {
    p[v.status]++;
    if (v.isGap) p.gaps++;
  }
  return p;
}

/** What the server will compute for this action, applied locally so the UI never waits on the network. */
function applyLocally(v: Value, input: ReviewInput): Value {
  const now = new Date().toISOString();
  const event = (e: Pick<ReviewEvent, "kind" | "state" | "resultValue" | "note"> & { sourceEventId?: string | null }): ReviewEvent => ({
    id: `optimistic-${crypto.randomUUID()}`,
    reviewer: "you",
    createdAt: now,
    sourceEventId: e.sourceEventId ?? null,
    ...e,
  });
  let ev: ReviewEvent;
  switch (input.action) {
    case "approve":
      ev = event({ kind: "approved", state: "approved", resultValue: v.value, note: input.note ?? null });
      break;
    case "correct":
      ev = event({ kind: "corrected", state: "corrected", resultValue: input.value, note: input.note ?? null });
      break;
    case "restore": {
      const src = v.history.find((h) => h.id === input.eventId);
      if (!src) return v;
      ev = event({ kind: "restored", state: src.state, resultValue: src.resultValue, note: src.note, sourceEventId: src.id });
      break;
    }
    case "reset":
      ev = event({ kind: "restored", state: "pending", resultValue: null, note: null });
      break;
  }
  const status: ValueStatus = ev.state === "pending" ? "pending" : ev.state;
  return {
    ...v,
    status,
    effectiveValue: ev.state === "corrected" ? ev.resultValue : v.value,
    note: ev.state === "pending" ? null : ev.note,
    latestEventId: ev.id,
    history: [...v.history, ev],
  };
}

/**
 * Review mutation with an optimistic cache update: the value flips state
 * immediately, the request goes out in the background, and on failure the
 * cache rolls back with a toast. The server stays the source of truth: the
 * document is refetched once the request settles.
 */
export function useReview(documentId: string, viewVersion: number | null) {
  const qc = useQueryClient();
  const key = ["document", documentId, viewVersion] as const;

  return useMutation({
    mutationFn: ({ valueId, input, expectedLatestEventId }: { valueId: string; input: ReviewInput; expectedLatestEventId: string | null }) =>
      api.review(valueId, isOptimistic(expectedLatestEventId) ? input : { ...input, expectedLatestEventId }),
    onMutate: async ({ valueId, input }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<DocumentDetail>(key);
      if (previous) {
        const values = previous.values.map((v) => (v.id === valueId ? applyLocally(v, input) : v));
        qc.setQueryData<DocumentDetail>(key, { ...previous, values, progress: progressOf(values) });
      }
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      toast.error(err.message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["document", documentId] });
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}
