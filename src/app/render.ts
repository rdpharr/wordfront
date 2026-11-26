import type { Sim } from "../core/sim";
import { remaining } from "../core/targeting";
import type { Enemy, EnemyKind, SimEvent } from "../core/types";
import type { Assets } from "./assets";
import type { Settings } from "./storage";

/**
 * Draws the playfield: a perspective road scrolling toward the squad, sprites,
 * effects, word labels and the HUD. Effects go under the words so labels stay
 * readable.
 */

const W = 540;
const H = 960;
const FONT = "'Segoe UI', system-ui, sans-serif";

/** road half-width on screen at the top and bottom of the playfield */
const ROAD_TOP = 104;
const ROAD_BOTTOM = 152;
/** screen px/s the road surface moves at the bottom of the screen */
const ROAD_SPEED = 22;
/** how long the "wave restarted" banner shows after an airstrike resets the wave */
const REGROUP_SECONDS = 2.0;
/** screen px per road strip; perspective changes ~0.1% per strip, so this is invisible */
const STRIP = 8;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
  color: string;
  grow: number;
}

interface Poof {
  x: number;
  y: number;
  t: number;
  size: number;
}

/** On-screen sprite height (px, before perspective) and walk style per enemy type. */
const LOOK: Record<EnemyKind, { sprite: "shambler" | "bomber" | "boss" | "firebomb" | "acid"; h: number; wobble: number }> = {
  mine: { sprite: "shambler", h: 64, wobble: 0.07 },
  destroyer: { sprite: "bomber", h: 78, wobble: 0.035 },
  oppressor: { sprite: "boss", h: 140, wobble: 0.025 },
  missile: { sprite: "firebomb", h: 36, wobble: 0 },
  bullet: { sprite: "acid", h: 24, wobble: 0 },
};

/** Squad layout inside the barricade arch, back row first (drawn first). */
const SOLDIERS: { dx: number; dy: number; h: number }[] = [
  { dx: -62, dy: -12, h: 54 },
  { dx: 0, dy: -20, h: 54 },
  { dx: 62, dy: -12, h: 54 },
  { dx: -31, dy: 26, h: 58 },
  { dx: 31, dy: 26, h: 58 },
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** sprites shrink a little toward the top of the road */
const depth = (y: number) => lerp(0.8, 1, clamp01(y / H));

export interface FrameInfo {
  alpha: number;
  frameDt: number;
  hideWords: boolean;
  settings: Settings;
  /** seconds, for idle animation */
  time: number;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private poofs: Poof[] = [];
  private shake = 0;
  private flash = 0;
  private aimX = W / 2;
  private aimY = 0;
  private waveToast = 0;
  /** glow on the airstrike panel after one is earned */
  private strikePulse = 0;
  /** fade of the "Backspace: switch target" tag under a stuck lock */
  private switchHint = 0;
  /** "wave reset" note after an airstrike starts the wave over */
  private regroup = { n: 0, t: 0 };
  private scroll = 0;
  private muzzle: number[] = SOLDIERS.map(() => 0);
  private nextShooter = 0;
  private stripV: Float32Array;
  private stripS: Float32Array;
  private water: CanvasPattern | null = null;
  /** the road texture copied into a canvas: drawing from a canvas is much faster than from an <img> */
  private groundTex: HTMLCanvasElement;

  constructor(
    private canvas: HTMLCanvasElement,
    private assets: Assets,
  ) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;

    // Perspective road: each screen strip maps to a texture row. Scale s(y) grows
    // linearly toward the bottom, so texture rows advance by 1/s per screen px.
    const g = assets.manifest.ground;
    const roadTex = g.roadRight - g.roadLeft;
    const sTop = (2 * ROAD_TOP) / roadTex;
    const sBot = (2 * ROAD_BOTTOM) / roadTex;
    const n = Math.ceil(H / STRIP) + 1;
    this.stripV = new Float32Array(n);
    this.stripS = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const y = i * STRIP;
      const s = sTop + ((sBot - sTop) * y) / H;
      this.stripS[i] = s;
      this.stripV[i] = (H / (sBot - sTop)) * Math.log(s / sTop);
    }
    this.groundTex = document.createElement("canvas");
    this.groundTex.width = assets.img.ground.width;
    this.groundTex.height = assets.img.ground.height;
    this.groundTex.getContext("2d")!.drawImage(assets.img.ground, 0, 0);
    const water = document.createElement("canvas");
    water.width = assets.img.water.width;
    water.height = assets.img.water.height;
    water.getContext("2d")!.drawImage(assets.img.water, 0, 0);
    this.water = ctx.createPattern(water, "repeat");
  }

  /** Size the backing store for the CSS size and device pixel ratio. */
  resize(cssW: number, cssH: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.ctx.imageSmoothingQuality = "high";
  }

  reset(): void {
    this.particles = [];
    this.poofs = [];
    this.shake = 0;
    this.flash = 0;
    this.aimX = W / 2;
    this.aimY = 0;
    this.waveToast = 0;
    this.regroup = { n: 0, t: 0 };
    this.switchHint = 0;
    this.strikePulse = 0;
    this.muzzle.fill(0);
  }

  /** Turn sim events into effects. */
  onEvents(evs: readonly SimEvent[], s: Settings): void {
    const motion = !s.reducedMotion;
    const shake = motion && s.screenShake;
    for (const e of evs) {
      switch (e.type) {
        case "key":
          if (e.correct) {
            this.muzzle[this.nextShooter] = 0.07;
            this.nextShooter = (this.nextShooter + 1) % SOLDIERS.length;
          }
          break;
        case "hit":
          this.puff(e.x, e.y + 8, 3, "rgba(226,206,170,0.9)", 1);
          if (e.final) this.poof(e.x, e.y, shake);
          break;
        case "kill":
          if (e.cause === "emp") this.poof(e.x, e.y, false);
          break;
        case "emp_fire":
          if (motion) this.flash = 1;
          if (shake) this.shake = Math.max(this.shake, 9);
          break;
        case "airstrike":
          if (e.requeued > 0) this.regroup = { n: e.toGo, t: REGROUP_SECONDS };
          break;
        case "airstrike_earned":
          this.strikePulse = 1;
          break;
        case "wave_start":
          this.waveToast = 1.6;
          break;
        case "death":
          this.poof(W / 2, H - 120, shake);
          if (shake) this.shake = 14;
          break;
      }
    }
  }

  private puff(x: number, y: number, n: number, color: string, size: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 20 + Math.random() * 40;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 20,
        life: 0,
        max: 0.35 + Math.random() * 0.2,
        r: (3 + Math.random() * 4) * size,
        color,
        grow: 14,
      });
    }
  }

  private poof(x: number, y: number, shake: boolean): void {
    this.poofs.push({ x, y, t: 0, size: 76 * depth(y) });
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 90 + Math.random() * 120;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 0,
        max: 0.3 + Math.random() * 0.2,
        r: 2.5,
        color: "#ffd84a",
        grow: -4,
      });
    }
    if (shake) this.shake = Math.max(this.shake, 5);
  }

  /** Title / menu backdrop: the key art, cover-fitted. */
  drawTitle(): void {
    const c = this.ctx;
    const k = this.canvas.width / W;
    c.setTransform(k, 0, 0, k, 0, 0);
    const img = this.assets.img.title;
    const s = H / img.height;
    const w = img.width * s;
    c.drawImage(img, (W - w) / 2, 0, w, H);
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(10,20,30,0.15)");
    g.addColorStop(0.5, "rgba(10,20,30,0.35)");
    g.addColorStop(1, "rgba(10,20,30,0.15)");
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }

  draw(sim: Sim, f: FrameInfo): void {
    const c = this.ctx;
    const hc = f.settings.highContrast;
    const k = this.canvas.width / W;
    c.setTransform(k, 0, 0, k, 0, 0);

    const dt = f.frameDt;
    this.scroll += dt * ROAD_SPEED;
    this.waveToast = Math.max(0, this.waveToast - dt);
    this.regroup.t = Math.max(0, this.regroup.t - dt);
    this.flash = Math.max(0, this.flash - dt * 3);
    this.strikePulse = Math.max(0, this.strikePulse - dt);
    this.switchHint = sim.showSwitchHint ? Math.min(1, this.switchHint + dt * 8) : Math.max(0, this.switchHint - dt * 4);
    this.shake = Math.max(0, this.shake - dt * 30);
    for (let i = 0; i < this.muzzle.length; i++) this.muzzle[i] = Math.max(0, this.muzzle[i]! - dt);
    let sx = 0;
    let sy = 0;
    if (this.shake > 0 && f.settings.screenShake && !f.settings.reducedMotion) {
      sx = (Math.random() - 0.5) * this.shake;
      sy = (Math.random() - 0.5) * this.shake;
    }
    c.save();
    c.translate(sx, sy);

    this.drawGround();
    if (hc) {
      c.fillStyle = "rgba(0,0,0,0.45)";
      c.fillRect(-20, -20, W + 40, H + 40);
    }

    const target = sim.lockTarget;
    const p = { x: sim.playerX, y: sim.playerY };
    // the squad's aim point eases toward the locked target (straight up the road otherwise)
    const tx = target ? lerp(target.px, target.x, f.alpha) : W / 2;
    const ty = target ? lerp(target.py, target.y, f.alpha) : 0;
    const ease = Math.min(1, dt * 14);
    this.aimX += (tx - this.aimX) * ease;
    this.aimY += (ty - this.aimY) * ease;

    if (target) this.drawLock(p.x, p.y, tx, ty, target, hc);
    if (sim.emp) this.drawEmp(p.x, p.y, sim.emp.r);

    // far enemies first, so nearer ones overlap them
    const order = [...sim.enemies].sort((a, b) => a.y - b.y);
    // projectiles on course to hit the squad get a warning ring and a red label
    const danger = new Set(sim.enemies.filter((e) => sim.incoming(e)).map((e) => e.id));
    for (const e of order) this.drawEnemy(e, f.alpha, f.time, danger.has(e.id), hc);
    this.drawSquad(p.x, p.y, sim.phase === "over");
    if (sim.jamT > 0 && sim.phase === "wave") this.drawJam(p.x, p.y, sim.jamT / Math.max(1e-6, sim.cfg.jamSeconds), hc);
    for (const b of sim.bolts) this.drawBolt(lerp(b.px, b.x, f.alpha), lerp(b.py, b.y, f.alpha), b.px, b.py);

    this.updatePoofs(dt);
    this.updateParticles(dt);

    if (!f.hideWords) {
      const lock = sim.lockTarget;
      for (const e of sim.enemies) if (!e.dying && e !== lock) this.drawLabel(e, f.alpha, false, f, danger.has(e.id));
      if (lock) this.drawLabel(lock, f.alpha, true, f, danger.has(lock.id), this.switchHint, sim.jamT > 0);
    }
    c.restore();

    if (f.hideWords) {
      c.fillStyle = "rgba(10,20,30,0.45)";
      c.fillRect(0, 0, W, H);
    }
    if (this.flash > 0) {
      c.fillStyle = `rgba(255,255,255,${0.6 * this.flash})`;
      c.fillRect(0, 0, W, H);
    }

    this.drawHud(sim);
    if (sim.phase === "break")
      this.drawBanner(`WAVE ${sim.wave} CLEARED`, `Accuracy ${(sim.waveAccuracy * 100).toFixed(1)}%`);
    else if (sim.phase === "wave" && this.waveToast > 0 && !f.hideWords)
      this.drawBanner(`WAVE ${sim.wave}`, null, Math.min(1, this.waveToast * 2));
    if (sim.phase === "wave" && this.regroup.t > 0 && !f.hideWords) {
      // quick fade in, hold, fade out over the last half second
      const a = Math.min(1, (REGROUP_SECONDS - this.regroup.t) * 6, this.regroup.t * 2);
      this.drawBanner(`WAVE ${sim.wave} RESTARTED`, `Airstrike used · ${this.regroup.n} enemies to go`, a);
    }
  }

  // ------------------------------------------------------------ scene

  private drawGround(): void {
    const c = this.ctx;
    const ground = this.groundTex;
    const g = this.assets.manifest.ground;
    const texH = g.h;
    const sBot = this.stripS[this.stripS.length - 1]!;
    const scrollTex = this.scroll / sBot;

    // water: a flat repeating pattern, scrolled at the same speed as the near road
    if (this.water) {
      const ws = sBot * 0.9;
      this.water.setTransform(new DOMMatrix().translateSelf(0, (this.scroll * 0.9) % (texH * ws)).scaleSelf(ws));
      c.fillStyle = this.water;
      c.fillRect(-20, -20, W + 40, H + 40);
    }

    // road: one texture row band per screen strip, scaled for perspective
    const left = g.roadLeft - 2;
    const width = g.roadRight - g.roadLeft + 4;
    const centre = (g.roadLeft + g.roadRight) / 2;
    for (let i = 0; i < this.stripS.length; i++) {
      const y = i * STRIP;
      const s = this.stripS[i]!;
      let v = (this.stripV[i]! - scrollTex) % texH;
      if (v < 0) v += texH;
      const sh = STRIP / s; // texture rows this strip covers
      const dx = W / 2 - (centre - left) * s;
      const first = Math.min(sh, texH - v);
      // +0.6 px overlap hides seams between strips
      c.drawImage(ground, left, v, width, first, dx, y, width * s, (first / sh) * STRIP + 0.6);
      if (first < sh) {
        // the strip crosses the texture's wrap point: draw the rest from the top
        const rest = sh - first;
        const y2 = y + (first / sh) * STRIP;
        c.drawImage(ground, left, 0, width, rest, dx, y2, width * s, (rest / sh) * STRIP + 0.6);
      }
    }
  }

  private drawSquad(x: number, y: number, dead: boolean): void {
    const c = this.ctx;
    const { barricade } = this.assets.img;
    const bw = 290;
    const bh = (bw * barricade.height) / barricade.width;
    c.drawImage(barricade, x - bw / 2, y - bh * 0.45, bw, bh);

    SOLDIERS.forEach((s, i) => {
      const sx = x + s.dx;
      const sy = y + s.dy;
      const ang = Math.atan2(this.aimY - sy, this.aimX - sx);
      let d = ang + Math.PI / 2; // 0 = straight up, negative = left
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const up = Math.abs(d) < 0.4;
      const art = this.assets.soldiers[i]!;
      const img = up ? art.up : art.left;
      const flip = !up && d > 0;
      const tilt = up ? d * 0.6 : Math.max(-0.35, Math.min(0.35, (Math.abs(d) - 0.78) * 0.5)) * (flip ? 1 : -1);
      const h = s.h;
      const w = (h * img.width) / img.height;
      c.save();
      c.translate(sx, sy);
      c.rotate(tilt);
      if (flip) c.scale(-1, 1);
      if (dead) c.globalAlpha = 0.5;
      c.drawImage(img, -w / 2, -h / 2, w, h);
      c.restore();

      if (this.muzzle[i]! > 0 && !dead) {
        const mx = sx + Math.cos(ang) * 32;
        const my = sy + Math.sin(ang) * 32 - 8;
        c.save();
        c.fillStyle = "rgba(255,230,120,0.95)";
        c.shadowColor = "#ffd84a";
        c.shadowBlur = 10;
        c.beginPath();
        c.arc(mx, my, 5, 0, Math.PI * 2);
        c.fill();
        c.restore();
      }
    });
  }

  private drawLock(px: number, py: number, tx: number, ty: number, e: Enemy, hc: boolean): void {
    const c = this.ctx;
    const L = LOOK[e.kind];
    const h = L.h * depth(ty);
    c.save();
    c.strokeStyle = hc ? "#ffff00" : "rgba(255,154,31,0.75)";
    c.lineWidth = 2;
    c.setLineDash([8, 8]);
    c.beginPath();
    c.moveTo(px, py - 30);
    c.lineTo(tx, ty);
    c.stroke();
    c.setLineDash([]);
    c.lineWidth = 4;
    c.strokeStyle = hc ? "#ffff00" : "#ff9a1f";
    const r = Math.max(10, h * 0.42);
    c.beginPath();
    c.ellipse(tx, ty + h * 0.42, r, r * 0.38, 0, 0, Math.PI * 2);
    c.stroke();
    c.restore();
  }

  private drawEmp(x: number, y: number, r: number): void {
    const c = this.ctx;
    c.save();
    c.strokeStyle = "rgba(255,255,255,0.9)";
    c.lineWidth = 10;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = "rgba(255,216,74,0.6)";
    c.lineWidth = 22;
    c.beginPath();
    c.arc(x, y, Math.max(0, r - 14), 0, Math.PI * 2);
    c.stroke();
    c.restore();
  }

  private drawEnemy(e: Enemy, alpha: number, time: number, danger: boolean, hc: boolean): void {
    const c = this.ctx;
    const x = lerp(e.px, e.x, alpha);
    const y = lerp(e.py, e.y, alpha);
    const L = LOOK[e.kind];
    const img = this.assets.img[L.sprite];
    const sc = depth(y);
    const h = L.h * sc;
    const w = (h * img.width) / img.height;
    const ph = time * 9 + e.id * 1.7;
    if (danger) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 12);
      const r = Math.max(w, h) * 0.62 + 3 * pulse;
      c.save();
      c.fillStyle = `rgba(255,40,40,${0.18 + 0.12 * pulse})`;
      c.strokeStyle = hc ? "#ff4040" : `rgba(255,60,60,${0.7 + 0.3 * pulse})`;
      c.lineWidth = 3;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.restore();
    }
    c.save();
    c.translate(x, y);
    if (e.dying) c.globalAlpha = 0.55;
    if (e.kind === "missile") {
      c.rotate(e.angle + Math.PI / 2); // art points up
      const flick = 1 + Math.sin(time * 40 + e.id) * 0.06;
      c.drawImage(img, -w / 2, -h / 2, w, h * flick);
    } else if (e.kind === "bullet") {
      const wob = 1 + Math.sin(time * 14 + e.id) * 0.08;
      c.drawImage(img, (-w * wob) / 2, (-h / wob) / 2, w * wob, h / wob);
    } else {
      const heavy = e.kind === "oppressor" ? 0.55 : 1;
      const bob = Math.abs(Math.sin(ph * heavy)) * 3 * heavy;
      c.rotate(Math.sin(ph * 0.5 * heavy) * L.wobble);
      // face the way it's drifting
      if (e.kind === "mine" && Math.cos(e.angle) < -0.15) c.scale(-1, 1);
      c.drawImage(img, -w / 2, -h / 2 - bob, w, h);
    }
    c.restore();

    if (e.kind === "oppressor" && !e.dying) {
      const frac = (e.word.length - e.typed) / e.word.length;
      const bw = 70 * sc;
      const by = y - h / 2 - 12;
      c.fillStyle = "rgba(43,29,18,0.85)";
      c.beginPath();
      c.roundRect(x - bw / 2 - 2, by - 2, bw + 4, 10, 5);
      c.fill();
      c.fillStyle = "#7ee04f";
      c.beginPath();
      c.roundRect(x - bw / 2, by, bw * frac, 6, 3);
      c.fill();
    }
  }

  private drawBolt(x: number, y: number, px: number, py: number): void {
    const c = this.ctx;
    const dx = x - px;
    const dy = y - py;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    c.save();
    c.lineCap = "round";
    // a small volley: three tracers side by side
    for (const off of [-6, 0, 6]) {
      const ox = -uy * off;
      const oy = ux * off;
      const back = off === 0 ? 24 : 16;
      c.strokeStyle = "rgba(255,216,74,0.5)";
      c.lineWidth = 6;
      c.beginPath();
      c.moveTo(x + ox - ux * back, y + oy - uy * back);
      c.lineTo(x + ox, y + oy);
      c.stroke();
      c.strokeStyle = "#fff6b0";
      c.lineWidth = 2.5;
      c.stroke();
    }
    c.restore();
  }

  private updatePoofs(dt: number): void {
    const c = this.ctx;
    const img = this.assets.img.poof;
    const keep: Poof[] = [];
    for (const p of this.poofs) {
      p.t += dt;
      const life = 0.45;
      if (p.t >= life) continue;
      const u = p.t / life;
      const s = p.size * (0.5 + 0.7 * Math.min(1, u * 2.5));
      c.globalAlpha = u < 0.45 ? 1 : 1 - (u - 0.45) / 0.55;
      c.drawImage(img, p.x - s / 2, p.y - s / 2, s, s);
      keep.push(p);
    }
    c.globalAlpha = 1;
    this.poofs = keep;
  }

  private updateParticles(dt: number): void {
    const c = this.ctx;
    const keep: Particle[] = [];
    for (const p of this.particles) {
      p.life += dt;
      if (p.life >= p.max) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      p.r = Math.max(0.5, p.r + p.grow * dt);
      c.globalAlpha = 1 - p.life / p.max;
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      c.fill();
      keep.push(p);
    }
    c.globalAlpha = 1;
    this.particles = keep;
  }

  // ------------------------------------------------------------ text

  private drawLabel(e: Enemy, alpha: number, locked: boolean, f: FrameInfo, danger = false, hint = 0, jammed = false): void {
    const c = this.ctx;
    const text = remaining(e);
    if (!text) return;
    // a warned, on-course Bullet: bigger label that pulses so it stands out among words
    const alarm = danger && e.warned && !locked;
    const pulse = alarm ? 0.5 + 0.5 * Math.sin(f.time * 14) : 0;
    const size = (f.settings.largeLabels ? 24 : 18) * (alarm ? 1.35 + 0.1 * pulse : 1);
    const hc = f.settings.highContrast;
    c.font = `800 ${size}px ${FONT}`;
    const tw = c.measureText(text).width;
    const padX = size * 0.5;
    const h = size * 1.45;
    const w = tw + padX * 2;
    const x = lerp(e.px, e.x, alpha);
    const y = lerp(e.py, e.y, alpha);
    // a jam rattles the locked word sideways
    const rattle = jammed && !f.settings.reducedMotion ? Math.sin(f.time * 70) * 3 : 0;
    let lx = x - w / 2 + rattle;
    let ly = y + (LOOK[e.kind].h * depth(y)) / 2 - 2;
    lx = Math.max(4, Math.min(W - 4 - w, lx));
    ly = Math.max(62, Math.min(H - 4 - h, ly));
    c.fillStyle = hc ? "#000000" : alarm ? `rgba(${90 + 80 * pulse},10,6,0.9)` : "rgba(20,14,8,0.78)";
    c.beginPath();
    c.roundRect(lx, ly, w, h, h / 2);
    c.fill();
    if (locked || hc || danger) {
      c.strokeStyle = locked ? (hc ? "#ffff00" : "#ff9a1f") : danger ? "#ff4a4a" : "#ffffff";
      c.lineWidth = alarm ? 4 : danger && !locked ? 3 : 2;
      c.stroke();
    }
    c.fillStyle = locked ? (hc ? "#ffff00" : "#ffa53a") : "#ffffff";
    c.textBaseline = "middle";
    c.fillText(text, lx + padX, ly + h / 2 + 1);
    if (hint > 0) this.drawSwitchHint(lx + w / 2, ly + h + 4, hint, hc);
  }

  /** "JAMMED" over the squad while a wrong letter has the rifles jammed; fades as it clears. */
  private drawJam(x: number, y: number, left: number, hc: boolean): void {
    const c = this.ctx;
    const text = "JAMMED";
    c.save();
    c.globalAlpha = Math.min(1, 0.35 + left);
    c.font = `900 16px ${FONT}`;
    const w = c.measureText(text).width + 22;
    const h = 26;
    const top = y - 92;
    c.fillStyle = hc ? "#000000" : "rgba(150,20,12,0.92)";
    c.strokeStyle = hc ? "#ff4040" : "#2b1d12";
    c.lineWidth = 2;
    c.beginPath();
    c.roundRect(x - w / 2, top, w, h, h / 2);
    c.fill();
    c.stroke();
    // the bar under the text drains as the jam clears
    c.fillStyle = "#ffc53a";
    c.fillRect(x - w / 2 + 10, top + h - 6, (w - 20) * left, 3);
    c.fillStyle = "#fff6e3";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(text, x, top + h / 2 - 1);
    c.restore();
  }

  /** Tag under a locked word the player keeps missing: Backspace drops the target. */
  private drawSwitchHint(cx: number, top: number, a: number, hc: boolean): void {
    const c = this.ctx;
    const text = "⌫ Backspace: switch target";
    c.save();
    c.globalAlpha = a;
    c.font = `800 14px ${FONT}`;
    const w = c.measureText(text).width + 16;
    const h = 22;
    const x = Math.max(4, Math.min(W - 4 - w, cx - w / 2));
    const y = Math.min(H - 4 - h, top);
    c.fillStyle = hc ? "#ffff00" : "#ffc53a";
    c.strokeStyle = "#2b1d12";
    c.lineWidth = 2;
    c.beginPath();
    c.roundRect(x, y, w, h, h / 2);
    c.fill();
    c.stroke();
    c.fillStyle = "#2b1d12";
    c.textBaseline = "middle";
    c.fillText(text, x + 8, y + h / 2 + 1);
    c.restore();
  }

  private panel(x: number, y: number, w: number, h: number): void {
    const c = this.ctx;
    c.fillStyle = "rgba(43,29,18,0.85)";
    c.strokeStyle = "#2b1d12";
    c.lineWidth = 3;
    c.beginPath();
    c.roundRect(x, y, w, h, 14);
    c.fill();
    c.stroke();
  }

  private drawHud(sim: Sim): void {
    const c = this.ctx;
    c.textBaseline = "middle";
    // score
    this.panel(10, 10, 170, 44);
    c.fillStyle = "#fff6e3";
    c.font = `700 12px ${FONT}`;
    c.fillText("SCORE", 22, 23);
    c.font = `900 22px ${FONT}`;
    c.fillText(String(sim.scoring.score), 22, 41);
    // multiplier badge
    const m = sim.scoring.multiplier;
    c.fillStyle = m === 1 ? "#8a7a66" : m === 2 ? "#ffc53a" : "#ff7a1f";
    c.strokeStyle = "#2b1d12";
    c.lineWidth = 3;
    c.beginPath();
    c.arc(212, 32, 22, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.fillStyle = "#2b1d12";
    c.font = `900 18px ${FONT}`;
    c.textAlign = "center";
    c.fillText(`×${m}`, 212, 33);
    // wave
    this.panel(246, 10, 120, 44);
    c.fillStyle = "#fff6e3";
    c.font = `700 12px ${FONT}`;
    c.fillText("WAVE", 306, 23);
    c.font = `900 22px ${FONT}`;
    c.fillText(String(sim.wave), 306, 41);
    c.textAlign = "left";
    // airstrikes left
    this.panel(376, 10, 154, 44);
    c.fillStyle = "#fff6e3";
    c.font = `700 12px ${FONT}`;
    c.fillText("AIRSTRIKE ⏎", 388, 23);
    const icon = this.assets.img.airstrike_icon;
    const { max, refillEvery } = sim.cfg.emp;
    for (let i = 0; i < max; i++) {
      c.globalAlpha = i < sim.empsLeft ? 1 : 0.2;
      // the newest airstrike pops in when earned
      const pop = i === sim.empsLeft - 1 ? this.strikePulse * 6 : 0;
      c.drawImage(icon, 386 + i * 26 - pop / 2, 31 - pop / 2, 21 + pop, 21 + pop);
    }
    c.globalAlpha = 1;
    // progress toward the next one (words typed), while below max
    if (sim.empsLeft < max && refillEvery > 0) {
      const x = 468;
      const bw = 52;
      c.fillStyle = "rgba(0,0,0,0.45)";
      c.fillRect(x, 38, bw, 8);
      c.fillStyle = "#ffc53a";
      c.fillRect(x, 38, (bw * sim.refillProgress) / refillEvery, 8);
      c.strokeStyle = "#2b1d12";
      c.lineWidth = 2;
      c.strokeRect(x, 38, bw, 8);
    }
    if (this.strikePulse > 0) {
      c.save();
      c.globalAlpha = this.strikePulse;
      c.strokeStyle = "#ffc53a";
      c.lineWidth = 3;
      c.strokeRect(374, 8, 158, 48);
      c.restore();
    }
  }

  private drawBanner(title: string, sub: string | null, a = 1): void {
    const c = this.ctx;
    c.save();
    c.globalAlpha = a;
    const y = H * 0.38;
    this.panel(70, y - 50, W - 140, sub ? 100 : 72);
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillStyle = "#ffc53a";
    c.font = `900 32px ${FONT}`;
    c.fillText(title, W / 2, y - (sub ? 18 : 14));
    if (sub) {
      c.fillStyle = "#fff6e3";
      c.font = `700 18px ${FONT}`;
      c.fillText(sub, W / 2, y + 22);
    }
    c.restore();
  }
}
