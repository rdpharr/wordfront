import { describe, expect, it } from "vitest";
import { Scoring, accuracy } from "../src/core/scoring";
import { cfg } from "./helpers";

describe("scoring", () => {
  it("multiplier is 1x below 20, 2x from 20, 3x from 50 and caps at 3x", () => {
    const s = new Scoring(cfg.multiplierSteps);
    const mults: number[] = [];
    for (let i = 1; i <= 80; i++) mults.push(s.hit());
    expect(mults[18]).toBe(1); // 19th letter
    expect(mults[19]).toBe(2); // 20th
    expect(mults[48]).toBe(2); // 49th
    expect(mults[49]).toBe(3); // 50th
    expect(mults[79]).toBe(3);
    // 19*1 + 30*2 + 31*3
    expect(s.score).toBe(19 + 60 + 93);
  });

  it("a miss resets streak and multiplier but costs no points", () => {
    const s = new Scoring(cfg.multiplierSteps);
    for (let i = 0; i < 25; i++) s.hit();
    const before = s.score;
    s.miss("e");
    expect(s.score).toBe(before);
    expect(s.streak).toBe(0);
    expect(s.multiplier).toBe(1);
    expect(s.longestStreak).toBe(25);
    expect(s.hit()).toBe(1);
  });

  it("tracks accuracy and the most-missed letters", () => {
    const s = new Scoring(cfg.multiplierSteps);
    for (let i = 0; i < 9; i++) s.hit();
    s.miss("e");
    s.miss("e");
    s.miss("r");
    s.miss(null); // a letter that matched nothing: an error, but no expected letter
    expect(s.accuracy).toBeCloseTo(9 / 13);
    expect(s.topMissed()).toEqual([
      { letter: "e", count: 2 },
      { letter: "r", count: 1 },
    ]);
    expect(accuracy(0, 0)).toBe(1);
  });
});
