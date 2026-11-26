import { describe, expect, it } from "vitest";
import { configHash, rawConfig } from "../src/core/config";
import { parseLog, replayRun } from "../src/core/replay";
import { decodeInputs, encodeInputs, RunLogger, wordsHash, type LogRecord } from "../src/core/runlog";
import type { SimInput } from "../src/core/types";
import { WORDS } from "../src/core/wordlist";
import { bank, botInputs, newSim } from "./helpers";

function memorySink() {
  const files = new Map<string, string>();
  const add = (f: string, t: string) => files.set(f, (files.get(f) ?? "") + t);
  return { files, sink: { write: async (f: string, t: string) => void add(f, t), writeNow: add } };
}

const INFO = { build: "test", configHash: configHash(rawConfig), wordsHash: wordsHash(WORDS), tunables: rawConfig };

/** Play a bot run while logging it, like the app does. */
async function loggedRun(seed: number, maxSteps: number, opts: { missEvery?: number; quitAt?: number; extras?: boolean; every?: number } = {}) {
  const sim = newSim(seed);
  const { files, sink } = memorySink();
  const log = new RunLogger(sink, sim, INFO, new Date(2026, 10, 25, 10, 15, 0));
  const counter = { n: 0 };
  for (let i = 0; i < maxSteps && sim.phase !== "over"; i++) {
    if (opts.quitAt !== undefined && i === opts.quitAt) break;
    let inputs: SimInput[] = botInputs(sim, opts.every ?? 7, opts.missEvery ?? 0, counter);
    // sprinkle in same-step bursts, releases and airstrikes
    if (opts.extras && i % 97 === 0 && i > 0) inputs = [...inputs, { kind: "backspace" }, { kind: "char", ch: "e" }];
    if (opts.extras && i >= 600 && sim.empsLeft === 3 && sim.phase === "wave" && sim.enemies.length > 0)
      inputs = [...inputs, { kind: "emp" }];
    const evs = sim.step(inputs);
    log.inputs(inputs);
    log.events(evs);
    if (i === 300) {
      log.pause("esc");
      log.resume("esc");
    }
  }
  await log.end(sim.phase === "over" ? "death" : "quit");
  return { sim, log, text: files.get(log.file)! };
}

describe("run log", () => {
  it("writes one file of JSON lines with the spec's events, each with run_id, t, wave and type", async () => {
    const { log, text } = await loggedRun(9, 60 * 60 * 10, { missEvery: 13, extras: true, every: 24 });
    expect(log.file).toMatch(/^run-20261125-101500-[0-9a-f]{4}\.jsonl$/);
    const recs = parseLog(text);
    for (const r of recs) {
      expect(r.run_id).toBe(log.runId);
      expect(typeof r.t).toBe("number");
      expect(typeof r.wave).toBe("number");
      expect(typeof r.type).toBe("string");
    }
    const types = new Set(recs.map((r) => r.type));
    for (const t of ["run_start", "wave_start", "spawn", "lock", "key", "release", "kill", "airstrike", "wave_end", "pause", "resume", "death", "run_end"]) {
      expect(types, t).toContain(t);
    }
    expect(types).not.toContain("hit");
    expect(recs[0]!.type).toBe("run_start");
    expect(recs[0]).toMatchObject({ config_hash: INFO.configHash, words_hash: INFO.wordsHash });
    expect(recs.at(-1)!.type).toBe("run_end");
    // keys are snake_case for the analysis script
    expect(recs.find((r) => r.type === "key")).toHaveProperty("ms_since_prev");
  });

  it("run_end totals match the game's own stats", async () => {
    const { sim, text } = await loggedRun(4, 60 * 60 * 10, { missEvery: 9, every: 24 });
    const recs = parseLog(text);
    const end = recs.find((r) => r.type === "run_end")!;
    expect(end).toMatchObject({
      reason: "death",
      score: sim.scoring.score,
      wave: sim.wave,
      correct: sim.scoring.correct,
      errors: sim.scoring.errors,
      longest_streak: sim.scoring.longestStreak,
    });
    const keys = recs.filter((r) => r.type === "key");
    expect(keys.filter((k) => k.correct).length).toBe(sim.scoring.correct);
    expect(keys.filter((k) => !k.correct).length).toBe(sim.scoring.errors);
  });

  it("encodes inputs compactly and losslessly", () => {
    const inputs: SimInput[] = [{ kind: "char", ch: "a" }, { kind: "backspace" }, { kind: "emp" }, { kind: "char", ch: "z" }];
    expect(encodeInputs(inputs)).toBe("a<!z");
    expect(decodeInputs("a<!z")).toEqual(inputs);
  });
});

describe("replay", () => {
  it("reproduces a finished run's score and wave from its seed and keystrokes", async () => {
    const { text } = await loggedRun(21, 60 * 60 * 4, { missEvery: 11, extras: true });
    const r = replayRun(parseLog(text), bank, WORDS);
    expect(r.warnings).toEqual([]);
    expect(r.replayed).toEqual(r.recorded);
    expect(r.matches).toBe(true);
    expect(r.recorded.score).toBeGreaterThan(0);
  });

  it("reproduces a run that was quit part-way", async () => {
    const { text } = await loggedRun(5, 60 * 60 * 4, { quitAt: 1500 });
    const recs = parseLog(text);
    expect(recs.at(-1)).toMatchObject({ type: "run_end", reason: "quit" });
    expect(replayRun(recs, bank).matches).toBe(true);
  });

  it("notices when keystrokes were tampered with", async () => {
    const { text } = await loggedRun(8, 60 * 60 * 2);
    const recs = parseLog(text).filter((r: LogRecord, i, all) => !(r.type === "inputs" && i === all.findIndex((x) => x.type === "inputs")));
    expect(replayRun(recs, bank).matches).toBe(false);
  });

  it("warns when the word list has changed since the run", async () => {
    const { text } = await loggedRun(3, 600);
    expect(replayRun(parseLog(text), bank, [...WORDS, "zzzz"]).warnings[0]).toMatch(/word list/);
  });
});
