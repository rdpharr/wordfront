/**
 * Writes latest.json, the file installed copies of Wordfront read to find an update
 * (plugins.updater in src-tauri/tauri.conf.json), from the release's .sig files.
 *
 *   npx tsx tools/updater_manifest.ts <folder of .sig files> <owner/repo> <tag> > latest.json
 *
 * The release workflow runs it once after every build has uploaded, rather than letting
 * tauri-action merge latest.json from four parallel jobs, which can drop entries.
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

export interface Signed {
  /** the asset the signature is for, e.g. Wordfront_0.2.0_x64-setup.exe */
  asset: string;
  /** contents of its .sig file */
  signature: string;
}

interface Entry {
  url: string;
  signature: string;
}

export interface Manifest {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<string, Entry>;
}

function archOf(name: string): string | null {
  if (/aarch64|arm64/.test(name)) return "aarch64";
  if (/x86_64|x64|amd64/.test(name)) return "x86_64";
  return null;
}

/** The updater's keys for an asset: `{os}-{arch}-{installer}`, and `{os}-{arch}` for the
 *  one each OS falls back to. */
export function platformKeys(asset: string): string[] {
  const arch = archOf(asset);
  if (!arch) throw new Error(`can't tell the architecture of ${asset}`);
  if (asset.endsWith(".app.tar.gz")) return [`darwin-${arch}-app`, `darwin-${arch}`];
  if (asset.endsWith("-setup.exe")) return [`windows-${arch}-nsis`, `windows-${arch}`];
  if (asset.endsWith(".msi")) return [`windows-${arch}-msi`];
  if (asset.endsWith(".AppImage")) return [`linux-${arch}-appimage`, `linux-${arch}`];
  if (asset.endsWith(".deb")) return [`linux-${arch}-deb`];
  if (asset.endsWith(".rpm")) return [`linux-${arch}-rpm`];
  throw new Error(`not an update bundle: ${asset}`);
}

export function buildManifest(signed: Signed[], repo: string, tag: string, now: Date): Manifest {
  const platforms: Record<string, Entry> = {};
  for (const { asset, signature } of signed) {
    const url = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`;
    for (const key of platformKeys(asset)) {
      if (platforms[key]) throw new Error(`two bundles for ${key}: ${asset} and ${platforms[key].url}`);
      platforms[key] = { url, signature: signature.trim() };
    }
  }
  for (const os of ["windows", "darwin", "linux"]) {
    if (!Object.keys(platforms).some((k) => k.startsWith(`${os}-`))) throw new Error(`no update bundle for ${os}`);
  }
  return {
    version: tag.replace(/^v/, ""),
    notes: `https://github.com/${repo}/releases/tag/${tag}`,
    pub_date: now.toISOString(),
    platforms,
  };
}

function main(argv: string[]): void {
  const [dir, repo, tag] = argv;
  if (!dir || !repo || !tag) throw new Error("usage: updater_manifest.ts <sig folder> <owner/repo> <tag>");
  const signed = readdirSync(dir)
    .filter((f) => f.endsWith(".sig"))
    .map((f) => ({ asset: basename(f, ".sig"), signature: readFileSync(join(dir, f), "utf8") }));
  process.stdout.write(JSON.stringify(buildManifest(signed, repo, tag, new Date()), null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
