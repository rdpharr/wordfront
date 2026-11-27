// package.json holds Wordfront's version. tauri.conf.json reads it from there; this
// copies it into src-tauri/Cargo.toml and Cargo.lock so the Rust crate matches.
// Runs on `npm version <x.y.z>` (the "version" script), or by hand:
//   node tools/sync_version.mjs          write the version
//   node tools/sync_version.mjs --check  fail if a file disagrees (for CI)
import fs from "node:fs";

const check = process.argv.includes("--check");
const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`bad version in package.json: ${version}`);

const files = [
  // the first `version = ` line in Cargo.toml is the [package] one
  ["src-tauri/Cargo.toml", /^(version = ")[^"]*(")/m],
  // the lock entry for the wordfront package itself
  ["src-tauri/Cargo.lock", /(\nname = "wordfront"\nversion = ")[^"]*(")/],
];

let stale = 0;
for (const [file, re] of files) {
  const text = fs.readFileSync(file, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lf = text.replace(/\r\n/g, "\n");
  if (!re.test(lf)) throw new Error(`no version line found in ${file}`);
  const next = lf.replace(re, `$1${version}$2`);
  if (next === lf) continue;
  stale++;
  if (check) console.error(`${file} doesn't match package.json (${version})`);
  else {
    fs.writeFileSync(file, next.replace(/\n/g, eol));
    console.log(`${file} -> ${version}`);
  }
}
if (check && stale) process.exit(1);
