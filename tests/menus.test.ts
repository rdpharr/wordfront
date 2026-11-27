import { describe, expect, it } from "vitest";
import { resolveConfig, rawConfig } from "../src/core/config";
import { bugReportUrl, checkForUpdate, isNewer, parseVersion, RELEASES, REPO } from "../src/app/links";
import { aboutHtml, helpHtml, resetConfirmHtml } from "../src/app/screens";
import { parseSave, resetHistory } from "../src/app/storage";
import type { Platform } from "../src/app/platform";

const platform = (kind: Platform["kind"]) => ({ kind }) as Platform;

describe("version check", () => {
  it("reads plain x.y.z versions, with or without a v", () => {
    expect(parseVersion("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion("0.10.0")).toEqual([0, 10, 0]);
    expect(parseVersion("v1.2")).toBeNull();
    expect(parseVersion("v1.2.3-beta")).toBeNull();
  });

  it("compares numerically, part by part", () => {
    expect(isNewer("v0.10.0", "0.9.9")).toBe(true);
    expect(isNewer("v1.0.0", "0.99.99")).toBe(true);
    expect(isNewer("v0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("v0.0.9", "0.1.0")).toBe(false);
    expect(isNewer("nightly", "0.1.0")).toBe(false);
  });

  const reply = (status: number, body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("reports a newer GitHub release, and nothing otherwise", async () => {
    const url = `${REPO}/releases/tag/v0.2.0`;
    expect(await checkForUpdate("0.1.0", reply(200, { tag_name: "v0.2.0", html_url: url }))).toEqual({ version: "0.2.0", url });
    expect(await checkForUpdate("0.2.0", reply(200, { tag_name: "v0.2.0", html_url: url }))).toBeNull();
    expect(await checkForUpdate("0.1.0", reply(404, { message: "Not Found" }))).toBeNull(); // no releases yet
    expect(await checkForUpdate("0.1.0", reply(200, { nonsense: true }))).toBeNull();
  });

  it("only links to the project's own release pages", async () => {
    const u = await checkForUpdate("0.1.0", reply(200, { tag_name: "v0.2.0", html_url: "https://evil.example/x" }));
    expect(u).toEqual({ version: "0.2.0", url: RELEASES });
  });

  it("treats a failed or hung request as no update", async () => {
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await checkForUpdate("0.1.0", offline)).toBeNull();
    const hang = ((_: unknown, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
    expect(await checkForUpdate("0.1.0", hang, 20)).toBeNull();
  });

  it("fills the version into bug reports", () => {
    const u = new URL(bugReportUrl("0.1.0", "desktop"));
    expect(u.origin + u.pathname).toBe(`${REPO}/issues/new`);
    expect(u.searchParams.get("body")).toContain("Wordfront 0.1.0 (desktop)");
  });
});

describe("reset history", () => {
  it("empties the history but keeps settings, and won't re-import the logs", () => {
    const d = parseSave(
      JSON.stringify({
        settings: { muted: true },
        history: [{ at: "2026-11-25T10:00:00.000Z", score: 10, wave: 2, accuracy: 0.9, wpm: 20, longestStreak: 5 }],
        helpSeen: true,
      }),
    );
    const r = resetHistory(d);
    expect(r.history).toEqual([]);
    expect(r.logsImported).toBe(true);
    expect(r.settings.muted).toBe(true);
    expect(r.helpSeen).toBe(true);
    // and it survives a save and load
    expect(parseSave(JSON.stringify(r))).toMatchObject({ history: [], logsImported: true, helpSeen: true });
  });

  it("asks before erasing, and says how many runs go", () => {
    expect(resetConfirmHtml(1, true)).toContain("all 1 run from");
    expect(resetConfirmHtml(12, false)).toContain("all 12 runs from");
    expect(resetConfirmHtml(12, false)).not.toContain("logs");
  });
});

describe("menu screens", () => {
  it("help quotes the tuned numbers", () => {
    const html = helpHtml(resolveConfig());
    expect(html).toContain("You start with 3");
    expect(html).toContain("12 words, then 16, 20");
    expect(html).toContain("20 in a row scores ×2");
  });

  it("help follows a retune: a flat refill cost, or none", () => {
    const flat = structuredClone(rawConfig);
    flat.emp.refillStep = 0;
    expect(helpHtml(resolveConfig(flat))).toContain("every 12 words you finish");
    const off = structuredClone(rawConfig);
    off.emp.refillStart = 0;
    expect(helpHtml(resolveConfig(off))).not.toContain("Earn one back");
  });

  it("About credits the word list's CC BY-SA sources", () => {
    const html = aboutHtml("0.1.0", platform("desktop"));
    for (const s of ["wordfreq", "Robyn Speer", "SCOWL", "CC BY-SA 4.0", "Version 0.1.0"]) expect(html).toContain(s);
    expect(html).not.toContain("offline version");
    expect(aboutHtml("0.1.0", platform("browser"))).toContain("Get the offline version");
  });
});
