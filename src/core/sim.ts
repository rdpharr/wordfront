import type { Tunables } from "./config";
import { Rng } from "./rng";
import { Scoring, accuracy } from "./scoring";
import { chooseTarget, remaining } from "./targeting";
import type { Bolt, Emp, Enemy, EnemyKind, Phase, SimEvent, SimInput } from "./types";
import { composition, fanCount as fanCountFor, spawnGap, spawnLps, speedFactor } from "./waves";
import type { WordBank } from "./words";

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type EventBody = DistOmit<SimEvent, "t" | "wave">;

const TAU = Math.PI * 2;
/** Kinds a wave queues up (Missiles and Bullets are fired by them, so they never come back). */
const QUEUED_KINDS: ReadonlySet<EnemyKind> = new Set(["mine", "destroyer", "oppressor"]);

function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/**
 * The whole game rules, with no rendering or DOM. Advance it with step(); it is
 * deterministic for a given seed, word bank, config and input sequence.
 */
export class Sim {
  readonly rng: Rng;
  readonly scoring: Scoring;
  enemies: Enemy[] = [];
  bolts: Bolt[] = [];
  emp: Emp | null = null;
  empsLeft: number;
  /** words typed toward the next airstrike refill (only counts while below emp.max) */
  refillProgress = 0;
  /** airstrikes earned back this run; each makes the next one cost more */
  strikesEarned = 0;
  lockId: number | null = null;
  /** Wrong letters in a row on the current lock (drives the "Backspace: switch target" hint). */
  lockedMisses = 0;
  /** seconds left with no spawns after an airstrike (the strike, then emp.respawnDelay) */
  spawnHold = 0;
  /** seconds the rifles stay jammed after a wrong letter; letters typed meanwhile are dropped */
  jamT = 0;
  wave = 0;
  phase: Phase = "break";
  breakT = 0;
  stepCount = 0;
  /** ms of simulated play */
  get tMs(): number {
    return (this.stepCount * this.cfg.dt * 1000) | 0;
  }

  private nextId = 1;
  /** enemies still to spawn this wave */
  queue: EnemyKind[] = [];
  private spawnT = 0;
  /** seconds since the last spawn from the queue */
  private sinceSpawn = Infinity;
  private waveLps = 1;
  private waveSpeed = 1;
  private usedWords = new Set<string>();
  private lastKeyMs: number | null = null;
  private events: SimEvent[] = [];
  private waveStartMs = 0;
  private peakEnemies = 0;
  private closest: number | null = null;
  /** Death details, once the game is over. */
  death: Extract<SimEvent, { type: "death" }> | null = null;

  constructor(
    readonly cfg: Tunables,
    readonly words: WordBank,
    readonly seed: number,
  ) {
    this.rng = new Rng(seed);
    this.scoring = new Scoring(cfg.multiplierSteps);
    this.empsLeft = cfg.emp.count;
    this.startWave(1);
  }

  get lockTarget(): Enemy | null {
    return this.lockId === null ? null : (this.enemies.find((e) => e.id === this.lockId) ?? null);
  }

  get playerX(): number {
    return this.cfg.player.x;
  }
  get playerY(): number {
    return this.cfg.player.y;
  }

  /** Advance one fixed step (cfg.dt), processing `inputs` first, in order. */
  step(inputs: readonly SimInput[] = []): SimEvent[] {
    if (this.phase !== "over") this.advance(inputs);
    const out = this.events;
    this.events = [];
    return out;
  }

  private advance(inputs: readonly SimInput[]): void {
    this.stepCount++;
    const dt = this.cfg.dt;

    // a jam set in an earlier step runs down before this step's keys are read
    if (this.jamT > 0) this.jamT = this.jamT - dt > 1e-9 ? this.jamT - dt : 0;
    for (let i = 0; i < inputs.length && this.phase !== "over"; i++) {
      const inp = inputs[i]!;
      if (inp.kind === "char" && this.jamT > 0) {
        this.emit({ type: "jammed", char: inp.ch });
        continue;
      }
      if (inp.kind === "char") {
        let look = "";
        for (let j = i + 1; j < inputs.length; j++) {
          const n = inputs[j]!;
          if (n.kind !== "char") break;
          look += n.ch;
        }
        this.typeChar(inp.ch, look);
      } else if (inp.kind === "backspace") {
        this.release();
      } else {
        this.fireEmp();
      }
    }

    if (this.phase === "break") {
      this.breakT -= dt;
      if (this.breakT <= 0) this.startWave(this.wave + 1);
    }

    if (this.phase === "wave") {
      const w = this.cfg.waves;
      this.spawnT -= dt;
      this.sinceSpawn += dt;
      if (this.spawnHold > 0) {
        // breathing room after an airstrike: nothing new until the hold ends
        this.spawnHold = Math.max(0, this.spawnHold - dt);
        this.spawnT = Math.max(0, this.spawnT);
      }
      while (this.spawnHold === 0 && this.queue.length > 0) {
        const due = this.spawnT <= 0;
        // too few words to type: bring the next one in early (but not on top of the last)
        const early = !due && this.sinceSpawn >= w.spawnGapMin && this.liveWords() < w.minOnScreen;
        if (!due && !early) break;
        const e = this.spawnFromQueue(this.queue.shift()!);
        const gap = spawnGap(e.word.length, this.waveLps, w);
        this.spawnT = early ? gap : this.spawnT + gap;
        this.sinceSpawn = 0;
      }
    }

    this.updateEnemies(dt);
    this.updateBolts(dt);
    this.updateEmp(dt);
    this.checkCollisions();
    this.cullOffscreen();
    this.trackWaveStats();

    // never end a wave mid-airstrike: the strike resets the wave when it finishes
    const strikeResets = this.emp !== null && this.cfg.emp.resetWave;
    if (
      this.phase === "wave" &&
      !strikeResets &&
      this.queue.length === 0 &&
      !this.enemies.some((e) => !e.dying && !e.stray)
    ) {
      this.endWave();
    }
  }

  // ---------------------------------------------------------------- input

  private typeChar(ch: string, lookahead: string): void {
    const locked = this.lockTarget;
    const live = this.enemies.filter((e) => !e.dying && !e.stray);
    if (locked) {
      const expected = locked.word[locked.typed]!;
      if (ch === expected) {
        this.lockedMisses = 0;
        this.correctLetter(locked, ch);
      } else {
        const snap = this.snapTarget(ch);
        if (snap) this.correctLetter(snap, ch);
        else {
          this.missLetter(ch, expected, locked);
          if (++this.lockedMisses === this.cfg.switchHintAfter) this.emit({ type: "switch_hint", id: locked.id });
        }
      }
      return;
    }
    if (live.length === 0) return; // nothing on screen to aim at: ignore
    const choice = chooseTarget(live, ch, lookahead, this.playerX, this.playerY);
    if (!choice) {
      this.missLetter(ch, null, null);
      return;
    }
    const e = choice.target;
    this.lockId = e.id;
    this.lockedMisses = 0;
    this.emit({
      type: "lock",
      id: e.id,
      candidates: choice.candidates,
      distance: this.dist(e),
      msSinceSpawn: this.tMs - e.spawnMs,
    });
    this.correctLetter(e, ch);
  }

  /** A warned Bullet with this letter that can be shot without breaking the current lock. */
  private snapTarget(ch: string): Enemy | null {
    if (!this.cfg.snapShot) return null;
    let best: Enemy | null = null;
    for (const e of this.enemies) {
      if (e.kind !== "bullet" || e.dying || !e.warned || e.word !== ch || e.typed > 0) continue;
      if (!best || this.edgeDist(e) < this.edgeDist(best)) best = e;
    }
    return best;
  }

  private keyGap(): number | null {
    const now = this.tMs;
    const gap = this.lastKeyMs === null ? null : now - this.lastKeyMs;
    this.lastKeyMs = now;
    return gap;
  }

  private correctLetter(e: Enemy, ch: string): void {
    const mult = this.scoring.hit();
    e.typed++;
    this.suppress(e);
    e.pendingBolts++;
    this.bolts.push({
      id: this.nextId++,
      targetId: e.id,
      x: this.playerX,
      y: this.playerY,
      px: this.playerX,
      py: this.playerY,
    });
    this.emit({
      type: "key",
      char: ch,
      expected: ch,
      correct: true,
      id: e.id,
      msSincePrev: this.keyGap(),
      step: this.stepCount,
      multiplier: mult,
    });
    if (e.typed >= e.word.length) {
      e.dying = true;
      if (this.lockId === e.id) this.lockId = null;
      this.emit({
        type: "kill",
        id: e.id,
        kind: e.kind,
        cause: "typed",
        msAlive: this.tMs - e.spawnMs,
        distance: this.dist(e),
        misses: e.missesOnWord,
        x: e.x,
        y: e.y,
      });
      if (e.kind !== "bullet") this.creditRefill();
    }
  }

  /** A letter landing on a Destroyer or Oppressor pushes its next shot back (never past a full reload). */
  private suppress(e: Enemy): void {
    if (e.kind !== "destroyer" && e.kind !== "oppressor") return;
    const t = e.kind === "destroyer" ? this.cfg.destroyer : this.cfg.oppressor;
    e.fireT = Math.min(t.fireEvery, e.fireT + t.delayPerLetter);
  }

  /** Words the next airstrike costs: refillStart, plus refillStep for each one already earned back. */
  get refillCost(): number {
    const c = this.cfg.emp;
    const cost = c.refillStart + c.refillStep * this.strikesEarned;
    return c.refillMax > 0 ? Math.min(c.refillMax, cost) : cost;
  }

  /** One typed word toward earning an airstrike back. */
  private creditRefill(): void {
    const c = this.cfg.emp;
    if (c.refillStart <= 0 || this.empsLeft >= c.max) return;
    const cost = this.refillCost;
    if (++this.refillProgress < cost) return;
    this.refillProgress = 0;
    this.strikesEarned++;
    this.empsLeft++;
    this.emit({ type: "airstrike_earned", left: this.empsLeft, cost });
  }

  private missLetter(ch: string, expected: string | null, e: Enemy | null): void {
    this.scoring.miss(expected);
    this.jamT = this.cfg.jamSeconds;
    if (e) e.missesOnWord++;
    this.emit({
      type: "key",
      char: ch,
      expected,
      correct: false,
      id: e ? e.id : null,
      msSincePrev: this.keyGap(),
      step: this.stepCount,
      multiplier: 1,
    });
  }

  /** Stuck on a word: show the player that Backspace drops the target. */
  get showSwitchHint(): boolean {
    const n = this.cfg.switchHintAfter;
    return n > 0 && this.lockedMisses >= n && this.lockTarget !== null;
  }

  private release(): void {
    const e = this.lockTarget;
    if (!e) return;
    this.lockId = null;
    this.lockedMisses = 0;
    this.emit({ type: "release", id: e.id, lettersLeft: e.word.length - e.typed });
  }

  private fireEmp(): void {
    if (this.empsLeft <= 0 || this.emp || this.phase !== "wave") return;
    this.empsLeft--;
    const live = this.enemies.filter((e) => !e.dying);
    const nearest = live.length ? Math.min(...live.map((e) => this.dist(e))) : null;
    this.emp = { t: 0, r: 0, destroyed: 0, requeued: 0, nearestBefore: nearest, fate: new Map(), spared: 0 };
    this.spawnHold = this.cfg.emp.duration + this.cfg.emp.respawnDelay;
    this.emit({ type: "emp_fire", left: this.empsLeft });
  }

  // ---------------------------------------------------------------- waves

  private startWave(n: number): void {
    this.wave = n;
    this.phase = "wave";
    const w = this.cfg.waves;
    const comp = composition(n, w);
    this.waveLps = spawnLps(n, w);
    this.waveSpeed = speedFactor(n, w);
    const q: EnemyKind[] = [];
    for (let i = 0; i < comp.mine; i++) q.push("mine");
    for (let i = 0; i < comp.destroyer; i++) q.push("destroyer");
    for (let i = 0; i < comp.oppressor; i++) q.push("oppressor");
    this.queue = this.rng.shuffle(q);
    this.spawnT = 0;
    this.sinceSpawn = Infinity;
    this.usedWords.clear();
    this.scoring.resetWave();
    this.waveStartMs = this.tMs;
    this.peakEnemies = 0;
    this.closest = null;
    this.emit({
      type: "wave_start",
      composition: comp,
      spawnLps: this.waveLps,
      speedFactor: this.waveSpeed,
    });
  }

  private endWave(): void {
    this.emit({
      type: "wave_end",
      duration: this.tMs - this.waveStartMs,
      accuracy: accuracy(this.scoring.wave.correct, this.scoring.wave.errors),
      misses: this.scoring.wave.errors,
      peakEnemies: this.peakEnemies,
      closestApproach: this.closest,
      airstrikesLeft: this.empsLeft,
    });
    this.phase = "break";
    this.breakT = this.cfg.waves.breakFor;
    this.lockId = null;
  }

  /** Accuracy of the wave just finished (valid during the break). */
  get waveAccuracy(): number {
    return accuracy(this.scoring.wave.correct, this.scoring.wave.errors);
  }

  // ---------------------------------------------------------------- spawning

  /** Words on screen to type, not counting Bullets. */
  private liveWords(): number {
    let n = 0;
    for (const e of this.enemies) if (!e.dying && e.kind !== "bullet") n++;
    return n;
  }

  private takenFirsts(): Set<string> {
    const s = new Set<string>();
    for (const e of this.enemies) if (!e.dying && !e.stray) s.add(remaining(e)[0]!);
    return s;
  }

  /** Test/debug hook: place an enemy with a chosen word. */
  addEnemy(kind: EnemyKind, x: number, y: number, word: string, angle = Math.PI / 2): Enemy {
    return this.newEnemy(kind, x, y, angle, null, word);
  }

  private newEnemy(
    kind: EnemyKind,
    x: number,
    y: number,
    angle: number,
    parent: number | null,
    fixedWord?: string,
  ): Enemy {
    const t = this.cfg.enemies[kind];
    const word =
      fixedWord ??
      this.words.pick(
        this.rng,
        t.len[0],
        t.len[1],
        this.takenFirsts(),
        this.usedWords,
        this.cfg.uniqueFirstLetterTries,
      );
    if (kind !== "bullet") this.usedWords.add(word);
    const e: Enemy = {
      id: this.nextId++,
      kind,
      word,
      typed: 0,
      x,
      y,
      px: x,
      py: y,
      angle,
      speed: t.speed * this.waveSpeed,
      hw: t.hw,
      hh: t.hh,
      haltT: 0,
      kbx: 0,
      kby: 0,
      fireT:
        kind === "destroyer"
          ? this.cfg.destroyer.fireEvery
          : kind === "oppressor"
            ? this.cfg.oppressor.fireEvery
            : 0,
      age: 0,
      dying: false,
      dyingT: 0,
      pendingBolts: 0,
      closeCalled: false,
      warned: false,
      stray: false,
      missesOnWord: 0,
      spawnMs: this.tMs,
    };
    this.enemies.push(e);
    this.emit({ type: "spawn", id: e.id, kind, word, x, y, speed: e.speed, parent });
    return e;
  }

  private spawnFromQueue(kind: EnemyKind): Enemy {
    const c = this.cfg;
    const x = this.rng.range(c.spawnXMargin, c.width - c.spawnXMargin);
    const y = c.spawnY;
    let angle = Math.PI / 2;
    if (kind === "mine") {
      angle = Math.atan2(this.playerY - y, this.playerX - x);
    } else if (kind === "destroyer") {
      const [lo, hi] = c.destroyer.aimXRange;
      const tx = c.width * this.rng.range(lo, hi);
      angle = Math.atan2(this.playerY - y, tx - x);
    }
    return this.newEnemy(kind, x, y, angle, null);
  }

  // ---------------------------------------------------------------- update

  private updateEnemies(dt: number): void {
    const c = this.cfg;
    const spawned: (() => void)[] = [];
    for (const e of this.enemies) {
      e.px = e.x;
      e.py = e.y;
      e.age += dt;
      if (e.dying) {
        e.dyingT += dt;
        continue;
      }
      const toPlayer = Math.atan2(this.playerY - e.y, this.playerX - e.x);
      if (e.kind === "mine") {
        e.angle = toPlayer;
      } else if (e.kind === "missile") {
        const m = c.missile;
        if (e.age > m.straightFor && e.age <= m.straightFor + m.turnFor) {
          const d = angleDiff(e.angle, toPlayer);
          const maxTurn = m.turnRate * dt;
          e.angle += Math.max(-maxTurn, Math.min(maxTurn, d));
        }
      }

      if (e.haltT > 0) {
        e.haltT -= dt;
        e.x += e.kbx * dt;
        e.y += e.kby * dt;
      } else {
        e.x += Math.cos(e.angle) * e.speed * dt;
        e.y += Math.sin(e.angle) * e.speed * dt;
      }

      if (e.kind === "destroyer" || e.kind === "oppressor") {
        e.fireT -= dt;
        if (e.fireT <= 0) {
          const isD = e.kind === "destroyer";
          e.fireT += isD ? c.destroyer.fireEvery : c.oppressor.fireEvery;
          const limit = isD ? c.destroyer.noFireWithin : c.oppressor.noFireWithin;
          if (this.dist(e) > limit) {
            const src = e;
            spawned.push(() => this.fireFrom(src, toPlayer));
          }
        }
      }
    }
    for (const f of spawned) f();
  }

  private fireFrom(e: Enemy, toPlayer: number): void {
    if (e.kind === "destroyer") {
      this.newEnemy("missile", e.x, e.y, e.angle, e.id);
      this.emit({ type: "fire", id: e.id, kind: "missile" });
    } else {
      const { fanSpread } = this.cfg.oppressor;
      const fanCount = fanCountFor(this.wave, this.cfg.waves, this.cfg.oppressor);
      for (let i = 0; i < fanCount; i++) {
        const a = toPlayer - fanSpread / 2 + (fanCount === 1 ? fanSpread / 2 : (i * fanSpread) / (fanCount - 1));
        const b = this.newEnemy("bullet", e.x, e.y, a, e.id);
        b.stray = this.cfg.dimStrays && !this.incoming(b);
      }
      this.emit({ type: "fire", id: e.id, kind: "bullets" });
    }
  }

  private updateBolts(dt: number): void {
    const step = this.cfg.boltSpeed * dt;
    const keep: Bolt[] = [];
    for (const b of this.bolts) {
      b.px = b.x;
      b.py = b.y;
      const t = this.enemies.find((e) => e.id === b.targetId);
      if (!t) continue; // target already gone: bolt disappears
      const dx = t.x - b.x;
      const dy = t.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d <= step) {
        b.x = t.x;
        b.y = t.y;
        t.pendingBolts--;
        const final = t.dying && t.pendingBolts <= 0;
        if (!t.dying) this.knockback(t);
        this.emit({ type: "hit", id: t.id, final, x: t.x, y: t.y });
        continue;
      }
      b.x += (dx / d) * step;
      b.y += (dy / d) * step;
      keep.push(b);
    }
    this.bolts = keep;
    // dying enemies leave once their bolts have landed (or after a safety timeout)
    this.enemies = this.enemies.filter((e) => !(e.dying && (e.pendingBolts <= 0 || e.dyingT > 1)));
  }

  private knockback(e: Enemy): void {
    const h = this.cfg.hit;
    const away = Math.atan2(e.y - this.playerY, e.x - this.playerX);
    const v = h.knockback + this.rng.next() * h.knockbackRandom;
    e.kbx = Math.cos(away) * v;
    e.kby = Math.sin(away) * v;
    e.haltT = h.haltFor;
  }

  private updateEmp(dt: number): void {
    const emp = this.emp;
    if (!emp) return;
    const c = this.cfg.emp;
    emp.t += dt;
    emp.r = c.radius * Math.min(1, emp.t / c.duration);
    const survivors: Enemy[] = [];
    for (const e of this.enemies) {
      if (!e.dying && this.dist(e) <= emp.r && !this.ridesOut(e, emp)) {
        emp.destroyed++;
        if (this.lockId === e.id) this.lockId = null;
        this.emit({
          type: "kill",
          id: e.id,
          kind: e.kind,
          cause: "emp",
          msAlive: this.tMs - e.spawnMs,
          distance: this.dist(e),
          misses: e.missesOnWord,
          x: e.x,
          y: e.y,
        });
        continue;
      }
      survivors.push(e);
    }
    this.enemies = survivors;
    if (emp.t >= c.duration) {
      if (c.resetWave && this.phase === "wave") this.resetWaveQueue(emp);
      this.emit({
        type: "airstrike",
        destroyed: emp.destroyed,
        spared: emp.spared,
        requeued: emp.requeued,
        toGo: this.queue.length + this.liveQueuedKinds().length,
        nearestBefore: emp.nearestBefore,
      });
      this.emp = null;
    }
  }

  /**
   * The blast front just reached `e` (or reached it earlier): does it survive? Decided
   * once per enemy. Only Mines, Destroyers and Oppressors far enough from the squad
   * get a chance; projectiles and anything close never survive.
   */
  private ridesOut(e: Enemy, emp: Emp): boolean {
    const known = emp.fate.get(e.id);
    if (known !== undefined) return known;
    const c = this.cfg.emp;
    const lucky =
      c.surviveChance > 0 &&
      QUEUED_KINDS.has(e.kind) &&
      this.dist(e) > c.surviveBeyond &&
      this.rng.next() < c.surviveChance;
    emp.fate.set(e.id, lucky);
    if (lucky) emp.spared++;
    return lucky;
  }

  /** Mines, Destroyers and Oppressors still alive on screen. */
  private liveQueuedKinds(): Enemy[] {
    return this.enemies.filter((e) => !e.dying && QUEUED_KINDS.has(e.kind));
  }

  /**
   * An airstrike means the squad is at capacity, so the wave starts over: the queue
   * refills until the enemies left to kill (on screen plus queued) are the wave's full
   * count again, with new words as they spawn.
   */
  private resetWaveQueue(emp: Emp): void {
    const comp = composition(this.wave, this.cfg.waves);
    const left: Record<"mine" | "destroyer" | "oppressor", number> = { ...comp };
    for (const e of this.liveQueuedKinds()) left[e.kind as keyof typeof left]--;
    const q: EnemyKind[] = [];
    for (const k of ["mine", "destroyer", "oppressor"] as const) for (let i = 0; i < left[k]; i++) q.push(k);
    emp.requeued = Math.max(0, q.length - this.queue.length);
    this.queue = this.rng.shuffle(q);
  }

  private checkCollisions(): void {
    const p = this.cfg.player;
    for (const e of this.enemies) {
      if (e.dying) continue;
      if (Math.abs(e.x - p.x) < e.hw + p.hw && Math.abs(e.y - p.y) < e.hh + p.hh) {
        this.phase = "over";
        this.lockId = null;
        const ev = {
          type: "death" as const,
          killerKind: e.kind,
          killerWord: e.word,
          lettersLeft: e.word.length - e.typed,
          enemiesOnScreen: this.enemies.filter((x) => !x.dying).length,
        };
        this.emit(ev);
        this.death = { ...ev, t: this.tMs, wave: this.wave };
        return;
      }
    }
  }

  private cullOffscreen(): void {
    const c = this.cfg;
    const m = c.offscreenMargin;
    this.enemies = this.enemies.filter((e) => {
      if (e.dying) return true;
      const out =
        e.x < -m || e.x > c.width + m || e.y > c.height + m || e.y < -c.offscreenTop;
      if (out && this.lockId === e.id) this.lockId = null;
      return !out;
    });
  }

  private trackWaveStats(): void {
    let live = 0;
    for (const e of this.enemies) {
      if (e.dying || e.stray) continue;
      live++;
      const d = this.edgeDist(e);
      if (this.closest === null || d < this.closest) this.closest = d;
      if (!e.closeCalled && d < this.cfg.closeCallDistance) {
        e.closeCalled = true;
        this.emit({ type: "close_call", id: e.id, kind: e.kind, lettersLeft: e.word.length - e.typed });
      }
      if (e.kind === "bullet" && !e.warned && e.speed > 0) {
        const eta = d / e.speed;
        if (eta < this.cfg.warnSeconds && this.incoming(e)) {
          e.warned = true;
          this.emit({ type: "incoming", id: e.id, kind: e.kind, eta: Math.round(eta * 100) / 100 });
        }
      }
    }
    if (live > this.peakEnemies) this.peakEnemies = live;
  }

  // ---------------------------------------------------------------- helpers

  /** Distance from the squad's centre (used for targeting order and firing limits). */
  dist(e: { x: number; y: number }): number {
    return Math.hypot(e.x - this.playerX, e.y - this.playerY);
  }

  /** Gap between an enemy's hitbox and the squad's hitbox (0 when touching). */
  edgeDist(e: Enemy): number {
    const p = this.cfg.player;
    const dx = Math.max(0, Math.abs(e.x - p.x) - (e.hw + p.hw));
    const dy = Math.max(0, Math.abs(e.y - p.y) - (e.hh + p.hh));
    return Math.hypot(dx, dy);
  }

  /**
   * Will this projectile hit the squad if nobody types its word? Missiles home in,
   * so they always count; Bullets fly straight, so test their line against the
   * squad's hitbox (grown by the bullet's own size).
   */
  incoming(e: Enemy): boolean {
    if (e.dying) return false;
    if (e.kind === "missile") return true;
    if (e.kind !== "bullet") return false;
    const p = this.cfg.player;
    const hw = p.hw + e.hw;
    const hh = p.hh + e.hh;
    const dx = Math.cos(e.angle);
    const dy = Math.sin(e.angle);
    // slab test of the ray (e.x, e.y) + t*(dx, dy), t >= 0, against the box
    let t0 = 0;
    let t1 = Infinity;
    for (const [o, d, lo, hi] of [
      [e.x, dx, p.x - hw, p.x + hw],
      [e.y, dy, p.y - hh, p.y + hh],
    ] as const) {
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) return false;
        continue;
      }
      let a = (lo - o) / d;
      let b = (hi - o) / d;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) return false;
    }
    return true;
  }

  private emit(body: EventBody): void {
    this.events.push({ ...body, t: this.tMs, wave: this.wave } as SimEvent);
  }

  /**
   * What a letter would do if it arrived now, so the app can play the keystroke
   * sound at once instead of waiting for the next step. Display only: step() decides.
   */
  predict(ch: string): "hit" | "miss" | "jammed" | "ignore" {
    if (this.phase !== "wave") return "ignore";
    if (this.jamT > 0) return "jammed";
    const lock = this.lockTarget;
    if (lock) {
      if (lock.word[lock.typed] === ch) return "hit";
      return this.cfg.snapShot && this.enemies.some((e) => e.kind === "bullet" && e.warned && !e.dying && e.word === ch) ? "hit" : "miss";
    }
    const live = this.enemies.filter((e) => !e.dying && !e.stray);
    if (!live.length) return "ignore";
    return live.some((e) => remaining(e)[0] === ch) ? "hit" : "miss";
  }

  /** Words per minute from correct letters over active play time. */
  get wpm(): number {
    const min = this.tMs / 60000;
    return min > 0 ? this.scoring.correct / 5 / min : 0;
  }
}
