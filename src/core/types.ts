export type EnemyKind = "mine" | "destroyer" | "oppressor" | "missile" | "bullet";
export const ENEMY_KINDS: readonly EnemyKind[] = ["mine", "destroyer", "oppressor", "missile", "bullet"];

export interface Enemy {
  id: number;
  kind: EnemyKind;
  word: string;
  /** letters of `word` already typed */
  typed: number;
  x: number;
  y: number;
  /** position at the previous step, for render interpolation */
  px: number;
  py: number;
  /** heading in radians (0 = +x, PI/2 = down the screen) */
  angle: number;
  speed: number;
  hw: number;
  hh: number;
  /** knockback: while haltT > 0 the enemy drifts at (kbx, kby) instead of advancing */
  haltT: number;
  kbx: number;
  kby: number;
  /** seconds until the next shot (destroyer / oppressor) */
  fireT: number;
  age: number;
  /** destroyed by typing; kept only until its in-flight bolts land */
  dying: boolean;
  dyingT: number;
  pendingBolts: number;
  closeCalled: boolean;
  /** an on-course Bullet that has had its incoming warning */
  warned: boolean;
  missesOnWord: number;
  spawnMs: number;
}

export interface Bolt {
  id: number;
  targetId: number;
  x: number;
  y: number;
  px: number;
  py: number;
}

export interface Emp {
  t: number;
  r: number;
  destroyed: number;
  /** enemies added back to the wave's queue when the strike reset the wave */
  requeued: number;
  nearestBefore: number | null;
}

export type SimInput = { kind: "char"; ch: string } | { kind: "backspace" } | { kind: "emp" };

export type Phase = "wave" | "break" | "over";

export type Composition = Record<"mine" | "destroyer" | "oppressor", number>;

interface Base {
  /** ms of active play since the run started */
  t: number;
  wave: number;
}

export type SimEvent = Base &
  (
    | { type: "wave_start"; composition: Composition; spawnLps: number; speedFactor: number }
    | {
        type: "spawn";
        id: number;
        kind: EnemyKind;
        word: string;
        x: number;
        y: number;
        speed: number;
        parent: number | null;
      }
    | { type: "lock"; id: number; candidates: number; distance: number; msSinceSpawn: number }
    | {
        type: "key";
        char: string;
        expected: string | null;
        correct: boolean;
        id: number | null;
        msSincePrev: number | null;
        step: number;
        multiplier: number;
      }
    | { type: "release"; id: number; lettersLeft: number }
    | { type: "switch_hint"; id: number }
    | { type: "jammed"; char: string }
    | { type: "hit"; id: number; final: boolean; x: number; y: number }
    | {
        type: "kill";
        id: number;
        kind: EnemyKind;
        cause: "typed" | "emp";
        msAlive: number;
        distance: number;
        misses: number;
        x: number;
        y: number;
      }
    | { type: "fire"; id: number; kind: "missile" | "bullets" }
    | { type: "emp_fire"; left: number }
    | { type: "airstrike_earned"; left: number }
    | { type: "airstrike"; destroyed: number; requeued: number; toGo: number; nearestBefore: number | null }
    | { type: "close_call"; id: number; kind: EnemyKind; lettersLeft: number }
    | { type: "incoming"; id: number; kind: EnemyKind; eta: number }
    | {
        type: "wave_end";
        duration: number;
        accuracy: number;
        misses: number;
        peakEnemies: number;
        closestApproach: number | null;
        airstrikesLeft: number;
      }
    | {
        type: "death";
        killerKind: EnemyKind;
        killerWord: string;
        lettersLeft: number;
        enemiesOnScreen: number;
      }
  );
