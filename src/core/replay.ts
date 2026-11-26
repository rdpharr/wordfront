import { rawConfig, resolveConfig, type RawConfig } from "./config";
import { decodeInputs, wordsHash, type LogRecord } from "./runlog";
import { Sim } from "./sim";
import type { SimInput } from "./types";
import type { WordBank } from "./words";

export interface RunSummary {
  score: number;
  wave: number;
  correct: number;
  errors: number;
  longestStreak: number;
  step: number;
}

export interface ReplayResult {
  recorded: RunSummary;
  replayed: RunSummary;
  matches: boolean;
  /** problems that make an exact replay impossible (e.g. a different word list) */
  warnings: string[];
}

export function parseLog(text: string): LogRecord[] {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as LogRecord);
}

/**
 * Re-run a logged game from its seed, tunables and recorded keystrokes, and
 * compare the result with what the log says happened.
 */
export function replayRun(records: readonly LogRecord[], words: WordBank, wordList?: readonly string[]): ReplayResult {
  const start = records.find((r) => r.type === "run_start");
  const end = records.find((r) => r.type === "run_end");
  if (!start) throw new Error("log has no run_start");
  if (!end) throw new Error("log has no run_end (the run didn't finish writing)");

  const warnings: string[] = [];
  if (wordList && start.words_hash !== wordsHash(wordList)) {
    warnings.push("the word list has changed since this run was recorded");
  }

  const inputs = new Map<number, SimInput[]>();
  for (const r of records) if (r.type === "inputs") inputs.set(r.step as number, decodeInputs(r.keys as string));

  const missing: string[] = [];
  const tunables = fillMissing(start.tunables as Record<string, unknown>, rawConfig, "", missing) as RawConfig;
  if (missing.length) {
    warnings.push(
      `this run was recorded under older game rules (no ${missing.join(", ")}); current values were filled in, so the replay will likely differ`,
    );
  }
  const sim = new Sim(resolveConfig(tunables), words, start.seed as number);
  const lastStep = end.step as number;
  while (sim.phase !== "over" && sim.stepCount < lastStep) {
    sim.step(inputs.get(sim.stepCount + 1) ?? []);
  }

  const recorded: RunSummary = {
    score: end.score as number,
    wave: end.wave as number,
    correct: end.correct as number,
    errors: end.errors as number,
    longestStreak: end.longest_streak as number,
    step: lastStep,
  };
  const replayed: RunSummary = {
    score: sim.scoring.score,
    wave: sim.wave,
    correct: sim.scoring.correct,
    errors: sim.scoring.errors,
    longestStreak: sim.scoring.longestStreak,
    step: sim.stepCount,
  };
  const matches = (Object.keys(recorded) as (keyof RunSummary)[]).every((k) => recorded[k] === replayed[k]);
  return { recorded, replayed, matches, warnings };
}

/** Copy of `logged` with any setting it lacks taken from `current`; lists what was missing. */
function fillMissing(logged: Record<string, unknown>, current: object, at: string, missing: string[]): unknown {
  const out: Record<string, unknown> = { ...logged };
  for (const [k, v] of Object.entries(current)) {
    if (k.startsWith("_")) continue;
    const path = at ? `${at}.${k}` : k;
    if (!(k in out)) {
      out[k] = v;
      missing.push(path);
    } else if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object") {
      out[k] = fillMissing(out[k] as Record<string, unknown>, v, path, missing);
    }
  }
  return out;
}
