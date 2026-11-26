import { describe, expect, it } from "vitest";
import { historyHtml, series } from "../src/app/history";
import { addRun, bests, mergeRuns, newRecords, parseSave, runsFromLogEnds, type RunRecord } from "../src/app/storage";

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

describe("importing runs from the gameplay logs", () => {
  const start = (id: string, at: string) => JSON.stringify({ run_id: id, t: 0, type: "run_start", started_at: at });
  const end = (id: string, t: number, score: number, reason = "death") =>
    JSON.stringify({ run_id: id, t, type: "run_end", reason, score, wave: 9, accuracy: 0.9375, wpm: 23.456, longest_streak: 70 });

  it("turns finished runs into history, timed at their end, skipping quits, empties and junk", () => {
    const text = [
      start("a", "2026-11-25T18:00:00.000Z"),
      end("a", 300000, 480),
      start("b", "2026-11-25T19:00:00.000Z"),
      end("b", 60000, 120, "quit"),
      start("c", "2026-11-25T20:00:00.000Z"), // still running: no run_end
      "{not json",
      start("d", "2026-11-25T21:00:00.000Z"),
      end("d", 1000, 0),
      end("zz", 5000, 999), // no matching start
    ].join("\n");
    expect(runsFromLogEnds(text)).toEqual([
      { at: "2026-11-25T18:05:00.000Z", score: 480, wave: 9, accuracy: 0.9375, wpm: 23.5, longestStreak: 70 },
    ]);
    expect(runsFromLogEnds("")).toEqual([]);
  });

  it("merges without duplicates, giving an old date-only entry the log's time", () => {
    const legacy: RunRecord = { at: "2026-11-25T12:00:00.000Z", score: 480, wave: 9, accuracy: 0.9375, wpm: 23.5, longestStreak: 70 };
    const fromLog = { ...legacy, at: "2026-11-25T18:05:00.000Z" };
    const other = run(28, 900, 0.95, 25);
    const merged = mergeRuns([legacy, other], [fromLog, run(1, 50, 0.8, 15)]);
    expect(merged.map((r) => r.score)).toEqual([50, 480, 900]);
    expect(merged[1]!.at).toBe("2026-11-25T18:05:00.000Z");
    expect(legacy.at).toBe("2026-11-25T12:00:00.000Z"); // inputs untouched
  });

  it("remembers that the logs were imported", () => {
    expect(parseSave(JSON.stringify({ history: [], logsImported: true })).logsImported).toBe(true);
    expect(parseSave(JSON.stringify({ history: [] })).logsImported).toBeUndefined();
  });
});

describe("long histories", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => run(1 + (i % 28), 100 + i, 0.9, 20));

  it("charts every run, not just the latest few", () => {
    expect(series(many(250), "score").values).toHaveLength(250);
  });

  it("drops plain-run dots on long histories but keeps record dots", () => {
    const short = historyHtml(many(30));
    expect(short).toContain('<circle class="run"');
    const long = historyHtml(many(120));
    expect(long).not.toContain('<circle class="run"');
    expect(long).toContain('<circle class="rec"'); // every run here is a new score record
  });
});
