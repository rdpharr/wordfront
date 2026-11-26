import type { RawConfig } from "./config";
import type { Sim } from "./sim";
import type { SimEvent, SimInput } from "./types";

/**
 * Gameplay log: one JSON object per line, one file per run. Every record has
 * run_id, t (ms of active play, pauses excluded), wave and type. Besides the
 * spec's events there is an "inputs" record per step that received keys, which
 * is what replay uses to reproduce a run exactly.
 */

export type LogRecord = { run_id: string; t: number; wave: number; type: string; [k: string]: unknown };

export interface LogSink {
  /** append lines to the run's file */
  write(file: string, text: string): Promise<void>;
  /** best effort while the page is closing */
  writeNow(file: string, text: string): void;
}

export interface RunInfo {
  build: string;
  configHash: string;
  wordsHash: string;
  tunables: RawConfig;
}

/** sim events that are display-only and stay out of the log */
const SKIP = new Set(["hit", "fire", "emp_fire"]);

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

export function encodeInputs(inputs: readonly SimInput[]): string {
  return inputs.map((i) => (i.kind === "char" ? i.ch : i.kind === "backspace" ? "<" : "!")).join("");
}

export function decodeInputs(keys: string): SimInput[] {
  return [...keys].map((c) =>
    c === "<" ? { kind: "backspace" as const } : c === "!" ? { kind: "emp" as const } : { kind: "char" as const, ch: c },
  );
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** run-YYYYMMDD-HHMMSS-xxxx, local time */
export function runStamp(d: Date, rand: () => number = Math.random): string {
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const suffix = Math.floor(rand() * 0x10000)
    .toString(16)
    .padStart(4, "0");
  return `run-${date}-${time}-${suffix}`;
}

export class RunLogger {
  readonly runId: string;
  readonly file: string;
  private buf: string[] = [];
  private ended = false;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private sink: LogSink,
    private sim: Sim,
    info: RunInfo,
    now = new Date(),
  ) {
    this.runId = runStamp(now);
    this.file = `${this.runId}.jsonl`;
    this.push({
      type: "run_start",
      t: 0,
      wave: sim.wave,
      build: info.build,
      config_hash: info.configHash,
      words_hash: info.wordsHash,
      seed: sim.seed,
      started_at: now.toISOString(),
      tunables: info.tunables,
    });
  }

  get isEnded(): boolean {
    return this.ended;
  }

  private push(rec: Record<string, unknown>): void {
    const { type, t, wave, ...rest } = rec;
    this.buf.push(JSON.stringify({ run_id: this.runId, t, wave, type, ...rest }));
  }

  /** Keys the sim received in the step it just ran. */
  inputs(inputs: readonly SimInput[]): void {
    if (this.ended || inputs.length === 0) return;
    this.push({ type: "inputs", t: this.sim.tMs, wave: this.sim.wave, step: this.sim.stepCount, keys: encodeInputs(inputs) });
  }

  events(evs: readonly SimEvent[]): void {
    if (this.ended) return;
    let waveEnded = false;
    for (const e of evs) {
      if (SKIP.has(e.type)) continue;
      const rec: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(e)) rec[snake(k)] = v;
      this.push(rec);
      if (e.type === "wave_end") waveEnded = true;
    }
    if (waveEnded) void this.flush();
  }

  pause(reason: string): void {
    if (this.ended) return;
    this.push({ type: "pause", t: this.sim.tMs, wave: this.sim.wave, reason });
    void this.flush();
  }

  resume(reason: string): void {
    if (this.ended) return;
    this.push({ type: "resume", t: this.sim.tMs, wave: this.sim.wave, reason });
  }

  private endRecord(reason: "death" | "quit"): void {
    const s = this.sim;
    const sc = s.scoring;
    this.push({
      type: "run_end",
      t: s.tMs,
      wave: s.wave,
      reason,
      step: s.stepCount,
      score: sc.score,
      accuracy: sc.accuracy,
      wpm: s.wpm,
      longest_streak: sc.longestStreak,
      correct: sc.correct,
      errors: sc.errors,
      missed_letters: sc.missedLetters,
      airstrikes_left: s.empsLeft,
    });
    this.ended = true;
  }

  /** Finish the run and write everything out. */
  end(reason: "death" | "quit"): Promise<void> {
    if (this.ended) return this.writing;
    this.endRecord(reason);
    return this.flush();
  }

  /** Finish during page close: one synchronous best-effort write. */
  endNow(reason: "death" | "quit"): void {
    if (this.ended) return;
    this.endRecord(reason);
    const text = this.take();
    if (text) this.sink.writeNow(this.file, text);
  }

  private take(): string {
    if (!this.buf.length) return "";
    const text = this.buf.join("\n") + "\n";
    this.buf = [];
    return text;
  }

  /** Writes go out in order, one at a time. */
  flush(): Promise<void> {
    const text = this.take();
    if (!text) return this.writing;
    this.writing = this.writing
      .then(() => this.sink.write(this.file, text))
      .catch((err) => console.error("log write failed", err));
    return this.writing;
  }
}

/** FNV-1a of a word list, so a replay can tell whether the words changed. */
export function wordsHash(words: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const w of words) {
    for (let i = 0; i < w.length; i++) {
      h ^= w.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 10;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
