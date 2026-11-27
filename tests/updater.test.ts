import { describe, expect, it } from "vitest";
import { buildManifest, platformKeys } from "../tools/updater_manifest";

// the asset names a release ends up with (tauri-action adds the arch to the macOS bundles)
const ASSETS = [
  "Wordfront_0.2.0_x64-setup.exe",
  "Wordfront_0.2.0_x64_en-US.msi",
  "Wordfront_aarch64.app.tar.gz",
  "Wordfront_x64.app.tar.gz",
  "Wordfront_0.2.0_amd64.AppImage",
  "Wordfront_0.2.0_amd64.deb",
  "Wordfront-0.2.0-1.x86_64.rpm",
];

describe("updater manifest", () => {
  it("maps each bundle to the updater's platform keys", () => {
    expect(platformKeys("Wordfront_0.2.0_x64-setup.exe")).toEqual(["windows-x86_64-nsis", "windows-x86_64"]);
    expect(platformKeys("Wordfront_0.2.0_x64_en-US.msi")).toEqual(["windows-x86_64-msi"]);
    expect(platformKeys("Wordfront_aarch64.app.tar.gz")).toEqual(["darwin-aarch64-app", "darwin-aarch64"]);
    expect(platformKeys("Wordfront_x64.app.tar.gz")).toEqual(["darwin-x86_64-app", "darwin-x86_64"]);
    expect(platformKeys("Wordfront_0.2.0_amd64.AppImage")).toEqual(["linux-x86_64-appimage", "linux-x86_64"]);
    expect(platformKeys("Wordfront_0.2.0_amd64.deb")).toEqual(["linux-x86_64-deb"]);
    expect(platformKeys("Wordfront-0.2.0-1.x86_64.rpm")).toEqual(["linux-x86_64-rpm"]);
  });

  it("refuses names it can't place", () => {
    expect(() => platformKeys("Wordfront.app.tar.gz")).toThrow(/architecture/);
    expect(() => platformKeys("Wordfront_0.2.0_x64.dmg")).toThrow(/not an update bundle/);
  });

  it("builds latest.json with release download links", () => {
    const signed = ASSETS.map((asset) => ({ asset, signature: `sig-of-${asset}\n` }));
    const m = buildManifest(signed, "rdpharr/wordfront", "v0.2.0", new Date("2026-12-01T10:00:00Z"));
    expect(m.version).toBe("0.2.0");
    expect(m.pub_date).toBe("2026-12-01T10:00:00.000Z");
    expect(Object.keys(m.platforms)).toHaveLength(11);
    expect(m.platforms["windows-x86_64"]).toEqual({
      url: "https://github.com/rdpharr/wordfront/releases/download/v0.2.0/Wordfront_0.2.0_x64-setup.exe",
      signature: "sig-of-Wordfront_0.2.0_x64-setup.exe",
    });
    expect(m.platforms["darwin-aarch64"]?.url).toMatch(/Wordfront_aarch64\.app\.tar\.gz$/);
  });

  it("fails when a platform is missing or doubled", () => {
    const sig = (asset: string) => ({ asset, signature: "s" });
    expect(() => buildManifest(ASSETS.slice(0, 2).map(sig), "r/w", "v1.0.0", new Date())).toThrow(/darwin/);
    expect(() =>
      buildManifest([...ASSETS, "Other_x64.app.tar.gz"].map(sig), "r/w", "v1.0.0", new Date()),
    ).toThrow(/two bundles for darwin-x86_64-app/);
  });
});
