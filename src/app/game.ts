import pkg from "../../package.json";
import { configHash, rawConfig, resolveConfig } from "../core/config";
import { RunLogger, wordsHash } from "../core/runlog";
import { Sim } from "../core/sim";
import type { SimEvent, SimInput } from "../core/types";
import { WordBank } from "../core/words";
import { WORDS } from "../core/wordlist";
import { loadAssets } from "./assets";
import { Audio } from "./audio";
import { keyToInput } from "./keys";
import { detectPlatform } from "./platform";
import { Renderer } from "./render";
import { bestScore, insertScore, parseSave, qualifies, Saver, type HighScore, type SaveData } from "./storage";

type State = "title" | "options" | "playing" | "paused" | "dying" | "over";

const cfg = resolveConfig();
const bank = new WordBank(WORDS);
const RUN_INFO = {
  build: pkg.version,
  configHash: configHash(rawConfig),
  wordsHash: wordsHash(WORDS),
  tunables: rawConfig,
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export class App {
  private platform = detectPlatform();
  private data: SaveData = parseSave(null);
  private saver = new Saver((json) => this.platform.writeSave(json));
  private logger: RunLogger | null = null;
  private renderer: Renderer | null = null;
  private audio = new Audio(() => this.data.settings);
  sim: Sim | null = null;
  state: State = "title";
  private queue: SimInput[] = [];
  private acc = 0;
  private last = 0;
  private dyingT = 0;
  private optionsFrom: State = "title";

  constructor(
    private stage: HTMLElement,
    private canvas: HTMLCanvasElement,
    private ui: HTMLElement,
  ) {}

  async start(): Promise<void> {
    this.layout();
    this.screen(`<h2>Loading…</h2>`);
    let assets;
    try {
      assets = await loadAssets();
    } catch (err) {
      console.error(err);
      this.screen(`<h2>Couldn't load the game files</h2><p class="muted">${esc(String(err))}</p>`);
      return;
    }
    try {
      this.data = parseSave(await this.platform.loadSave());
      void this.saver.save(this.data); // creates save.json on first run
    } catch (err) {
      console.error("couldn't read the save file", err);
    }
    this.renderer = new Renderer(this.canvas, assets);
    // music decodes in the background; it starts once it's ready
    this.audio.init(assets.manifest).catch((err) => console.error("music failed to load", err));
    // browsers only allow audio after a user gesture
    const unlock = () => this.audio.unlock();
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);

    window.addEventListener("resize", () => this.layout());
    window.addEventListener("keydown", (e) => this.onKey(e));
    window.addEventListener("blur", () => this.autoPause());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.autoPause();
    });
    window.addEventListener("contextmenu", (e) => e.preventDefault());
    // closing the window mid-run still finishes its log
    window.addEventListener("pagehide", () => this.logger?.endNow("quit"));
    this.platform.onCloseRequested(async () => {
      await this.logger?.end("quit");
      await this.saver.idle();
    });
    this.layout();
    this.showTitle();
    requestAnimationFrame((t) => {
      this.last = t;
      this.frame(t);
    });
  }

  private layout(): void {
    let h = window.innerHeight;
    let w = (h * 9) / 16;
    if (w > window.innerWidth) {
      w = window.innerWidth;
      h = (w * 16) / 9;
    }
    this.stage.style.width = `${w}px`;
    this.stage.style.height = `${h}px`;
    this.ui.style.setProperty("--u", `${w / 540}px`);
    this.renderer?.resize(w, h);
  }

  // ------------------------------------------------------------- loop

  private frame(now: number): void {
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    const sim = this.sim;

    if (sim && this.state === "playing") {
      this.acc += dt;
      while (this.acc >= cfg.dt) {
        const inputs = this.queue.splice(0);
        const evs = sim.step(inputs);
        this.acc -= cfg.dt;
        this.logger?.inputs(inputs);
        this.logger?.events(evs);
        this.handle(evs);
        if (sim.phase === "over") {
          void this.logger?.end("death");
          this.state = "dying";
          this.dyingT = 1.4;
          this.acc = 0;
          this.audio.music(null, 0.4);
          break;
        }
      }
    } else if (this.state === "dying") {
      this.dyingT -= dt;
      if (this.dyingT <= 0) this.showGameOver();
    }

    const paused = this.state === "paused" || (this.state === "options" && this.optionsFrom === "paused");
    if (this.renderer) {
      if (!sim || this.state === "title" || (this.state === "options" && this.optionsFrom === "title")) {
        this.renderer.drawTitle();
      } else {
        this.renderer.draw(sim, {
          alpha: this.state === "playing" ? this.acc / cfg.dt : 1,
          frameDt: paused ? 0 : dt,
          hideWords: paused,
          settings: this.data.settings,
          time: now / 1000,
        });
      }
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  private handle(evs: readonly SimEvent[]): void {
    if (!evs.length) return;
    this.renderer?.onEvents(evs, this.data.settings);
    for (const e of evs) {
      switch (e.type) {
        case "kill":
          this.audio.kill();
          break;
        case "spawn":
          if (e.kind === "oppressor") this.audio.bossRoar();
          break;
        case "emp_fire":
          this.audio.airstrike();
          break;
        case "incoming":
          this.audio.incoming();
          break;
        case "airstrike_earned":
          this.audio.airstrikeEarned();
          break;
        case "airstrike":
          if (e.requeued > 0) this.audio.waveReset();
          break;
        case "wave_end":
          this.audio.fanfare();
          break;
        case "death":
          this.audio.gameOver();
          break;
      }
    }
  }

  // ------------------------------------------------------------- input

  private onKey(e: KeyboardEvent): void {
    if (this.state === "playing") {
      const k = keyToInput(e);
      if (e.key === " " || e.key === "Backspace" || e.key === "Tab" || e.key === "Enter") e.preventDefault();
      if (!k) return;
      e.preventDefault();
      if (k.kind === "pause") {
        this.pause("esc");
        return;
      }
      if (k.kind === "char" && this.sim) {
        const p = this.sim.predict(k.ch);
        if (p === "hit") this.audio.shot(this.sim.scoring.multiplier);
        else if (p === "miss") this.audio.jam();
        else if (p === "jammed") this.audio.jammedKey();
      }
      this.queue.push(k);
      return;
    }
    // menus: arrows move focus, Esc goes back
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const items = [...this.ui.querySelectorAll<HTMLElement>("button, input")];
      if (!items.length) return;
      const i = items.indexOf(document.activeElement as HTMLElement);
      const n = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[n]!.focus();
      e.preventDefault();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (this.state === "paused") this.resume("esc");
      else if (this.state === "options") this.closeOptions();
    }
  }

  private autoPause(): void {
    if (this.state === "playing") this.pause("focus");
  }

  // ------------------------------------------------------------- flow

  private newGame(): void {
    this.audio.unlock();
    const seed = (Math.random() * 2 ** 32) >>> 0;
    this.sim = new Sim(cfg, bank, seed);
    this.logger = null;
    if (this.data.settings.logging) {
      const p = this.platform;
      this.logger = new RunLogger(
        { write: (f, t) => p.appendLog(f, t), writeNow: (f, t) => p.appendLogNow(f, t) },
        this.sim,
        RUN_INFO,
      );
      p.pruneLogs(rawConfig.logging.maxRuns, rawConfig.logging.maxBytes).catch((err) => console.error(err));
    }
    this.renderer?.reset();
    this.audio.duck(false);
    this.audio.music("game");
    this.queue = [];
    this.acc = 0;
    this.state = "playing";
    this.screen(null);
  }

  /** reason is logged when play stops; omitted when returning to the pause menu */
  private pause(reason?: string): void {
    if (reason && this.state === "playing") this.logger?.pause(reason);
    this.state = "paused";
    this.queue = [];
    this.audio.duck(true);
    this.screen(
      `<h2>Paused</h2>
       <button data-act="resume">Resume</button>
       <button data-act="options" class="secondary">Options</button>
       <button data-act="quit" class="secondary">Quit to title</button>`,
    );
  }

  private resume(reason: string): void {
    this.logger?.resume(reason);
    this.state = "playing";
    this.acc = 0;
    this.audio.duck(false);
    this.screen(null);
  }

  private showTitle(): void {
    if (this.logger && !this.logger.isEnded) void this.logger.end("quit");
    this.logger = null;
    this.state = "title";
    this.sim = null;
    this.audio.duck(false);
    this.audio.music("title");
    const rows = this.data.scores
      .map(
        (s, i) =>
          `<tr><td>${i + 1}</td><td>${esc(s.name)}</td><td class="num">${s.score}</td><td class="num">${s.wave}</td><td class="num">${pct(s.accuracy)}</td></tr>`,
      )
      .join("");
    this.screen(
      `<h1><img class="logo" src="${import.meta.env.BASE_URL}assets/logo.webp" alt="Wordfront"></h1>
       <button data-act="start">Start</button>
       <button data-act="options" class="secondary">Options</button>
       <button data-act="exit" class="secondary">Quit</button>
       <h3>High scores</h3>
       ${
         rows
           ? `<table><tr><th>#</th><th>Name</th><th class="num">Score</th><th class="num">Wave</th><th class="num">Acc.</th></tr>${rows}</table>`
           : `<p class="muted">No scores yet. Type the words to stop them reaching the barricade.</p>`
       }`,
    );
  }

  private openOptions(): void {
    this.optionsFrom = this.state === "paused" ? "paused" : "title";
    this.state = "options";
    const s = this.data.settings;
    const check = (k: keyof typeof s, label: string) =>
      `<label class="row">${label}<input type="checkbox" data-set="${k}" ${s[k] ? "checked" : ""}></label>`;
    this.screen(
      `<h2>Options</h2>
       <label class="row">Music volume<input type="range" min="0" max="1" step="0.05" data-set="musicVolume" value="${s.musicVolume}"></label>
       <label class="row">Sound volume<input type="range" min="0" max="1" step="0.05" data-set="sfxVolume" value="${s.sfxVolume}"></label>
       ${check("muted", "Mute all")}
       ${check("largeLabels", "Larger word labels")}
       ${check("highContrast", "High-contrast colours")}
       ${check("reducedMotion", "Reduced motion (no shake or flash)")}
       ${check("screenShake", "Screen shake")}
       ${check("logging", "Keep gameplay logs")}
       <button data-act="back">Back</button>`,
    );
    for (const el of this.ui.querySelectorAll<HTMLInputElement>("input[data-set]")) {
      el.addEventListener("input", () => {
        const key = el.dataset.set as keyof typeof s;
        const settings = this.data.settings as unknown as Record<string, number | boolean>;
        settings[key] = el.type === "checkbox" ? el.checked : Number(el.value);
        void this.saver.save(this.data);
        this.audio.applyVolume();
      });
    }
  }

  private closeOptions(): void {
    if (this.optionsFrom === "paused") this.pause();
    else this.showTitle();
  }

  private showGameOver(): void {
    const sim = this.sim;
    if (!sim) return this.showTitle();
    this.state = "over";
    const sc = sim.scoring;
    const best = bestScore(this.data.scores);
    const pb = sc.score > best && sc.score > 0;
    const missed = sc.topMissed(3);
    const entry: HighScore = {
      name: "",
      score: sc.score,
      wave: sim.wave,
      accuracy: sc.accuracy,
      wpm: Math.round(sim.wpm * 10) / 10,
      longestStreak: sc.longestStreak,
      date: new Date().toISOString().slice(0, 10),
    };
    const top10 = qualifies(this.data.scores, sc.score);
    this.screen(
      `<h2>Overrun!</h2>
       ${pb ? `<div class="badge">New personal best</div>` : ""}
       <table>
         <tr><td>Final score</td><td class="num">${sc.score}</td></tr>
         <tr><td>Wave reached</td><td class="num">${sim.wave}</td></tr>
         <tr><td>Accuracy</td><td class="num">${pct(sc.accuracy)}</td></tr>
         <tr><td>Longest streak</td><td class="num">${sc.longestStreak}</td></tr>
         <tr><td>Typing speed</td><td class="num">${entry.wpm.toFixed(1)} WPM</td></tr>
         <tr><td>Most-missed letters</td><td class="num">${
           missed.length ? missed.map((m) => `${m.letter.toUpperCase()} ×${m.count}`).join(", ") : "none"
         }</td></tr>
       </table>
       ${
         top10
           ? `<h3>Top-10 score! Enter your name</h3>
              <input type="text" maxlength="12" id="name" autocomplete="off" spellcheck="false">
              <button data-act="saveName">Save</button>`
           : `<button data-act="title">Back to title</button>`
       }`,
    );
    // Hold input briefly so letters (or Enter) typed at the moment of death don't
    // land in the name box or skip the stats.
    this.ui.inert = true;
    (document.activeElement as HTMLElement | null)?.blur?.();
    setTimeout(() => {
      if (this.state !== "over") return;
      this.ui.inert = false;
      this.ui.querySelector<HTMLElement>("input#name, button")?.focus();
    }, 700);
    const name = this.ui.querySelector<HTMLInputElement>("#name");
    if (name) {
      name.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.saveScore(entry, name.value);
        }
      });
      this.ui.querySelector("[data-act=saveName]")!.addEventListener("click", () => this.saveScore(entry, name.value));
    }
  }

  private saveScore(entry: HighScore, name: string): void {
    entry.name = name.trim().slice(0, 12) || "Anonymous";
    this.data.scores = insertScore(this.data.scores, entry).scores;
    void this.saver.save(this.data);
    this.showTitle();
  }

  // ------------------------------------------------------------- dom

  private screen(html: string | null): void {
    if (html === null) {
      this.ui.innerHTML = "";
      (document.activeElement as HTMLElement | null)?.blur?.();
      return;
    }
    this.ui.innerHTML = `<div class="screen">${html}</div>`;
    for (const b of this.ui.querySelectorAll<HTMLButtonElement>("button[data-act]")) {
      b.addEventListener("click", () => this.act(b.dataset.act!));
    }
    const first = this.ui.querySelector<HTMLElement>("input#name, button");
    first?.focus();
  }

  private act(a: string): void {
    switch (a) {
      case "start":
        return this.newGame();
      case "options":
        return this.openOptions();
      case "back":
        return this.closeOptions();
      case "resume":
        return this.resume("button");
      case "quit":
      case "title":
        return this.showTitle();
      case "exit":
        this.platform.quit();
        return;
    }
  }
}
