import type { Rng } from "./rng";

/**
 * Words grouped by length. Length 1 is the alphabet (Bullets carry one letter).
 * Anything that isn't lowercase a-z is dropped.
 */
export class WordBank {
  private byLen = new Map<number, string[]>();

  constructor(words: Iterable<string>) {
    const seen = new Set<string>();
    for (const raw of words) {
      const w = raw.trim().toLowerCase();
      if (w.length < 2 || !/^[a-z]+$/.test(w) || seen.has(w)) continue;
      seen.add(w);
      const list = this.byLen.get(w.length) ?? [];
      list.push(w);
      this.byLen.set(w.length, list);
    }
    this.byLen.set(1, "abcdefghijklmnopqrstuvwxyz".split(""));
  }

  bucket(len: number): readonly string[] {
    return this.byLen.get(len) ?? [];
  }

  lengths(): number[] {
    return [...this.byLen.keys()].sort((a, b) => a - b);
  }

  /**
   * Pick a word whose length is in [lo, hi]. Tries up to `tries` words of the chosen
   * length for one that is unused this wave and whose first letter isn't in
   * `takenFirsts`; then settles for one unused this wave; then anything.
   */
  pick(
    rng: Rng,
    lo: number,
    hi: number,
    takenFirsts: ReadonlySet<string>,
    usedThisWave: ReadonlySet<string>,
    tries: number,
  ): string {
    let len = rng.int(lo, hi);
    let bucket = this.bucket(len);
    if (bucket.length === 0) {
      // fall back to the nearest length that has words
      const lens = this.lengths().filter((l) => l >= lo && l <= hi);
      const alt = lens.length ? rng.pick(lens) : this.nearest(len);
      len = alt;
      bucket = this.bucket(len);
    }
    for (let i = 0; i < tries; i++) {
      const w = rng.pick(bucket);
      if (!usedThisWave.has(w) && !takenFirsts.has(w[0]!)) return w;
    }
    for (let i = 0; i < tries; i++) {
      const w = rng.pick(bucket);
      if (!usedThisWave.has(w)) return w;
    }
    return rng.pick(bucket);
  }

  private nearest(len: number): number {
    let best = 1;
    for (const l of this.lengths()) if (Math.abs(l - len) < Math.abs(best - len)) best = l;
    return best;
  }
}
