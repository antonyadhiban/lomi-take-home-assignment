/**
 * Review history replay. The event log is append-only; undo and redo are
 * events too (`undone` / `redone`, pointing at the event they reverse), so the
 * undo/redo stacks are derived from the stored history: they survive reloads
 * and are the same on every device.
 */
export type ReviewEventKind = "approved" | "corrected" | "restored" | "carried_over" | "undone" | "redone";
export type ReviewEventState = "pending" | "approved" | "corrected";

export interface ReplayableEvent {
  id: string;
  kind: ReviewEventKind;
  state: ReviewEventState;
  resultValue: string | null;
  note: string | null;
  sourceEventId: string | null;
}

export interface Replay<E extends ReplayableEvent = ReplayableEvent> {
  /** actions currently in effect, oldest first; the last one decides the value's state */
  done: E[];
  /** undone actions that can be redone, most recent last */
  redo: E[];
}

export function replay<E extends ReplayableEvent>(events: readonly E[]): Replay<E> {
  const done: E[] = [];
  let redo: E[] = [];
  for (const e of events) {
    if (e.kind === "undone") {
      if (done.at(-1)?.id === e.sourceEventId) redo.push(done.pop()!);
    } else if (e.kind === "redone") {
      if (redo.at(-1)?.id === e.sourceEventId) done.push(redo.pop()!);
    } else {
      done.push(e);
      redo = [];
    }
  }
  return { done, redo };
}

/** The state an undo/redo would leave the value in, as fields for the new event. */
export function stateAfter<E extends ReplayableEvent>(top: E | undefined) {
  return top
    ? { state: top.state, resultValue: top.resultValue, note: top.note }
    : { state: "pending" as const, resultValue: null, note: null };
}

export function planUndo<E extends ReplayableEvent>(events: readonly E[]) {
  const { done } = replay(events);
  const target = done.at(-1);
  if (!target) return null;
  return { kind: "undone" as const, sourceEventId: target.id, ...stateAfter(done.at(-2)) };
}

export function planRedo<E extends ReplayableEvent>(events: readonly E[]) {
  const { redo } = replay(events);
  const target = redo.at(-1);
  if (!target) return null;
  return { kind: "redone" as const, sourceEventId: target.id, ...stateAfter(target) };
}
