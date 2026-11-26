import { describe, expect, it } from "vitest";
import { historyHtml, series } from "../src/app/history";
import { addRun, bests, newRecords, parseSave, type RunRecord } from "../src/app/storage";

const run = (day: number, score: number, accuracy: number, wpm: number): RunRecord => ({
  at: new Date(Date.UTC(2026, 10, day, 12)).toISOString(),
  score,
  wave: 5,
  accuracy,
  wpm,
  longestStreak: 10,
});

describe("run history", () => {
  it("carries an old top-10 list over as history, oldest first", () => {
    const d = parseSave(
      JSON.stringify({
        scores: [
          { name: "A", score: 477, wave: 9, accuracy: 0.95, wpm: 22.6, longestStreak: 64, date: "2026-11-25" },
          { name: "B", score: 291, wave: 7, accuracy: 0.91, wpm: 21.6, longestStreak: 33, date: "2026-11-24" },
        ],
      }),
    );
    expect(d.history.map((r) => r.score)).toEqual([291, 477]);
    expect(d.history[0]).toEqual({ at: "2026-11-24T12:00:00.000Z", score: 291, wave: 7, accuracy: 0.91, wpm: 21.6, longestStreak: 33 });
  });

  it("keeps history when present, sorts it, and drops broken entries", () => {
    const d = parseSave(JSON.stringify({ history: [run(3, 30, 0.9, 20), { at: "nope" }, run(1, 10, 0.8, 18)], scores: [] }));
    expect(d.history.map((r) => r.score)).toEqual([10, 30]);
  });

  it("flags only measures that beat every earlier run", () => {
    expect(newRecords([], run(1, 100, 0.9, 20))).toEqual([]); // nothing to beat yet
    const h = [run(1, 100, 0.9, 20), run(2, 80, 0.95, 19)];
    expect(bests(h)).toEqual({ score: 100, accuracy: 0.95, wpm: 20, longestStreak: 10 });
    expect(newRecords(h, run(3, 120, 0.95, 21))).toEqual(["score", "wpm"]); // ties don't count
    expect(newRecords(h, run(3, 0, 0.99, 30))).toEqual([]); // a zero-score run sets nothing
    expect(newRecords(h, { ...run(3, 50, 0.5, 10), longestStreak: 11 })).toEqual(["longestStreak"]);
    expect(addRun(h, run(3, 1, 1, 1))).toHaveLength(3);
  });

  it("series marks record runs and the running best, counting runs before the window", () => {
    const h = [run(1, 500, 0.9, 20), run(2, 100, 0.9, 20), run(3, 300, 0.9, 20), run(4, 600, 0.9, 20), run(5, 200, 0.9, 20)];
    const all = series(h, "score");
    expect(all.record).toEqual([false, false, false, true, false]); // the first run isn't a record
    expect(all.best).toEqual([500, 500, 500, 600, 600]);
    expect(all.top).toBe(600);
    expect(all.topIndex).toBe(3);
    const last3 = series(h, "score", 3); // 300, 600, 200 with 500 already on the books
    expect(last3.values).toEqual([300, 600, 200]);
    expect(last3.record).toEqual([false, true, false]);
    expect(last3.best).toEqual([500, 600, 600]);
    const old = series(h.slice(0, 3), "score", 2); // best (500) is older than the window
    expect(old.topIndex).toBe(-1);
    expect(old.top).toBe(500);
  });

  it("renders four charts, or nothing with no runs", () => {
    expect(historyHtml([])).toBe("");
    const html = historyHtml([run(1, 100, 0.9, 20), run(2, 150, 0.85, 22)]);
    expect(html.match(/<svg/g)).toHaveLength(4);
    expect(html).toContain("best <b>150</b>");
    expect(html).toContain("best <b>90.0%</b>");
    expect(html).toContain("best <b>22.0</b>");
    expect(html).toContain("Best streak");
    expect(historyHtml([run(1, 100, 0.9, 20)]).match(/<svg/g)).toHaveLength(4); // a single run still draws
  });
});
