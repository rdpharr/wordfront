import { describe, expect, it } from "vitest";
import { WORDS } from "../src/core/wordlist";
import { bank, cfg } from "./helpers";

describe("built-in word list", () => {
  it("has about 5,000 unique lowercase a-z words of 2-12 letters", () => {
    expect(WORDS.length).toBeGreaterThanOrEqual(4500);
    expect(new Set(WORDS).size).toBe(WORDS.length);
    for (const w of WORDS) {
      expect(w).toMatch(/^[a-z]{2,12}$/);
    }
  });

  it("has plenty of words for every length an enemy type can ask for", () => {
    for (const kind of ["mine", "destroyer", "oppressor", "missile"] as const) {
      const [lo, hi] = cfg.enemies[kind].len;
      for (let n = Math.max(lo, 3); n <= hi; n++) {
        expect(bank.bucket(n).length, `length ${n}`).toBeGreaterThanOrEqual(150);
      }
    }
    expect(bank.bucket(2).length).toBeGreaterThanOrEqual(20);
    expect(bank.bucket(1)).toHaveLength(26); // Bullets: single letters
  });

  it("leaves out offensive words, names and abbreviations", () => {
    const words = new Set(WORDS);
    for (const w of ["shit", "fuck", "crap", "piss", "porn", "nazi", "gay", "drug", "inc", "ltd", "tom", "maria", "trump"]) {
      expect(words.has(w), w).toBe(false);
    }
  });

  it("covers most of the alphabet as first letters, so locks rarely clash", () => {
    const firsts = new Set(WORDS.map((w) => w[0]));
    expect(firsts.size).toBeGreaterThanOrEqual(24);
  });
});
