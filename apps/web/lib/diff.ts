export type DiffPart = { text: string; kind: "same" | "add" | "del" };

/** Word-level diff (LCS) between two short passages, for "what changed in the evidence". */
export function diffWords(before: string, after: string): { before: DiffPart[]; after: DiffPart[] } {
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const outA: DiffPart[] = [];
  const outB: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      outA.push({ text: a[i]!, kind: "same" });
      outB.push({ text: b[j]!, kind: "same" });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) outA.push({ text: a[i++]!, kind: "del" });
    else outB.push({ text: b[j++]!, kind: "add" });
  }
  while (i < a.length) outA.push({ text: a[i++]!, kind: "del" });
  while (j < b.length) outB.push({ text: b[j++]!, kind: "add" });
  return { before: outA, after: outB };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Find a quote in raw PDF text, tolerating the whitespace/line-break differences evidence validation also tolerates. */
export function locate(text: string, quote: string): [number, number] | null {
  const words = quote.trim().split(/\s+/).filter(Boolean).map(escape);
  if (!words.length) return null;
  const m = new RegExp(words.join("\\s+")).exec(text);
  return m ? [m.index, m.index + m[0].length] : null;
}
