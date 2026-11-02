/**
 * @fileoverview Clause-level prompt diff. Image prompts are one long paragraph,
 * so a line diff marks the whole thing changed and a character diff is noise.
 * Splitting at sentence and clause punctuation gives units a person recognises
 * ("warm golden-hour light,"), and an LCS over those units says exactly which
 * were kept, dropped and added.
 *
 * The output feeds ReUI's `CodeBlock` diff props: one unit per line, with the
 * 1-based line numbers that were added / removed.
 *
 * ponytail: O(n·m) LCS table. Prompts are tens of clauses; fine far past any
 * real prompt (8,000-char cap ≈ a few hundred clauses).
 */

export type DiffOp = { type: "same" | "add" | "del"; text: string };

/**
 * Split a prompt into clauses, keeping the punctuation on each clause.
 *
 * @example splitClauses("A cat, asleep. Warm light.") // ["A cat,", "asleep.", "Warm light."]
 */
export function splitClauses(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?;,:])\s+/)
    .filter(Boolean);
}

/**
 * Diff two prompts clause by clause. Deletions come before additions at each
 * change point, as in a unified diff.
 *
 * @param before The older prompt.
 * @param after The newer prompt.
 * @returns Ordered ops covering both inputs.
 */
export function diffPrompts(before: string, after: string): DiffOp[] {
  const a = splitClauses(before);
  const b = splitClauses(after);
  // Compare ignoring case and the trailing clause punctuation (a clause that only
  // moved from the end — "lights." → "lights," — is not a change); display the
  // newer text.
  const key = (s: string) => s.toLowerCase().replace(/[.!?;,:]+$/, "");
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => 0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = key(a[i]) === key(b[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (key(a[i]) === key(b[j])) {
      ops.push({ type: "same", text: b[j] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ type: "del", text: a[i++] });
    } else {
      ops.push({ type: "add", text: b[j++] });
    }
  }
  while (i < a.length) ops.push({ type: "del", text: a[i++] });
  while (j < b.length) ops.push({ type: "add", text: b[j++] });
  return ops;
}

/**
 * Shape ops for a line-based diff renderer.
 *
 * @returns `code` (one clause per line) and the 1-based `added` / `removed` line numbers.
 */
export function toLineDiff(ops: DiffOp[]): { code: string; added: number[]; removed: number[] } {
  const added: number[] = [];
  const removed: number[] = [];
  ops.forEach((op, idx) => {
    if (op.type === "add") added.push(idx + 1);
    if (op.type === "del") removed.push(idx + 1);
  });
  return { code: ops.map((o) => o.text).join("\n"), added, removed };
}
