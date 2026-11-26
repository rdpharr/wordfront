import { describe, expect, it } from "vitest";
import { Sim } from "../src/core/sim";
import { rawConfig, resolveConfig } from "../src/core/config";
import type { SimEvent } from "../src/core/types";
import { composition } from "../src/core/waves";
import { bank, cfg, chars, emptySim, newSim, runBot, stepN, typeEach } from "./helpers";

const ofType = <T extends SimEvent["type"]>(evs: SimEvent[], t: T) =>
  evs.filter((e): e is Extract<SimEvent, { type: T }> => e.type === t);

describe("targeting", () => {
  it("locks the nearest enemy whose word starts with the typed letter", () => {
    const s = emptySim();
    const far = s.addEnemy("mine", 100, 100, "cat");
    const near = s.addEnemy("mine", 300, 500, "cow");
    s.addEnemy("mine", 400, 600, "dog");
    const evs = s.step(chars("c"));
    expect(s.lockId).toBe(near.id);
    expect(ofType(evs, "lock")[0]).toMatchObject({ id: near.id, candidates: 2 });
    expect(far.typed).toBe(0);
    expect(near.typed).toBe(1);
  });

  it("letters typed in the same step narrow the choice before distance does", () => {
    const s = emptySim();
    const far = s.addEnemy("mine", 100, 100, "cat");
    s.addEnemy("mine", 300, 500, "cow");
    s.step(chars("ca")); // both keys arrive in one step
    expect(s.lockId).toBe(far.id);
    expect(far.typed).toBe(2);
  });

  it("a wrong letter on a locked word is a miss and the lock holds", () => {
    const s = emptySim();
    const e = s.addEnemy("mine", 270, 300, "cow");
    typeEach(s, "cox");
    expect(s.lockId).toBe(e.id);
    expect(e.typed).toBe(2);
    expect(s.scoring.errors).toBe(1);
    expect(s.scoring.streak).toBe(0);
    expect(s.scoring.missedLetters).toEqual({ w: 1 });
  });

  it("a letter that matches no enemy is a miss and locks nothing", () => {
    const s = emptySim();
    s.addEnemy("mine", 270, 300, "cow");
    const evs = typeEach(s, "z");
    expect(s.lockId).toBeNull();
    expect(s.scoring.errors).toBe(1);
    expect(ofType(evs, "key")[0]).toMatchObject({ correct: false, expected: null });
  });

  it("keys pressed with nothing on screen are ignored", () => {
    const s = emptySim();
    s.addEnemy("mine", 270, 300, "cow");
    typeEach(s, "cow");
    stepN(s, 30); // bolts land, wave ends, break begins
    expect(s.phase).toBe("break");
    typeEach(s, "zzz");
    expect(s.scoring.errors).toBe(0);
  });

  it("backspace releases the lock with no penalty and the enemy keeps its letters", () => {
    const s = emptySim();
    const e = s.addEnemy("mine", 270, 300, "cow");
    typeEach(s, "co");
    for (let i = 0; i < 25; i++) s.scoring.hit(); // build a multiplier
    s.step([{ kind: "backspace" }]);
    expect(s.lockId).toBeNull();
    expect(e.typed).toBe(2);
    expect(s.scoring.streak).toBe(27);
    // the remaining word is now "w": typing w re-locks it
    typeEach(s, "w");
    expect(e.dying).toBe(true);
  });

  it("finishing a word destroys the enemy, clears the lock, and it leaves once bolts land", () => {
    const s = emptySim();
    const e = s.addEnemy("mine", 270, 300, "cow");
    s.addEnemy("mine", 100, 200, "dog");
    const evs = typeEach(s, "cow");
    expect(ofType(evs, "kill")[0]).toMatchObject({ id: e.id, cause: "typed" });
    expect(s.lockId).toBeNull();
    expect(s.scoring.score).toBe(3);
    const later = stepN(s, 60);
    expect(ofType(later, "hit").some((h) => h.id === e.id && h.final)).toBe(true);
    expect(s.enemies.find((x) => x.id === e.id)).toBeUndefined();
  });

  it("each bolt hit knocks the enemy back briefly", () => {
    const s = emptySim();
    const e = s.addEnemy("mine", 270, 300, "rabbit");
    typeEach(s, "r");
    let hit = false;
    for (let i = 0; i < 60 && !hit; i++) hit = ofType(s.step(), "hit").length > 0;
    expect(hit).toBe(true);
    expect(e.haltT).toBeGreaterThan(0);
    const y = e.y;
    s.step();
    expect(e.y).toBeLessThan(y); // pushed away from the squad (upward)
  });
});

describe("EMP", () => {
  it("destroys everything within reach, scores nothing, and only 3 per game", () => {
    const s = emptySim();
    s.addEnemy("mine", 270, 700, "cow");
    s.addEnemy("bullet", 300, 750, "q");
    const far = s.addEnemy("mine", 270, 20, "dog");
    s.step([{ kind: "emp" }]);
    expect(s.empsLeft).toBe(2);
    const evs = stepN(s, 70);
    const kills = ofType(evs, "kill");
    expect(kills.map((k) => k.cause)).toEqual(["emp", "emp"]);
    expect(ofType(evs, "airstrike")[0]).toMatchObject({ destroyed: 2 });
    expect(s.enemies.map((e) => e.id)).toEqual([far.id]);
    expect(s.scoring.score).toBe(0);
    s.step([{ kind: "emp" }]);
    stepN(s, 70);
    s.step([{ kind: "emp" }]);
    stepN(s, 70);
    expect(s.empsLeft).toBe(0);
    const none = s.step([{ kind: "emp" }]);
    expect(ofType(none, "emp_fire")).toHaveLength(0);
  });

  it("starts the wave over: the queue refills to the wave's full count, after a pause", () => {
    const s = emptySim();
    const full = composition(s.wave, cfg.waves);
    const total = full.mine + full.destroyer + full.oppressor;
    s.addEnemy("mine", 270, 700, "cow");
    s.addEnemy("missile", 220, 720, "zap");
    s.addEnemy("bullet", 300, 750, "q");
    s.addEnemy("mine", 270, 20, "dog"); // out of reach: still alive, counts toward the wave
    s.step([{ kind: "emp" }]);
    const evs = stepN(s, 70);
    expect(ofType(evs, "airstrike")[0]).toMatchObject({ destroyed: 3, requeued: total - 1, toGo: total });
    expect(s.queue).toHaveLength(total - 1);
    // nothing new during the strike and the respawn delay
    const holdSteps = Math.round((cfg.emp.duration + cfg.emp.respawnDelay) * 60) - 71 - 2;
    expect(ofType(stepN(s, holdSteps), "spawn")).toHaveLength(0);
    const back = ofType(stepN(s, 60 * 8), "spawn").filter((e) => e.parent === null);
    expect(back).toHaveLength(total - 1);
    expect(back.map((e) => e.word)).not.toContain("cow");
  });

  it("with resetWave off, destroyed enemies are gone for good", () => {
    const raw = structuredClone(rawConfig);
    raw.emp.resetWave = false;
    const s = newSim(1, raw);
    s.queue = [];
    s.addEnemy("mine", 270, 700, "cow");
    s.addEnemy("mine", 270, 20, "dog");
    s.step([{ kind: "emp" }]);
    stepN(s, 70);
    expect(s.queue).toEqual([]);
  });
});

describe("airstrike refill", () => {
  const refillSim = () => {
    const raw = structuredClone(rawConfig);
    raw.emp.refillEvery = 2;
    const s = newSim(1, raw);
    s.queue = [];
    return s;
  };

  it("earns one back every refillEvery typed words; bullets don't count", () => {
    const s = refillSim();
    s.empsLeft = 1;
    s.addEnemy("mine", 100, 100, "cow");
    s.addEnemy("mine", 200, 100, "dog");
    s.addEnemy("bullet", 400, 100, "q");
    s.addEnemy("mine", 300, 100, "bat");
    let evs = typeEach(s, "cowq");
    expect(s.empsLeft).toBe(1);
    expect(s.refillProgress).toBe(1);
    evs = typeEach(s, "dog");
    expect(ofType(evs, "airstrike_earned")).toEqual([expect.objectContaining({ left: 2 })]);
    expect(s.empsLeft).toBe(2);
    expect(s.refillProgress).toBe(0);
  });

  it("never goes above max, and doesn't bank progress while full", () => {
    const s = refillSim();
    s.addEnemy("mine", 100, 100, "cow");
    s.addEnemy("mine", 200, 100, "dog");
    s.addEnemy("mine", 300, 100, "bat");
    const evs = typeEach(s, "cowdog");
    expect(s.empsLeft).toBe(cfg.emp.max);
    expect(s.refillProgress).toBe(0);
    expect(ofType(evs, "airstrike_earned")).toHaveLength(0);
  });
});

describe("enemies", () => {
  it("contact with the squad ends the game", () => {
    const s = emptySim();
    s.addEnemy("mine", 270, 820, "cow");
    const evs = stepN(s, 120);
    expect(s.phase).toBe("over");
    expect(ofType(evs, "death")[0]).toMatchObject({ killerKind: "mine", killerWord: "cow" });
    expect(s.step()).toEqual([]); // nothing happens after game over
  });

  it("a projectile reaching an edge soldier ends the game, and was flagged as incoming", () => {
    const s = emptySim();
    // straight down at the outermost soldiers (squad centre is x=270)
    const b = s.addEnemy("bullet", 270 + 105, 300, "q", Math.PI / 2);
    expect(s.incoming(b)).toBe(true);
    stepN(s, 60 * 20);
    expect(s.phase).toBe("over");
    expect(s.death?.killerKind).toBe("bullet");
  });

  it("a projectile that will miss the squad is not flagged and does no harm", () => {
    const s = emptySim();
    s.addEnemy("mine", 270, 100, "cow"); // keeps the wave alive
    const b = s.addEnemy("bullet", 30, 300, "q", Math.PI / 2); // well left of the barricade
    expect(s.incoming(b)).toBe(false);
    const away = s.addEnemy("bullet", 300, 600, "z", -Math.PI / 2); // flying away
    expect(s.incoming(away)).toBe(false);
    expect(s.incoming(s.addEnemy("missile", 30, 300, "fire", Math.PI / 2))).toBe(true); // homes in
  });

  it("a Destroyer launches a Missile every 5 s, an Oppressor a fan of Bullets every 7 s", () => {
    const s = emptySim();
    s.addEnemy("destroyer", 100, 20, "elephant", Math.PI / 2);
    s.addEnemy("oppressor", 400, 0, "chocolate", Math.PI / 2);
    const evs = stepN(s, 60 * 7 + 1);
    const spawns = ofType(evs, "spawn");
    expect(spawns.filter((e) => e.kind === "missile")).toHaveLength(1);
    expect(spawns.filter((e) => e.kind === "bullet")).toHaveLength(cfg.oppressor.fanCountStart);
    for (const b of spawns.filter((e) => e.kind === "bullet")) expect(b.word).toMatch(/^[a-z]$/);
  });

  it("warns once when an on-course Bullet is about to hit, and not for one that will miss", () => {
    const s = emptySim();
    const speed = cfg.enemies.bullet.speed * Math.pow(cfg.waves.speedGrowth, 1);
    // straight down onto the squad, starting ~3.5 s of travel above its hitbox
    const top = cfg.player.y - cfg.player.hh - speed * (cfg.warnSeconds + 1);
    const hit = s.addEnemy("bullet", cfg.player.x, top, "q", Math.PI / 2);
    s.addEnemy("bullet", 30, top, "z", Math.PI / 2); // falls well left of the squad
    const early = stepN(s, 50);
    expect(ofType(early, "incoming")).toHaveLength(0);
    const evs = stepN(s, 60);
    const warns = ofType(evs, "incoming");
    expect(warns.map((w) => w.id)).toEqual([hit.id]);
    expect(warns[0]!.eta).toBeLessThanOrEqual(cfg.warnSeconds);
    expect(ofType(stepN(s, 30), "incoming")).toHaveLength(0);
  });

  it("snap shot: a warned Bullet's letter shoots it while locked, and the lock stays", () => {
    const s = emptySim();
    const speed = cfg.enemies.bullet.speed * Math.pow(cfg.waves.speedGrowth, 1);
    const top = cfg.player.y - cfg.player.hh - speed * (cfg.warnSeconds - 0.5);
    const mine = s.addEnemy("mine", 100, 100, "dog");
    const bullet = s.addEnemy("bullet", cfg.player.x, top, "q", Math.PI / 2);
    typeEach(s, "d");
    expect(s.lockId).toBe(mine.id);
    expect(bullet.warned).toBe(true);
    const evs = typeEach(s, "q");
    expect(ofType(evs, "kill").map((k) => k.id)).toEqual([bullet.id]);
    expect(s.lockId).toBe(mine.id);
    expect(s.scoring.wave.errors).toBe(0);
    typeEach(s, "og");
    expect(mine.dying).toBe(true);
  });

  it("no snap shot for a Bullet that hasn't been warned", () => {
    const s = emptySim();
    const mine = s.addEnemy("mine", 100, 100, "dog");
    const bullet = s.addEnemy("bullet", cfg.player.x, 100, "q", Math.PI / 2);
    typeEach(s, "dq");
    expect(bullet.dying).toBe(false);
    expect(s.lockId).toBe(mine.id);
    expect(s.scoring.wave.errors).toBe(1);
  });

  it("two wrong letters in a row on a lock show the switch hint until a right letter or Backspace", () => {
    const n = cfg.switchHintAfter;
    expect(n).toBeGreaterThan(0);
    const s = emptySim();
    s.addEnemy("mine", 100, 100, "dog");
    s.addEnemy("mine", 300, 100, "cat");
    typeEach(s, "d");
    const first = typeEach(s, "x".repeat(n - 1));
    expect(s.showSwitchHint).toBe(false);
    expect(ofType(first, "switch_hint")).toHaveLength(0);
    const evs = typeEach(s, "x");
    expect(s.showSwitchHint).toBe(true);
    expect(ofType(evs, "switch_hint")).toHaveLength(1);
    expect(ofType(typeEach(s, "x"), "switch_hint")).toHaveLength(0); // once per stuck spell
    typeEach(s, "o");
    expect(s.showSwitchHint).toBe(false);
    typeEach(s, "x".repeat(n));
    expect(s.showSwitchHint).toBe(true);
    s.step([{ kind: "backspace" }]);
    expect(s.lockId).toBe(null);
    expect(s.showSwitchHint).toBe(false);
    typeEach(s, "c"); // a new lock starts clean
    expect(s.showSwitchHint).toBe(false);
  });

  it("enemies that drift off screen are removed without scoring", () => {
    const s = emptySim();
    s.addEnemy("mine", 270, 300, "cow");
    s.addEnemy("bullet", 10, 300, "q", Math.PI); // heading left, off screen
    stepN(s, 120);
    expect(s.enemies.some((e) => e.kind === "bullet")).toBe(false);
    expect(s.scoring.score).toBe(0);
  });
});

describe("waves and words", () => {
  it("runs waves in order with a 2 s break between them", () => {
    const s = newSim(7);
    const { events } = runBot(s, 6, 60 * 60 * 4);
    const starts = ofType(events, "wave_start");
    expect(starts.slice(0, 3).map((w) => w.wave)).toEqual([1, 2, 3]);
    expect(starts[0]!.composition).toEqual({ mine: 4, destroyer: 0, oppressor: 0 });
    expect(starts[2]!.composition).toEqual({ mine: 5, destroyer: 1, oppressor: 0 });
    const end1 = ofType(events, "wave_end")[0]!;
    expect(starts[1]!.t - end1.t).toBeGreaterThanOrEqual(1990);
    expect(starts[1]!.t - end1.t).toBeLessThanOrEqual(2020);
  });

  it("word lengths match each enemy type, lowercase a-z only, no repeats within a wave", () => {
    const s = newSim(3);
    const { events } = runBot(s, 5, 60 * 60 * 6);
    const lens = resolveConfig().enemies;
    const byWave = new Map<number, string[]>();
    for (const sp of ofType(events, "spawn")) {
      const [lo, hi] = lens[sp.kind].len;
      expect(sp.word.length).toBeGreaterThanOrEqual(lo);
      expect(sp.word.length).toBeLessThanOrEqual(hi);
      expect(sp.word).toMatch(/^[a-z]+$/);
      if (sp.kind !== "bullet") byWave.set(sp.wave, [...(byWave.get(sp.wave) ?? []), sp.word]);
    }
    for (const words of byWave.values()) expect(new Set(words).size).toBe(words.length);
  });

  it("every wave enemy spawns across the playfield's width, just above the top edge", () => {
    const s = newSim(13);
    const { events } = runBot(s, 4, 60 * 60 * 15);
    const waves = new Set<number>();
    for (const sp of ofType(events, "spawn")) {
      if (sp.parent !== null) continue; // projectiles start at their shooter
      waves.add(sp.wave);
      expect(sp.x).toBeGreaterThanOrEqual(cfg.spawnXMargin);
      expect(sp.x).toBeLessThanOrEqual(cfg.width - cfg.spawnXMargin);
      expect(sp.y).toBe(cfg.spawnY);
    }
    expect(waves.size).toBeGreaterThanOrEqual(15);
  });

  it("prefers words whose first letter no on-screen enemy is using", () => {
    const s = newSim(11);
    let clashes = 0;
    let spawns = 0;
    for (let i = 0; i < 60 * 30; i++) {
      for (const ev of s.step()) {
        if (ev.type !== "spawn" || ev.kind === "bullet") continue;
        spawns++;
        const others = s.enemies.filter((e) => e.id !== ev.id && !e.dying);
        if (others.some((e) => e.word[e.typed] === ev.word[0])) clashes++;
      }
      if (s.phase === "over") break;
    }
    expect(spawns).toBeGreaterThan(3);
    expect(clashes).toBe(0);
  });
});

describe("determinism", () => {
  it("the same seed and keystrokes reproduce the same score and wave", () => {
    const a = newSim(42);
    const runA = runBot(a, 9, 60 * 60 * 5, 17);
    const b = new Sim(resolveConfig(), bank, 42);
    const byStep = new Map(runA.recorded.map((r) => [r.step, r.inputs]));
    for (let i = 0; i < 60 * 60 * 5 && b.phase !== "over"; i++) b.step(byStep.get(b.stepCount) ?? []);
    expect(b.scoring.score).toBe(a.scoring.score);
    expect(b.wave).toBe(a.wave);
    expect(b.stepCount).toBe(a.stepCount);
    expect(b.scoring.errors).toBe(a.scoring.errors);
    expect(a.scoring.score).toBeGreaterThan(0);
  });

  it("stats add up on a scripted run", () => {
    const s = newSim(5);
    const { events } = runBot(s, 8, 60 * 60 * 5, 11);
    const keys = ofType(events, "key");
    const correct = keys.filter((k) => k.correct).length;
    const errors = keys.length - correct;
    expect(s.scoring.correct).toBe(correct);
    expect(s.scoring.errors).toBe(errors);
    expect(s.scoring.score).toBe(keys.filter((k) => k.correct).reduce((a, k) => a + k.multiplier, 0));
    let streak = 0;
    let longest = 0;
    for (const k of keys) {
      streak = k.correct ? streak + 1 : 0;
      longest = Math.max(longest, streak);
    }
    expect(s.scoring.longestStreak).toBe(longest);
  });
});
