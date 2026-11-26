import { resolveConfig, rawConfig, type RawConfig } from "../src/core/config";
import { Sim } from "../src/core/sim";
import type { SimEvent, SimInput } from "../src/core/types";
import { WordBank } from "../src/core/words";
import { WORDS } from "../src/core/wordlist";

export const cfg = resolveConfig();
export const bank = new WordBank(WORDS);

export function newSim(seed = 1, raw: RawConfig = rawConfig): Sim {
  return new Sim(resolveConfig(raw), bank, seed);
}

/**
 * A sim with the wave's spawn queue emptied, for hand-placed enemies. Add enemies
 * before the first step, or the empty wave ends straight away.
 */
export function emptySim(seed = 1): Sim {
  const s = newSim(seed);
  s.queue = [];
  return s;
}

export const chars = (s: string): SimInput[] => s.split("").map((ch) => ({ kind: "char", ch }));

export function typeEach(sim: Sim, s: string): SimEvent[] {
  const out: SimEvent[] = [];
  for (const inp of chars(s)) out.push(...sim.step([inp]));
  return out;
}

export function stepN(sim: Sim, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...sim.step());
  return out;
}

/**
 * A simple typist: one correct letter every `every` steps (12 steps = 5 letters/s
 * = 60 WPM at 60 Hz), aiming at the nearest enemy. Optionally fumbles a letter
 * every `missEvery` keystrokes.
 */
export function botInputs(sim: Sim, every: number, missEvery = 0, counter = { n: 0 }): SimInput[] {
  if (sim.stepCount % every !== 0) return [];
  const lock = sim.lockTarget;
  let target = lock;
  if (!target) {
    const live = sim.enemies.filter((e) => !e.dying);
    if (!live.length) return [];
    target = live.reduce((a, b) => (sim.dist(a) <= sim.dist(b) ? a : b));
  }
  counter.n++;
  if (missEvery && counter.n % missEvery === 0) return [{ kind: "char", ch: "q" === target.word[target.typed] ? "z" : "q" }];
  return [{ kind: "char", ch: target.word[target.typed]! }];
}

/** Run a bot until game over or maxSteps; returns the recorded inputs and all events. */
export function runBot(sim: Sim, every: number, maxSteps: number, missEvery = 0) {
  const recorded: { step: number; inputs: SimInput[] }[] = [];
  const events: SimEvent[] = [];
  const counter = { n: 0 };
  for (let i = 0; i < maxSteps && sim.phase !== "over"; i++) {
    const inputs = botInputs(sim, every, missEvery, counter);
    if (inputs.length) recorded.push({ step: sim.stepCount, inputs });
    events.push(...sim.step(inputs));
  }
  return { recorded, events };
}
