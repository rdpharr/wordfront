/**
 * Settings and high scores, kept in save.json in the app data folder (see
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

export interface HighScore {
  name: string;
  score: number;
  wave: number;
  accuracy: number;
  wpm: number;
  longestStreak: number;
  date: string;
}

export interface SaveData {
  version: 1;
  settings: Settings;
  scores: HighScore[];
}

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

const MAX_SCORES = 10;

/** Parse save.json (or nothing), filling in anything missing; a corrupt file starts fresh. */
export function parseSave(raw: string | null): SaveData {
  try {
    if (raw) {
      const d = JSON.parse(raw) as Partial<SaveData>;
      return {
        version: 1,
        settings: { ...DEFAULT_SETTINGS, ...(d.settings ?? {}) },
        scores: Array.isArray(d.scores) ? d.scores.slice(0, MAX_SCORES) : [],
      };
    }
  } catch {
    /* corrupt save: start fresh */
  }
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, scores: [] };
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

/** Would this score make the top 10? */
export function qualifies(scores: readonly HighScore[], score: number): boolean {
  if (score <= 0) return false;
  return scores.length < MAX_SCORES || score > scores[scores.length - 1]!.score;
}

/** Insert a score; returns the new list and the entry's index (or -1). */
export function insertScore(scores: readonly HighScore[], hs: HighScore): { scores: HighScore[]; index: number } {
  const list = [...scores, hs].sort((a, b) => b.score - a.score).slice(0, MAX_SCORES);
  return { scores: list, index: list.indexOf(hs) };
}

export function bestScore(scores: readonly HighScore[]): number {
  return scores.reduce((m, s) => Math.max(m, s.score), 0);
}
