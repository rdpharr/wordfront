// Review gate: no commit without a code review of exactly what's being committed.
//
// As a Claude Code PreToolUse hook (Bash/PowerShell), it reads the tool call on stdin and,
// when the command runs `git commit`, blocks it (exit 2) unless every uncommitted file in
// the repo (staged, unstaged and untracked) is byte-for-byte what was recorded after the
// last /code-review. Editing anything after the review means reviewing again.
//
//   node .claude/hooks/review-gate.mjs --record   after /code-review (and its fixes): record the
//                                                 current uncommitted state as reviewed
//   node .claude/hooks/review-gate.mjs --status   list files not covered by the record
//
// The record lives inside .git (git rev-parse --git-path claude-review.json), never committed.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DELETED = "deleted";
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function git(cwd, args, input) {
  return execFileSync("git", args, { cwd, input, encoding: "utf8", maxBuffer: 256 << 20, stdio: ["pipe", "pipe", "pipe"] });
}
const split0 = (s) => s.split("\0").filter(Boolean);

function hasHead(root) {
  try {
    git(root, ["rev-parse", "--verify", "-q", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

/** path -> blob for every entry of `git ls-files -s` / `git ls-tree -r` output (no pathspec: argv stays short) */
function blobMap(text, re) {
  const out = new Map();
  for (const entry of split0(text)) {
    const m = re.exec(entry);
    if (m) out.set(m[2], m[1]);
  }
  return out;
}

/** Every path with an uncommitted change, mapped to [working-tree blob, index blob] ("deleted" if absent). */
function snapshot(root) {
  const base = hasHead(root) ? "HEAD" : EMPTY_TREE;
  const paths = new Set([
    ...split0(git(root, ["diff", base, "--name-only", "--no-renames", "-z"])),
    ...split0(git(root, ["diff", "--cached", base, "--name-only", "--no-renames", "-z"])),
    ...split0(git(root, ["ls-files", "--others", "--exclude-standard", "-z"])),
  ]);
  const list = [...paths].sort();
  const snap = {};
  if (list.length === 0) return snap;

  const working = new Map();
  const files = [];
  for (const p of list) {
    const st = fs.lstatSync(path.join(root, p), { throwIfNoEntry: false });
    if (!st) continue; // deleted
    if (st.isSymbolicLink()) {
      // git stores a symlink as a blob of its target text
      const target = Buffer.from(fs.readlinkSync(path.join(root, p)));
      working.set(p, createHash("sha1").update(`blob ${target.length}\0`).update(target).digest("hex"));
    } else if (st.isFile()) files.push(p);
    else working.set(p, "dir"); // e.g. a submodule checkout
  }
  // hash-object applies the same clean filters (e.g. autocrlf) as `git add`, so blobs compare with the index
  if (files.length) {
    const hashes = git(root, ["hash-object", "--stdin-paths"], files.join("\n") + "\n").trim().split(/\r?\n/);
    files.forEach((p, i) => working.set(p, hashes[i]));
  }

  const staged = blobMap(git(root, ["ls-files", "-s", "-z"]), /^\d+ ([0-9a-f]+) \d+\t(.*)$/s);
  for (const p of list) snap[p] = [working.get(p) ?? DELETED, staged.get(p) ?? DELETED];
  return snap;
}

function headBlobs(root) {
  if (!hasHead(root)) return new Map();
  return blobMap(git(root, ["ls-tree", "-r", "-z", "HEAD"]), /^\d+ \w+ ([0-9a-f]+)\t(.*)$/s);
}

function recordPath(root) {
  return path.resolve(root, git(root, ["rev-parse", "--git-path", "claude-review.json"]).trim());
}

/** Paths whose current working-tree or staged content wasn't reviewed. */
function unreviewed(root) {
  let rec = {};
  try {
    rec = JSON.parse(fs.readFileSync(recordPath(root), "utf8")).files ?? {};
  } catch {}
  const snap = snapshot(root);
  const head = headBlobs(root);
  return Object.entries(snap)
    .filter(([p, [work, stage]]) => {
      const ok = new Set(rec[p] ?? []);
      const stageOk = ok.has(stage) || stage === (head.get(p) ?? DELETED); // index untouched for this path
      return !ok.has(work) || !stageOk;
    })
    .map(([p]) => p);
}

/** Split a shell command into segments of words, honouring quotes; ; & | ( ) and newlines separate. */
function segments(command) {
  const segs = [[]];
  let word = "";
  let inWord = false;
  let quote = null;
  const endWord = () => {
    if (inWord) segs[segs.length - 1].push(word);
    word = "";
    inWord = false;
  };
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null;
      else word += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      inWord = true;
    } else if (/\s/.test(ch) && ch !== "\n") endWord();
    else if (";&|()\n`".includes(ch)) {
      endWord();
      segs.push([]);
    } else {
      word += ch;
      inWord = true;
    }
  }
  endWord();
  return segs;
}

// git's global options that take their value as the next word
const VALUE_OPTS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env", "--exec-path"]);

/** Does the command run `git ... commit` (any spelling of git, any global options before it)? */
function runsCommit(command) {
  for (const words of segments(command)) {
    for (let i = 0; i < words.length; i++) {
      if (!/^(.*[\/\\])?git(\.exe)?$/i.test(words[i])) continue;
      let j = i + 1;
      while (j < words.length && words[j].startsWith("-")) j += VALUE_OPTS.has(words[j]) ? 2 : 1;
      if (words[j] === "commit") return true;
    }
  }
  return false;
}

function hook() {
  let command = "";
  let cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    const input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
    command = String(input?.tool_input?.command ?? "");
    if (input?.cwd) cwd = input.cwd;
  } catch {
    return; // no tool call to judge
  }
  let bad;
  try {
    if (!runsCommit(command)) return;
    bad = unreviewed(git(cwd, ["rev-parse", "--show-toplevel"]).trim());
  } catch (err) {
    // fail closed: if a commit might be involved and we can't check, don't let it through
    if (/\bcommit\b/.test(command)) {
      process.stderr.write(`Review gate couldn't check the changes (${String(err?.message ?? err).split("\n")[0]}), so the commit is blocked.\n`);
      process.exit(2);
    }
    return;
  }
  if (bad.length === 0) return;
  const shown = bad.slice(0, 15).map((p) => `  ${p}`).join("\n") + (bad.length > 15 ? `\n  …and ${bad.length - 15} more` : "");
  process.stderr.write(
    `Commit blocked: code review required first. ${bad.length} uncommitted file(s) changed since the last review:\n${shown}\n` +
      `Run the /code-review skill on the pending changes, fix what it finds, then record the review with\n` +
      `  node .claude/hooks/review-gate.mjs --record\n` +
      `and commit again. Any edit after recording needs a new review.\n`,
  );
  process.exit(2);
}

const arg = process.argv[2];
if (arg === "--record" || arg === "--status") {
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  if (arg === "--record") {
    const files = Object.fromEntries(Object.entries(snapshot(root)).map(([p, blobs]) => [p, [...new Set(blobs)]]));
    fs.writeFileSync(recordPath(root), JSON.stringify({ reviewedAt: new Date().toISOString(), files }, null, 1));
    console.log(`Recorded review of ${Object.keys(files).length} uncommitted file(s).`);
  } else {
    const bad = unreviewed(root);
    console.log(bad.length ? `Not reviewed:\n  ${bad.join("\n  ")}` : "All uncommitted changes are reviewed.");
  }
} else if (arg === "--test-detect") {
  // for checking the commit detection by hand: prints true/false
  console.log(runsCommit(process.argv.slice(3).join(" ")));
} else hook();
