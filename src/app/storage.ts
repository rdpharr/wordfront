/**
 * Settings and run history, kept in save.json in the app data folder (see
 * platform.ts for where that is in each build).
 */

export interface Settings {
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  largeLabels: boolean;
  highContrast: boolean;
  reducedMotion: boolean;
  screenShake: boolean;
  logging: boolean;
}

/** One finished run, as shown on the title screen's history charts. */
export interface RunRecord {
  /** ISO timestamp the run ended */
  at: string;
  score: number;
  wave: number;
  accuracy: number;
  wpm: number;
  longestStreak: number;
}

export interface SaveData {
  version: 1;
  settings: Settings;
  /** finished runs, oldest first */
  history: RunRecord[];
}

/** The measures the history charts track; higher is better for each. */
export const RECORD_KEYS = ["score", "accuracy", "wpm", "longestStreak"] as const;
export type RecordKey = (typeof RECORD_KEYS)[number];

export const DEFAULT_SETTINGS: Settings = {
  musicVolume: 0.6,
  sfxVolume: 0.8,
  muted: false,
  largeLabels: false,
  highContrast: false,
  reducedMotion: false,
  screenShake: true,
  logging: true,
};

const MAX_HISTORY = 1000;

/** Old saves kept a top-10 list; carry those runs over as history (dated at noon). */
interface LegacyScore {
  score: number;
  wave: number;
  accuracy: number;
  wpm: number;
  longestStreak: number;
  date: string;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function cleanRun(r: Partial<RunRecord>): RunRecord | null {
  if (typeof r.at !== "string" || Number.isNaN(Date.parse(r.at))) return null;
  return {
    at: r.at,
    score: num(r.score),
    wave: num(r.wave),
    accuracy: num(r.accuracy),
    wpm: num(r.wpm),
    longestStreak: num(r.longestStreak),
  };
}

function parseHistory(d: { history?: unknown; scores?: unknown }): RunRecord[] {
  let runs: RunRecord[];
  if (Array.isArray(d.history)) {
    runs = d.history.map((r) => cleanRun(r as Partial<RunRecord>)).filter((r): r is RunRecord => r !== null);
  } else if (Array.isArray(d.scores)) {
    runs = (d.scores as Partial<LegacyScore>[])
      .map((s) => cleanRun({ ...s, at: `${s.date}T12:00:00.000Z` }))
      .filter((r): r is RunRecord => r !== null);
  } else runs = [];
  runs.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return runs.slice(-MAX_HISTORY);
}

/** Parse save.json (or nothing), filling in anything missing; a corrupt file starts fresh. */
export function parseSave(raw: string | null): SaveData {
  try {
    if (raw) {
      const d = JSON.parse(raw) as Partial<SaveData> & { scores?: unknown };
      return {
        version: 1,
        settings: { ...DEFAULT_SETTINGS, ...(d.settings ?? {}) },
        history: parseHistory(d),
      };
    }
  } catch {
    /* corrupt save: start fresh */
  }
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, history: [] };
}

/**
 * Writes saves one at a time and coalesces bursts (e.g. dragging a volume
 * slider) so only the latest state is written after the current write.
 */
export class Saver {
  private writing: Promise<void> | null = null;
  private pending: string | null = null;

  constructor(private write: (json: string) => Promise<void>) {}

  save(d: SaveData): Promise<void> {
    this.pending = JSON.stringify(d, null, 2);
    if (!this.writing) this.writing = this.drain();
    return this.writing;
  }

  /** Resolves once every queued save has been written. */
  idle(): Promise<void> {
    return this.writing ?? Promise.resolve();
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending !== null) {
        const json = this.pending;
        this.pending = null;
        try {
          await this.write(json);
        } catch (err) {
          console.error("save failed", err);
        }
      }
    } finally {
      this.writing = null;
    }
  }
}

/** Append a finished run, keeping the newest MAX_HISTORY. */
export function addRun(history: readonly RunRecord[], run: RunRecord): RunRecord[] {
  return [...history, run].slice(-MAX_HISTORY);
}

/** Best value of each measure so far (0 with no runs). */
export function bests(history: readonly RunRecord[]): Record<RecordKey, number> {
  const b = { score: 0, accuracy: 0, wpm: 0, longestStreak: 0 };
  for (const r of history) for (const k of RECORD_KEYS) b[k] = Math.max(b[k], r[k]);
  return b;
}

/**
 * Measures this run beats every earlier run on. A first run sets no records (there
 * is nothing to beat), and a zero score never counts.
 */
export function newRecords(history: readonly RunRecord[], run: RunRecord): RecordKey[] {
  if (history.length === 0 || run.score <= 0) return [];
  const b = bests(history);
  return RECORD_KEYS.filter((k) => run[k] > b[k]);
}
