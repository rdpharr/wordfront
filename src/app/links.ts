/**
 * The project's links, and the check for a newer release. The desktop build only
 * opens links that start with one of these (see open_link in src-tauri/src/main.rs).
 */
export const REPO = "https://github.com/rdpharr/wordfront";
export const RELEASES = `${REPO}/releases/latest`;
export const TIP_JAR = "https://buymeacoffee.com/rdpharr";
export const WEB_VERSION = "https://rdpharr.github.io/wordfront/";
const LATEST_API = "https://api.github.com/repos/rdpharr/wordfront/releases/latest";

/** A new issue with the version and build kind filled in. */
export function bugReportUrl(version: string, kind: string): string {
  const body = `**What happened?**\n\n\n**What did you expect?**\n\n\n---\nWordfront ${version} (${kind})`;
  return `${REPO}/issues/new?body=${encodeURIComponent(body)}`;
}

/** "v1.2.3" or "1.2.3" -> [1, 2, 3]; null if it isn't a plain x.y.z version. */
export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when `latest` is a newer x.y.z than `current`. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}

export interface Update {
  version: string;
  url: string;
}

/**
 * The latest GitHub release if it's newer than `current`, else null. Any failure
 * (offline, no releases yet, rate limit, timeout) is also null: the check is a nicety.
 */
export async function checkForUpdate(current: string, fetcher: typeof fetch = fetch, timeoutMs = 8000): Promise<Update | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetcher(LATEST_API, { headers: { Accept: "application/vnd.github+json" }, signal: ctl.signal });
    if (!r.ok) return null;
    const d = (await r.json()) as { tag_name?: unknown; html_url?: unknown };
    const tag = typeof d.tag_name === "string" ? d.tag_name : "";
    const url = typeof d.html_url === "string" && d.html_url.startsWith(`${REPO}/`) ? d.html_url : RELEASES;
    return isNewer(tag, current) ? { version: tag.replace(/^v/, ""), url } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
