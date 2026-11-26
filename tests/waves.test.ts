import { describe, expect, it } from "vitest";
import { composition, fanCount, spawnGap, spawnLps, speedFactor } from "../src/core/waves";
import { cfg, newSim } from "./helpers";

// The spec's wave table: wave, mines, destroyers, oppressors, total, speed
const TABLE: [number, number, number, number, number, number][] = [
  [1, 4, 0, 0, 4, 1.05],
  [3, 5, 1, 0, 6, 1.16],
  [5, 7, 1, 0, 8, 1.28],
  [7, 7, 1, 1, 9, 1.41],
  [10, 9, 2, 1, 12, 1.63],
  [15, 11, 3, 2, 16, 2.08],
  [20, 15, 4, 2, 21, 2.65],
];

describe("waves", () => {
  it.each(TABLE)("wave %i matches the spec table", (n, m, d, o, total, speed) => {
    const c = composition(n, cfg.waves);
    expect(c).toEqual({ mine: m, destroyer: d, oppressor: o });
    expect(c.mine + c.destroyer + c.oppressor).toBe(total);
    expect(speedFactor(n, cfg.waves)).toBeCloseTo(speed, 2);
  });

  it("first Destroyer at wave 3 and first Oppressor at wave 7", () => {
    expect(composition(2, cfg.waves).destroyer).toBe(0);
    expect(composition(3, cfg.waves).destroyer).toBe(1);
    expect(composition(6, cfg.waves).oppressor).toBe(0);
    expect(composition(7, cfg.waves).oppressor).toBe(1);
  });

  it("each wave adds one enemy, except Oppressor waves, which keep the count", () => {
    for (let n = 2; n <= 60; n++) {
      const a = composition(n - 1, cfg.waves);
      const b = composition(n, cfg.waves);
      const grow = n % cfg.waves.oppressorEvery === 0 ? 0 : 1;
      expect(b.mine + b.destroyer + b.oppressor).toBe(a.mine + a.destroyer + a.oppressor + grow);
      expect(b.mine).toBeGreaterThan(0);
      expect(b.destroyer).toBeGreaterThanOrEqual(0);
    }
  });

  it("the Oppressor's fan starts small and grows every fanGrowEvery waves, up to the max", () => {
    const o = cfg.oppressor;
    const first = cfg.waves.oppressorEvery;
    expect(fanCount(first, cfg.waves, o)).toBe(o.fanCountStart);
    expect(fanCount(first + o.fanGrowEvery - 1, cfg.waves, o)).toBe(o.fanCountStart);
    expect(fanCount(first + o.fanGrowEvery, cfg.waves, o)).toBe(o.fanCountStart + 1);
    expect(fanCount(1000, cfg.waves, o)).toBe(o.fanCountMax);
  });

  it("spawn letters per second grow each wave up to the cap", () => {
    const w = cfg.waves;
    expect(spawnLps(1, w)).toBeCloseTo(w.spawnLettersPerSec, 5);
    expect(spawnLps(2, w)).toBeCloseTo(w.spawnLettersPerSec * w.spawnLettersPerSecGrowth, 5);
    expect(spawnLps(1000, w)).toBe(w.spawnLettersPerSecMax);
  });

  it("spawn gaps scale with word length, clamped", () => {
    const w = cfg.waves;
    expect(spawnGap(6, 3, w)).toBeCloseTo(2, 5);
    expect(spawnGap(12, 3, w)).toBeCloseTo(4, 5);
    expect(spawnGap(1, 100, w)).toBe(w.spawnGapMin);
    expect(spawnGap(100, 1, w)).toBe(w.spawnGapMax);
  });

  it("killing words below minOnScreen brings the next spawn in early", () => {
    const s = newSim(5);
    s.step();
    // type every word on screen, then time how long until the next spawn
    for (const e of s.enemies.filter((x) => !x.dying && x.kind !== "bullet"))
      for (const ch of e.word.slice(e.typed)) s.step([{ kind: "char", ch }]);
    let steps = 0;
    while (steps < 600 && !s.step().some((e) => e.type === "spawn" && e.parent === null)) steps++;
    expect(steps / 60).toBeLessThanOrEqual(cfg.waves.spawnGapMin + 0.05);
  });

  it("the sim waits each spawn's word length before the next one", () => {
    const s = newSim(3);
    const spawns: { t: number; word: string }[] = [];
    for (let i = 0; i < 60 * 30 && s.wave === 1 && s.phase !== "over"; i++)
      for (const e of s.step()) if (e.type === "spawn" && e.parent === null) spawns.push({ t: e.t, word: e.word });
    expect(spawns.length).toBe(4);
    const lps = spawnLps(1, cfg.waves);
    // with nobody typing, the second comes in early to make up minOnScreen...
    expect((spawns[1]!.t - spawns[0]!.t) / 1000).toBeCloseTo(cfg.waves.spawnGapMin, 1);
    // ...then each waits the previous word's length
    for (let i = 2; i < spawns.length; i++) {
      const gap = (spawns[i]!.t - spawns[i - 1]!.t) / 1000;
      expect(gap).toBeCloseTo(spawnGap(spawns[i - 1]!.word.length, lps, cfg.waves), 1);
    }
  });
});
