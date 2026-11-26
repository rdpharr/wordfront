import type { Enemy } from "./types";

export const remaining = (e: Enemy): string => e.word.slice(e.typed);

/**
 * Choose which enemy a first letter locks onto. Candidates are live enemies whose
 * remaining word starts with `ch`. Letters typed later in the same step
 * (`lookahead`) narrow the choice while they still match someone; then the enemy
 * nearest the player wins.
 */
export function chooseTarget(
  enemies: readonly Enemy[],
  ch: string,
  lookahead: string,
  px: number,
  py: number,
): { target: Enemy; candidates: number } | null {
  const cands = enemies.filter((e) => !e.dying && remaining(e)[0] === ch);
  if (cands.length === 0) return null;
  let set = cands;
  for (let j = 0; j < lookahead.length && set.length > 1; j++) {
    const next = set.filter((e) => remaining(e)[j + 1] === lookahead[j]);
    if (next.length === 0) break;
    set = next;
  }
  let best = set[0]!;
  let bestD = Infinity;
  for (const e of set) {
    const d = Math.hypot(e.x - px, e.y - py);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return { target: best, candidates: cands.length };
}
