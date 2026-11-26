import type { Tunables } from "./config";

export interface WaveTally {
  correct: number;
  errors: number;
}

/** Points, streak multiplier, accuracy and per-letter misses. */
export class Scoring {
  score = 0;
  streak = 0;
  longestStreak = 0;
  multiplier = 1;
  correct = 0;
  errors = 0;
  /** misses, counted against the letter the player should have typed */
  missedLetters: Record<string, number> = {};
  wave: WaveTally = { correct: 0, errors: 0 };

  constructor(private steps: Tunables["multiplierSteps"]) {}

  /** A correct letter: returns the multiplier it scored at. */
  hit(): number {
    this.streak++;
    if (this.streak > this.longestStreak) this.longestStreak = this.streak;
    let m = 1;
    for (const s of this.steps) if (this.streak >= s.streak) m = s.multiplier;
    this.multiplier = m;
    this.score += m;
    this.correct++;
    this.wave.correct++;
    return m;
  }

  miss(expected: string | null): void {
    this.streak = 0;
    this.multiplier = 1;
    this.errors++;
    this.wave.errors++;
    if (expected) this.missedLetters[expected] = (this.missedLetters[expected] ?? 0) + 1;
  }

  resetWave(): void {
    this.wave = { correct: 0, errors: 0 };
  }

  get accuracy(): number {
    return accuracy(this.correct, this.errors);
  }

  topMissed(n = 3): { letter: string; count: number }[] {
    return Object.entries(this.missedLetters)
      .map(([letter, count]) => ({ letter, count }))
      .sort((a, b) => b.count - a.count || a.letter.localeCompare(b.letter))
      .slice(0, n);
  }
}

export function accuracy(correct: number, errors: number): number {
  const total = correct + errors;
  return total === 0 ? 1 : correct / total;
}
