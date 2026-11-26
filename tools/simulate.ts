/**
 * Simulate runs by bot typists of varying skill and write them as gameplay logs,
 * the same format the game writes. Useful for testing the analysis script and for
 * a first look at how a tuning change shifts difficulty.
 *
 *   npx tsx tools/simulate.ts --runs 40 --out sim-logs
 *   uv run --with duckdb tools/analyze.py sim-logs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configHash, rawConfig, resolveConfig } from "../src/core/config";
import { Rng } from "../src/core/rng";
import { RunLogger, wordsHash } from "../src/core/runlog";
import { Sim } from "../src/core/sim";
import type { SimInput } from "../src/core/types";
import { WordBank } from "../src/core/words";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ""), process.argv[i + 1] ?? "");
const runs = Number(args.get("runs") ?? 30);
const out = path.resolve(args.get("out") ?? "sim-logs");
const seed0 = Number(args.get("seed") ?? 1);

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const words = fs.readFileSync(path.join(root, "src", "words.txt"), "utf8").split(/\s+/).filter(Boolean);
const bank = new WordBank(words);
const cfg = resolveConfig();
const info = { build: "sim", configHash: configHash(rawConfig), wordsHash: wordsHash(words), tunables: rawConfig };

fs.mkdirSync(path.join(out, "logs"), { recursive: true });
const sink = {
  write: async (f: string, t: string) => fs.appendFileSync(path.join(out, "logs", f), t),
  writeNow: (f: string, t: string) => fs.appendFileSync(path.join(out, "logs", f), t),
};

const rng = new Rng(seed0);
const start = new Date(2026, 0, 1, 9, 0, 0).getTime();

for (let r = 0; r < runs; r++) {
  // typists from ~25 to ~90 WPM, missing 2-12% of letters
  const wpm = rng.range(25, 90);
  const missRate = rng.range(0.02, 0.12);
  const stepsPerLetter = Math.max(2, Math.round(60 / ((wpm * 5) / 60)));
  const sim = new Sim(cfg, bank, (seed0 * 7919 + r * 104729) >>> 0);
  const log = new RunLogger(sink, sim, info, new Date(start + r * 7 * 60_000));
  let wait = stepsPerLetter;
  const maxSteps = 60 * 60 * 30;
  for (let i = 0; i < maxSteps && sim.phase !== "over"; i++) {
    const inputs: SimInput[] = [];
    if (--wait <= 0) {
      wait = Math.max(1, Math.round(stepsPerLetter * rng.range(0.6, 1.5)));
      const live = sim.enemies.filter((e) => !e.dying);
      const target = sim.lockTarget ?? live.sort((a, b) => sim.edgeDist(a) - sim.edgeDist(b))[0];
      if (target) {
        const want = target.word[target.typed]!;
        const ch = rng.next() < missRate ? "abcdefghijklmnopqrstuvwxyz"[rng.int(0, 25)]! : want;
        inputs.push({ kind: "char", ch });
      }
      // panic button: airstrike when something is about to reach the squad
      if (sim.empsLeft > 0 && !sim.emp && live.some((e) => sim.edgeDist(e) < 25 && e.word.length - e.typed > 2))
        inputs.push({ kind: "emp" });
    }
    const evs = sim.step(inputs);
    log.inputs(inputs);
    log.events(evs);
  }
  await log.end(sim.phase === "over" ? "death" : "quit");
  console.log(`${log.file}  ${wpm.toFixed(0).padStart(3)} wpm  wave ${String(sim.wave).padStart(2)}  score ${sim.scoring.score}`);
}
console.log(`wrote ${runs} runs to ${path.join(out, "logs")}`);
