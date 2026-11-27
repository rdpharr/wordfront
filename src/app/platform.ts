/**
 * Where the game keeps its data. Same operations everywhere:
 * - desktop build (Tauri): Rust commands writing the per-user data folder (e.g. %APPDATA%/Wordfront)
 * - dev server: /__wf endpoints writing the same folder
 * - a plain browser (e.g. the built page opened directly): localStorage, no logs
 */
export interface Platform {
  kind: "desktop" | "dev" | "browser";
  loadSave(): Promise<string | null>;
  /** atomic replace of save.json */
  writeSave(json: string): Promise<void>;
  appendLog(file: string, lines: string): Promise<void>;
  /** best effort, for when the page is closing */
  appendLogNow(file: string, lines: string): void;
  pruneLogs(maxRuns: number, maxBytes: number): Promise<void>;
  /** First and last line of every run log (JSONL), oldest first; "" where there are no logs. */
  logEnds(): Promise<string>;
  quit(): void;
  /** Open one of the project's links (links.ts) in the system browser or a new tab. */
  openUrl(url: string): void;
  toggleFullscreen(): void;
  /** Desktop: download and install the latest release, then restart into it. Resolves
   *  false when there's nothing this build can install itself; rejects when it fails. */
  installUpdate(): Promise<boolean>;
  /** Desktop only: run `finish` before the window closes (the page is told first). */
  onCloseRequested(finish: () => Promise<void>): void;
}

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

interface TauriGlobal {
  core: { invoke: Invoke };
  event: { listen: (name: string, cb: () => void) => Promise<unknown> };
}

const LS_KEY = "wordfront.save";

function desktop(tauri: TauriGlobal): Platform {
  const invoke = tauri.core.invoke;
  return {
    kind: "desktop",
    loadSave: async () => ((await invoke("load_save")) as string | null) ?? null,
    writeSave: async (json) => void (await invoke("write_save", { json })),
    appendLog: async (file, lines) => void (await invoke("append_log", { file, lines })),
    appendLogNow: (file, lines) => void invoke("append_log", { file, lines }),
    pruneLogs: async (maxRuns, maxBytes) => void (await invoke("prune_logs", { maxRuns, maxBytes })),
    logEnds: async () => (await invoke("log_ends")) as string,
    quit: () => void invoke("quit"),
    openUrl: (url) => void invoke("open_link", { url }).catch((err) => console.error("couldn't open link", err)),
    toggleFullscreen: () => void invoke("toggle_fullscreen").catch((err) => console.error(err)),
    installUpdate: async () => (await invoke("install_update")) as boolean,
    onCloseRequested: (finish) => {
      void tauri.event.listen("wf-close-requested", () => {
        finish()
          .catch((err) => console.error(err))
          .finally(() => void invoke("quit"));
      });
    },
  };
}

const openInTab = (url: string) => void window.open(url, "_blank", "noopener,noreferrer");

function pageFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen().catch(() => {});
}

function dev(): Platform {
  const ok = (r: Response) => {
    if (!r.ok) throw new Error(`${r.url}: ${r.status}`);
    return r;
  };
  return {
    kind: "dev",
    loadSave: async () => {
      const r = ok(await fetch("/__wf/save"));
      if (r.status === 204) return localStorage.getItem(LS_KEY); // first run: bring over an old browser save
      return r.text();
    },
    writeSave: async (json) => void ok(await fetch("/__wf/save", { method: "PUT", body: json })),
    appendLog: async (file, lines) =>
      void ok(await fetch(`/__wf/log?file=${encodeURIComponent(file)}`, { method: "POST", body: lines })),
    appendLogNow: (file, lines) => void navigator.sendBeacon(`/__wf/log?file=${encodeURIComponent(file)}`, lines),
    pruneLogs: async (runs, bytes) => void ok(await fetch(`/__wf/prune?runs=${runs}&bytes=${bytes}`, { method: "POST" })),
    logEnds: async () => (await ok(await fetch("/__wf/log-ends")).text()),
    quit: () => window.close(),
    openUrl: openInTab,
    toggleFullscreen: pageFullscreen,
    installUpdate: async () => false,
    onCloseRequested: () => {},
  };
}

function browser(): Platform {
  return {
    kind: "browser",
    loadSave: async () => localStorage.getItem(LS_KEY),
    writeSave: async (json) => localStorage.setItem(LS_KEY, json),
    appendLog: async () => {},
    appendLogNow: () => {},
    pruneLogs: async () => {},
    logEnds: async () => "",
    quit: () => window.close(),
    openUrl: openInTab,
    toggleFullscreen: pageFullscreen,
    installUpdate: async () => false,
    onCloseRequested: () => {},
  };
}

export function detectPlatform(): Platform {
  const tauri = (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
  if (tauri) return desktop(tauri);
  if (import.meta.env.DEV) return dev();
  return browser();
}
