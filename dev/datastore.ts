/**
 * The game's data folder on disk (%APPDATA%/Wordfront): save.json and logs/.
 * Used by the Vite dev server so browser runs persist exactly where the desktop
 * build does; the desktop build has the same operations in Rust (src-tauri).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function dataDir(): string {
  if (process.env.WORDFRONT_DATA_DIR) return process.env.WORDFRONT_DATA_DIR;
  const base = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  return path.join(base, "Wordfront");
}

const SAFE_LOG = /^run-\d{8}-\d{6}(-[0-9a-f]{4})?\.jsonl$/;

export function readSave(dir = dataDir()): string | null {
  try {
    return fs.readFileSync(path.join(dir, "save.json"), "utf8");
  } catch {
    return null;
  }
}

/** Atomic: write a temp file, then rename over the old one. */
export function writeSave(json: string, dir = dataDir()): void {
  JSON.parse(json); // refuse to write something that isn't JSON
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `save.json.${process.pid}.tmp`);
  fs.writeFileSync(tmp, json, "utf8");
  fs.renameSync(tmp, path.join(dir, "save.json"));
}

export function appendLog(file: string, lines: string, dir = dataDir()): void {
  if (!SAFE_LOG.test(file)) throw new Error(`bad log file name: ${file}`);
  const logs = path.join(dir, "logs");
  fs.mkdirSync(logs, { recursive: true });
  fs.appendFileSync(path.join(logs, file), lines, "utf8");
}

/**
 * The first and last line of every run log, oldest first: the run_start and (for a
 * finished run) the run_end, enough to rebuild run history without reading the rest.
 */
export function logEnds(dir = dataDir()): string {
  const logs = path.join(dir, "logs");
  if (!fs.existsSync(logs)) return "";
  let out = "";
  for (const f of fs.readdirSync(logs).filter((x) => SAFE_LOG.test(x)).sort()) {
    const lines = fs.readFileSync(path.join(logs, f), "utf8").split(/\r?\n/).filter((l) => l.trim());
    if (lines.length > 0) out += lines[0] + "\n";
    if (lines.length > 1) out += lines[lines.length - 1] + "\n";
  }
  return out;
}

/** Delete the oldest run logs beyond maxRuns files or maxBytes in total. */
export function pruneLogs(maxRuns: number, maxBytes: number, dir = dataDir()): number {
  const logs = path.join(dir, "logs");
  if (!fs.existsSync(logs)) return 0;
  const files = fs
    .readdirSync(logs)
    .filter((f) => SAFE_LOG.test(f))
    .map((f) => ({ f, size: fs.statSync(path.join(logs, f)).size }))
    .sort((a, b) => b.f.localeCompare(a.f)); // newest first (names are timestamps)
  let total = 0;
  let removed = 0;
  files.forEach((x, i) => {
    total += x.size;
    if (i >= maxRuns || total > maxBytes) {
      fs.unlinkSync(path.join(logs, x.f));
      removed++;
    }
  });
  return removed;
}
