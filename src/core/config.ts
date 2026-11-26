import raw from "../config.json";
import type { EnemyKind } from "./types";

export type RawConfig = typeof raw;

export interface EnemyTune {
  len: [number, number];
  /** world px/s, before the wave speed factor */
  speed: number;
  /** half hitbox, world px */
  hw: number;
  hh: number;
}

/**
 * Tunables with distances and speeds converted into world px. The raw file is in
 * the original 480x720 units; world.scale converts them.
 */
export interface Tunables {
  width: number;
  height: number;
  dt: number;
  spawnY: number;
  spawnXMargin: number;
  offscreenMargin: number;
  offscreenTop: number;
  player: { x: number; y: number; hw: number; hh: number };
  enemies: Record<EnemyKind, EnemyTune>;
  destroyer: { fireEvery: number; noFireWithin: number; aimXRange: [number, number] };
  oppressor: {
    fireEvery: number;
    noFireWithin: number;
    fanCountStart: number;
    fanCountMax: number;
    fanGrowEvery: number;
    fanSpread: number;
  };
  warnSeconds: number;
  snapShot: boolean;
  switchHintAfter: number;
  jamSeconds: number;
  missile: { straightFor: number; turnFor: number; turnRate: number };
  hit: { knockback: number; knockbackRandom: number; haltFor: number };
  boltSpeed: number;
  emp: {
    count: number;
    max: number;
    refillEvery: number;
    resetWave: boolean;
    respawnDelay: number;
    radius: number;
    duration: number;
  };
  waves: RawConfig["waves"];
  uniqueFirstLetterTries: number;
  multiplierSteps: { streak: number; multiplier: number }[];
  closeCallDistance: number;
}

export function resolveConfig(c: RawConfig = raw): Tunables {
  const k = c.world.scale;
  const enemy = (e: { len: number[]; speed: number; hitbox: number[] }): EnemyTune => ({
    len: [e.len[0]!, e.len[1]!],
    speed: e.speed * k,
    hw: (e.hitbox[0]! * k) / 2,
    hh: (e.hitbox[1]! * k) / 2,
  });
  const E = c.enemies;
  return {
    width: c.world.width,
    height: c.world.height,
    dt: 1 / c.world.simHz,
    spawnY: -c.world.spawnYAbove * k,
    spawnXMargin: c.world.spawnXMargin * k,
    offscreenMargin: c.world.offscreenMargin,
    offscreenTop: c.world.offscreenTop,
    player: {
      x: c.player.x,
      y: c.world.height - c.player.yFromBottom,
      hw: c.player.hitbox.w / 2,
      hh: c.player.hitbox.h / 2,
    },
    enemies: {
      mine: enemy(E.mine),
      destroyer: enemy(E.destroyer),
      oppressor: enemy(E.oppressor),
      missile: enemy(E.missile),
      bullet: enemy(E.bullet),
    },
    destroyer: {
      fireEvery: E.destroyer.fireEvery,
      noFireWithin: E.destroyer.noFireWithin * k,
      aimXRange: [E.destroyer.aimXRange[0]!, E.destroyer.aimXRange[1]!],
    },
    oppressor: {
      fireEvery: E.oppressor.fireEvery,
      noFireWithin: E.oppressor.noFireWithin * k,
      fanCountStart: E.oppressor.fanCountStart,
      fanCountMax: E.oppressor.fanCountMax,
      fanGrowEvery: E.oppressor.fanGrowEvery,
      fanSpread: (E.oppressor.fanSpreadDeg * Math.PI) / 180,
    },
    missile: {
      straightFor: E.missile.straightFor,
      turnFor: E.missile.turnFor,
      turnRate: E.missile.turnRate,
    },
    hit: {
      knockback: c.hit.knockback * k,
      knockbackRandom: c.hit.knockbackRandom * k,
      haltFor: c.hit.haltFor,
    },
    warnSeconds: c.warning.seconds,
    snapShot: c.warning.snapShot,
    switchHintAfter: c.hints.switchAfterMisses,
    jamSeconds: c.accuracy.jamSeconds,
    boltSpeed: c.bolt.speed * k,
    emp: {
      count: c.emp.count,
      max: c.emp.max,
      refillEvery: c.emp.refillEvery,
      resetWave: c.emp.resetWave,
      respawnDelay: c.emp.respawnDelay,
      radius: c.emp.radius * k,
      duration: c.emp.duration,
    },
    waves: c.waves,
    uniqueFirstLetterTries: c.words.uniqueFirstLetterTries,
    multiplierSteps: [...c.scoring.multiplierSteps].sort((a, b) => a.streak - b.streak),
    closeCallDistance: c.logging.closeCallDistance,
  };
}

export const rawConfig: RawConfig = raw;

/** Short stable hash of the config, so logged runs can be grouped by tuning. */
export function configHash(c: RawConfig = raw): string {
  const s = JSON.stringify(c);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
