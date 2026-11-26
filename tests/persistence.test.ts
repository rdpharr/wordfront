import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendLog, pruneLogs, readSave, writeSave } from "../dev/datastore";
import { DEFAULT_SETTINGS, parseSave, Saver, type SaveData } from "../src/app/storage";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wordfront-test-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("save file", () => {
  it("round-trips through an atomic write and leaves no temp files", () => {
    expect(readSave(dir)).toBeNull();
    writeSave(JSON.stringify({ version: 1, scores: [], settings: {} }), dir);
    writeSave(JSON.stringify({ version: 1, scores: [{ name: "A" }], settings: {} }), dir);
    expect(JSON.parse(readSave(dir)!).scores).toEqual([{ name: "A" }]);
    expect(fs.readdirSync(dir)).toEqual(["save.json"]);
  });

  it("refuses to write something that isn't JSON", () => {
    expect(() => writeSave("{nope", dir)).toThrow();
    expect(readSave(dir)).toBeNull();
  });

  it("fills in missing settings and survives a corrupt file", () => {
    const d = parseSave(JSON.stringify({ settings: { musicVolume: 0.2 }, scores: [] }));
    expect(d.settings).toEqual({ ...DEFAULT_SETTINGS, musicVolume: 0.2 });
    expect(parseSave("{garbage").history).toEqual([]);
    expect(parseSave(null).settings).toEqual(DEFAULT_SETTINGS);
  });

  it("writes one save at a time and coalesces bursts to the latest state", async () => {
    const writes: string[] = [];
    let release!: () => void;
    const saver = new Saver(async (json) => {
      writes.push(json);
      if (writes.length === 1) await new Promise<void>((r) => (release = r));
    });
    const d = (v: number): SaveData => ({ ...parseSave(null), settings: { ...DEFAULT_SETTINGS, sfxVolume: v } });
    const p = saver.save(d(0.1));
    void saver.save(d(0.2));
    void saver.save(d(0.3));
    release();
    await p;
    expect(writes.map((w) => JSON.parse(w).settings.sfxVolume)).toEqual([0.1, 0.3]);
  });
});

describe("log files", () => {
  const log = (name: string, bytes: number) => appendLog(name, "x".repeat(bytes), dir);

  it("appends to run files and rejects unsafe names", () => {
    appendLog("run-20261125-101500-ab12.jsonl", "a\n", dir);
    appendLog("run-20261125-101500-ab12.jsonl", "b\n", dir);
    expect(fs.readFileSync(path.join(dir, "logs", "run-20261125-101500-ab12.jsonl"), "utf8")).toBe("a\nb\n");
    expect(() => appendLog("../save.json", "x", dir)).toThrow();
    expect(() => appendLog("run-1.jsonl", "x", dir)).toThrow();
  });

  it("prunes the oldest runs beyond the run count or the byte budget", () => {
    for (let i = 0; i < 5; i++) log(`run-2026112${i}-000000.jsonl`, 100);
    expect(pruneLogs(3, 1e9, dir)).toBe(2);
    expect(fs.readdirSync(path.join(dir, "logs")).sort()).toEqual([
      "run-20261122-000000.jsonl",
      "run-20261123-000000.jsonl",
      "run-20261124-000000.jsonl",
    ]);
    expect(pruneLogs(10, 250, dir)).toBe(1); // newest two fit in 250 bytes
    expect(fs.readdirSync(path.join(dir, "logs")).length).toBe(2);
  });
});
