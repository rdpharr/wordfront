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
import { historyHtml } from "./history";
import { bugReportUrl, checkForUpdate, RELEASES, REPO, TIP_JAR, type Update } from "./links";
import { aboutHtml, helpHtml, resetConfirmHtml } from "./screens";
import {
  addRun,
  mergeRuns,
  newRecords,
  parseSave,
  resetHistory,
  runsFromLogEnds,
  Saver,
  type RecordKey,
  type RunRecord,
  type SaveData,
} from "./storage";

/** Menus that open over the title, the pause menu or the game-over screen. */
type Menu = "options" | "help" | "about" | "reset";
type State = "title" | "playing" | "paused" | "dying" | "over" | Menu;
const isMenu = (s: State): s is Menu => s === "options" || s === "help" || s === "about" || s === "reset";

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
const RECORD_NAME: Record<RecordKey, string> = { score: "score", accuracy: "accuracy", wpm: "speed", longestStreak: "streak" };

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
  /** the screen a menu returns to */
  private returnTo: "title" | "paused" | "over" = "title";
  /** the last game-over screen, to come back to from How to play */
  private overHtml = "";
  private update: Update | null = null;
  private updateDismissed = false;
  private updateStatus: "" | "installing" | "failed" = "";
  /** false if save.json couldn't be read at launch: then nothing is saved just for opening How to play */
  private saveLoaded = false;

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
      this.saveLoaded = true;
      await this.importLoggedRuns();
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
    if (!this.data.helpSeen) this.openHelp(); // first launch: how to play, then the title
    this.checkUpdates();
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

    // a menu shows whatever it was opened over
    const view = isMenu(this.state) ? this.returnTo : this.state;
    const paused = view === "paused";
    if (this.renderer) {
      if (!sim || view === "title") {
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
    if (e.key === "F11") {
      e.preventDefault();
      if (!e.repeat) this.platform.toggleFullscreen();
      return;
    }
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
      else if (isMenu(this.state)) this.back();
    }
  }

  private autoPause(): void {
    if (this.state === "playing") this.pause("focus");
  }

  // ------------------------------------------------------------- flow

  private newGame(): void {
    if (this.updateStatus === "installing") {
      // the app restarts when it's done; point at the banner that says so
      this.ui.querySelector<HTMLElement>(".update")?.focus();
      return;
    }
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
       <button data-act="help" class="secondary">How to play</button>
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

  /**
   * Once per save: fold every finished run in the gameplay logs into the history,
   * so runs from before the history existed (or never saved to it) still chart.
   * If the logs can't be read, it tries again next launch.
   */
  private async importLoggedRuns(): Promise<void> {
    if (this.data.logsImported) return;
    try {
      const runs = runsFromLogEnds(await this.platform.logEnds());
      this.data.history = mergeRuns(this.data.history, runs);
      this.data.logsImported = true;
    } catch (err) {
      console.error("couldn't read the run logs", err);
    }
  }

  private showTitle(): void {
    if (this.logger && !this.logger.isEnded) void this.logger.end("quit");
    this.logger = null;
    this.state = "title";
    this.sim = null;
    this.audio.duck(false);
    this.audio.music("title");
    this.screen(
      `<h1><img class="logo" src="${import.meta.env.BASE_URL}assets/logo.webp" alt="Wordfront"></h1>
       <button data-act="start">Start</button>
       <button data-act="help" class="secondary">How to play</button>
       <button data-act="options" class="secondary">Options</button>
       <button data-act="about" class="secondary">About</button>
       ${this.platform.kind === "browser" ? "" : `<button data-act="exit" class="secondary">Quit</button>`}
       ${this.updateBanner()}
       <h3>Your runs</h3>
       ${
         historyHtml(this.data.history) ||
         `<p class="muted">No runs yet. Type the words to stop them reaching the barricade.</p>`
       }`,
    );
  }

  private openOptions(note = ""): void {
    const s = this.data.settings;
    const check = (k: keyof typeof s, label: string) =>
      `<label class="row">${label}<input type="checkbox" data-set="${k}" ${s[k] ? "checked" : ""}></label>`;
    const local = this.platform.kind !== "browser"; // logs and the update check need the desktop app
    this.openMenu(
      "options",
      `<h2>Options</h2>
       <label class="row">Music volume<input type="range" min="0" max="1" step="0.05" data-set="musicVolume" value="${s.musicVolume}"></label>
       <label class="row">Sound volume<input type="range" min="0" max="1" step="0.05" data-set="sfxVolume" value="${s.sfxVolume}"></label>
       ${check("muted", "Mute all")}
       ${check("largeLabels", "Larger word labels")}
       ${check("highContrast", "High-contrast colours")}
       ${check("reducedMotion", "Reduced motion (no shake or flash)")}
       ${check("screenShake", "Screen shake")}
       ${local ? check("logging", "Keep gameplay logs") : ""}
       ${local ? check("checkUpdates", "Check for updates") : ""}
       ${this.data.history.length ? `<button data-act="reset" class="secondary">Reset run history…</button>` : ""}
       ${note ? `<p class="muted">${esc(note)}</p>` : ""}
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

  /** Show a menu over the current screen, remembering where to go back to. */
  private openMenu(menu: Menu, html: string): void {
    if (!isMenu(this.state)) this.returnTo = this.state === "paused" ? "paused" : this.state === "over" ? "over" : "title";
    this.state = menu;
    this.screen(html);
  }

  /** Leave a menu: the reset confirmation goes back to Options, everything else to where it was opened. */
  private back(): void {
    if (this.state === "reset") return this.openOptions();
    if (this.returnTo === "paused") return this.pause();
    if (this.returnTo === "over" && this.overHtml) {
      this.state = "over";
      return this.screen(this.overHtml);
    }
    this.showTitle();
  }

  private openHelp(): void {
    this.openMenu("help", helpHtml(cfg));
    if (!this.data.helpSeen) {
      this.data.helpSeen = true;
      if (this.saveLoaded) void this.saver.save(this.data);
    }
  }

  private resetHistory(): void {
    this.data = resetHistory(this.data);
    void this.saver.save(this.data);
    this.openOptions("Run history erased.");
  }

  // ------------------------------------------------------------- updates

  /** Desktop: once per launch, look for a newer release and mention it on the title screen. */
  private checkUpdates(): void {
    if (this.platform.kind === "browser" || !this.data.settings.checkUpdates) return;
    void checkForUpdate(pkg.version).then((u) => {
      this.update = u;
      if (!u || this.state !== "title") return; // other screens pick it up when the title shows
      // add the banner in place, so focus and scrolling stay where the player left them
      this.ui.querySelector(".screen > h3")?.insertAdjacentHTML("beforebegin", this.updateBanner());
      this.bindActions(this.ui.querySelector(".update"));
    });
  }

  private updateBanner(): string {
    const u = this.update;
    if (!u || this.updateDismissed || !this.data.settings.checkUpdates) return "";
    const head = `<p><b>Version ${esc(u.version)} is out.</b> You have ${esc(pkg.version)}.</p>`;
    if (this.updateStatus === "installing") {
      return `<div class="update" tabindex="-1" aria-live="polite">${head}<p>Installing… Wordfront restarts when it's done.</p></div>`;
    }
    if (this.updateStatus === "failed" || this.platform.kind !== "desktop") {
      const why = this.updateStatus === "failed" ? `<p>It couldn't install itself here. Get it from the download page.</p>` : "";
      return `<div class="update" aria-live="polite">${head}${why}
          <button data-act="update-get">Download it</button>
          <button data-act="update-later" class="secondary">Later</button>
        </div>`;
    }
    return `<div class="update">${head}
        <button data-act="update-install">Install it</button>
        <button data-act="update-later" class="secondary">Later</button>
      </div>`;
  }

  /** Redraw the banner in place, keeping focus on it when it had it. */
  private redrawUpdateBanner(): void {
    const old = this.ui.querySelector(".update");
    if (!old) return;
    const hadFocus = old.contains(document.activeElement);
    old.insertAdjacentHTML("afterend", this.updateBanner());
    old.remove();
    const banner = this.ui.querySelector<HTMLElement>(".update");
    this.bindActions(banner);
    if (hadFocus) (banner?.querySelector<HTMLButtonElement>("button") ?? banner)?.focus();
  }

  private installUpdate(): void {
    if (this.updateStatus === "installing") return;
    this.updateStatus = "installing";
    this.redrawUpdateBanner();
    // the restart skips the close handshake, so let any save in progress finish first
    this.saver
      .idle()
      .then(() => this.platform.installUpdate())
      .then((installed) => {
        // installed: the app is restarting. Not installed: nothing for this build yet, so open the page.
        if (installed) return;
        this.updateStatus = "failed";
        this.platform.openUrl(this.update?.url ?? RELEASES);
        this.redrawUpdateBanner();
      })
      .catch((err) => {
        console.error("update failed", err);
        this.updateStatus = "failed";
        this.redrawUpdateBanner();
      });
  }

  private showGameOver(): void {
    const sim = this.sim;
    if (!sim) return this.showTitle();
    this.state = "over";
    const sc = sim.scoring;
    const missed = sc.topMissed(3);
    const run: RunRecord = {
      at: new Date().toISOString(),
      score: sc.score,
      wave: sim.wave,
      accuracy: sc.accuracy,
      wpm: Math.round(sim.wpm * 10) / 10,
      longestStreak: sc.longestStreak,
    };
    const records = newRecords(this.data.history, run);
    // a run where nothing was typed (100% "accuracy" on no keys) would only skew the charts
    if (sc.correct > 0) {
      this.data.history = addRun(this.data.history, run);
      void this.saver.save(this.data);
    }
    const rec = (k: RecordKey) => (records.includes(k) ? ` class="me"` : "");
    const html = `<h2>Overrun!</h2>
       ${records.length ? `<div class="badge">New record: ${records.map((k) => RECORD_NAME[k]).join(", ")}</div>` : ""}
       <table>
         <tr${rec("score")}><td>Final score</td><td class="num">${sc.score}</td></tr>
         <tr><td>Wave reached</td><td class="num">${sim.wave}</td></tr>
         <tr${rec("accuracy")}><td>Accuracy</td><td class="num">${pct(sc.accuracy)}</td></tr>
         <tr${rec("longestStreak")}><td>Longest streak</td><td class="num">${sc.longestStreak}</td></tr>
         <tr${rec("wpm")}><td>Typing speed</td><td class="num">${run.wpm.toFixed(1)} WPM</td></tr>
         <tr><td>Most-missed letters</td><td class="num">${
           missed.length ? missed.map((m) => `${m.letter.toUpperCase()} ×${m.count}`).join(", ") : "none"
         }</td></tr>
       </table>
       <button data-act="title">Back to title</button>
       <button data-act="help" class="secondary">How to play</button>`;
    this.overHtml = html;
    this.screen(html);
    // Hold input briefly so Enter typed at the moment of death doesn't skip the stats.
    this.ui.inert = true;
    (document.activeElement as HTMLElement | null)?.blur?.();
    setTimeout(() => {
      if (this.state !== "over") return;
      this.ui.inert = false;
      this.ui.querySelector<HTMLElement>("button")?.focus();
    }, 700);
  }

  // ------------------------------------------------------------- dom

  private screen(html: string | null): void {
    if (html === null) {
      this.ui.innerHTML = "";
      (document.activeElement as HTMLElement | null)?.blur?.();
      return;
    }
    this.ui.innerHTML = `<div class="screen">${html}</div>`;
    this.bindActions(this.ui);
    const first = this.ui.querySelector<HTMLElement>("button");
    first?.focus();
  }

  private bindActions(root: Element | null): void {
    for (const b of root?.querySelectorAll<HTMLButtonElement>("button[data-act]") ?? []) {
      b.addEventListener("click", () => this.act(b.dataset.act!));
    }
  }

  private act(a: string): void {
    switch (a) {
      case "start":
        return this.newGame();
      case "options":
        return this.openOptions();
      case "back":
        return this.back();
      case "help":
        return this.openHelp();
      case "about":
        return this.openMenu("about", aboutHtml(pkg.version, this.platform));
      case "tip":
        return this.platform.openUrl(TIP_JAR);
      case "source":
        return this.platform.openUrl(REPO);
      case "offline":
      case "update-get":
        return this.platform.openUrl(this.update?.url ?? RELEASES);
      case "bug":
        return this.platform.openUrl(bugReportUrl(pkg.version, this.platform.kind));
      case "update-install":
        return this.installUpdate();
      case "update-later":
        this.updateDismissed = true;
        return this.showTitle();
      case "reset":
        return this.openMenu("reset", resetConfirmHtml(this.data.history.length, this.platform.kind !== "browser"));
      case "reset-yes":
        return this.resetHistory();
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
