import { describe, expect, it } from "vitest";
import { planRedo, planUndo, replay, type ReplayableEvent } from "./index.js";

let n = 0;
const ev = (kind: ReplayableEvent["kind"], state: ReplayableEvent["state"], resultValue: string | null = null, sourceEventId: string | null = null): ReplayableEvent => ({
  id: `e${++n}`,
  kind,
  state,
  resultValue,
  note: null,
  sourceEventId,
});

describe("review replay (undo/redo derived from history)", () => {
  it("undo steps back through actions; redo re-applies them", () => {
    const a = ev("approved", "approved", "5230.29");
    const c = ev("corrected", "corrected", "5320.29");
    const log: ReplayableEvent[] = [a, c];

    const u1 = planUndo(log)!;
    expect(u1).toMatchObject({ sourceEventId: c.id, state: "approved", resultValue: "5230.29" });
    log.push(ev("undone", u1.state, u1.resultValue, u1.sourceEventId));

    const u2 = planUndo(log)!;
    expect(u2).toMatchObject({ sourceEventId: a.id, state: "pending" });
    log.push(ev("undone", u2.state, u2.resultValue, u2.sourceEventId));
    expect(planUndo(log)).toBeNull();

    const r1 = planRedo(log)!;
    expect(r1).toMatchObject({ sourceEventId: a.id, state: "approved" });
    log.push(ev("redone", r1.state, r1.resultValue, r1.sourceEventId));
    expect(planRedo(log)).toMatchObject({ sourceEventId: c.id, state: "corrected", resultValue: "5320.29" });
  });

  it("a new action after undo clears the redo stack", () => {
    const a = ev("approved", "approved");
    const log: ReplayableEvent[] = [a];
    const u = planUndo(log)!;
    log.push(ev("undone", u.state, u.resultValue, u.sourceEventId));
    log.push(ev("corrected", "corrected", "1"));
    expect(planRedo(log)).toBeNull();
    expect(replay(log).done.map((e) => e.kind)).toEqual(["corrected"]);
  });

  it("can undo a carried-over review back to pending", () => {
    const carried = ev("carried_over", "approved", "x");
    expect(planUndo([carried])).toMatchObject({ sourceEventId: carried.id, state: "pending" });
  });
});
