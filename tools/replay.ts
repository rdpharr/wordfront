/**
 * Replay a logged run and check it reproduces the same result.
 *
 *   npx tsx tools/replay.ts "%APPDATA%/Wordfront/logs/run-20261125-101500-ab12.jsonl"
 *
 * Exits 1 if the replay doesn't match the log.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLog, replayRun } from "../src/core/replay";
import { WordBank } from "../src/core/words";

const file = process.argv[2];
if (!file) {
  console.error("usage: npx tsx tools/replay.ts <run.jsonl>");
  process.exit(2);
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const words = fs.readFileSync(path.join(root, "src", "words.txt"), "utf8").split(/\s+/).filter(Boolean);
const result = replayRun(parseLog(fs.readFileSync(file, "utf8")), new WordBank(words), words);

for (const w of result.warnings) console.warn(`warning: ${w}`);
console.log("            recorded  replayed");
for (const k of Object.keys(result.recorded) as (keyof typeof result.recorded)[]) {
  const a = result.recorded[k];
  const b = result.replayed[k];
  console.log(`${k.padEnd(14)}${String(a).padStart(8)}  ${String(b).padStart(8)}${a === b ? "" : "   <-- differs"}`);
}
console.log(result.matches ? "replay matches" : "REPLAY DOES NOT MATCH");
process.exit(result.matches ? 0 : 1);
