import type { Tunables } from "./config";
import type { Composition } from "./types";

/**
 * Enemy counts for wave n (1-based). Running counts start at startMines; each wave
 * adds a Mine; every destroyerEvery-th wave a Destroyer replaces a Mine; every
 * oppressorEvery-th wave an Oppressor replaces a Destroyer *and* a Mine (this is
 * what the spec's wave table implies from wave 7 on).
 */
export function composition(n: number, w: Tunables["waves"]): Composition {
  let mine = w.startMines;
  let destroyer = 0;
  let oppressor = 0;
  for (let i = 1; i <= n; i++) {
    mine++;
    if (i % w.destroyerEvery === 0) {
      destroyer++;
      mine--;
    }
    if (i % w.oppressorEvery === 0) {
      oppressor++;
      destroyer--;
      mine--;
    }
  }
  return { mine, destroyer, oppressor };
}

/** Letters per second the spawner feeds in on wave n (1-based). */
export function spawnLps(n: number, w: Tunables["waves"]): number {
  const v = w.spawnLettersPerSec * Math.pow(w.spawnLettersPerSecGrowth, n - 1);
  return Math.min(w.spawnLettersPerSecMax, v);
}

/**
 * Seconds to wait after spawning an enemy with a word of `letters` letters, so
 * enemies arrive spaced by how long their words take to type instead of in a clump.
 */
export function spawnGap(letters: number, lps: number, w: Tunables["waves"]): number {
  return Math.min(w.spawnGapMax, Math.max(w.spawnGapMin, letters / lps));
}

/** Bullets in an Oppressor's fan on wave n: grows from fanCountStart after the first Oppressor wave. */
export function fanCount(n: number, w: Tunables["waves"], o: Tunables["oppressor"]): number {
  const grown = Math.floor(Math.max(0, n - w.oppressorEvery) / Math.max(1, o.fanGrowEvery));
  return Math.min(o.fanCountMax, o.fanCountStart + grown);
}

export function speedFactor(n: number, w: Tunables["waves"]): number {
  return Math.pow(w.speedGrowth, n);
}
