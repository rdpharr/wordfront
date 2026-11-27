/**
 * HTML for the menu screens that are mostly text: How to play, About, and the
 * confirmation before erasing the run history. Numbers come from the config, so the
 * help stays true when the game is retuned.
 */
import type { Tunables } from "../core/config";
import { assetUrl } from "./assets";
import { REPO, TIP_JAR } from "./links";
import type { Platform } from "./platform";

const sprite = (name: string, alt: string) => `<img class="help-icon" src="${assetUrl(`${name}.webp`)}" alt="${alt}">`;
const key = (k: string) => `<kbd>${k}</kbd>`;

/** The airstrike costs as a short list: "12, then 16, 20, ..." */
function refillCosts(cfg: Tunables): string {
  const { refillStart, refillStep, refillMax } = cfg.emp;
  if (refillStart <= 0) return "";
  const costs = [0, 1, 2].map((n) => {
    const c = refillStart + refillStep * n;
    return refillMax > 0 ? Math.min(refillMax, c) : c;
  });
  if (refillStep <= 0 || costs[0] === costs[1]) return `every ${refillStart} words you finish`;
  return `${costs[0]} words, then ${costs[1]}, ${costs[2]} and so on`;
}

export function helpHtml(cfg: Tunables): string {
  const steps = cfg.multiplierSteps.map((s) => `${s.streak} in a row scores ×${s.multiplier}`).join(", ");
  const refill = refillCosts(cfg);
  return `<h2>How to play</h2>
    <div class="help">
      <p>Enemies march down the road toward your squad. <b>Type the word on an enemy to shoot it.</b>
         Anything that reaches the barricade ends the run.</p>
      <h3>Aim and fire</h3>
      <ul>
        <li>Type the first letter of a word to lock on to it, then type the rest. Each right letter fires a shot.
            If several words start with that letter, you lock on to the nearest.</li>
        <li>${key("Backspace")} drops the lock so you can switch to another word.</li>
        <li>A wrong letter jams your rifles for a moment and resets your streak. Accuracy beats speed.</li>
        <li>Streaks score more: ${steps}.</li>
      </ul>
      <h3>Airstrikes ${key("Enter")}</h3>
      <ul>
        <li>An airstrike blasts everything near your squad. You start with ${cfg.emp.count}.</li>
        <li>It starts the wave over with new words, so it buys time, not progress.</li>
        ${refill ? `<li>Earn one back by finishing words: ${refill}. Bullets don't count.</li>` : ""}
      </ul>
      <h3>The enemy</h3>
      <table class="help-enemies">
        <tr><td>${sprite("shambler", "Mine")}</td><td><b>Mines</b> walk straight at you. Short words.</td></tr>
        <tr><td>${sprite("bomber", "Destroyer")}</td><td><b>Destroyers</b> fire homing missiles.</td></tr>
        <tr><td>${sprite("boss", "Oppressor")}</td><td><b>Oppressors</b> have long words and fire fans of bullets.</td></tr>
        <tr><td>${sprite("firebomb", "Missile")}${sprite("acid", "Bullet")}</td><td><b>Missiles and bullets</b> carry words too. A pulsing bullet is about to hit:
          type its letter to shoot it even while you're locked on another word.</td></tr>
      </table>
      <p class="muted">Every letter you land on a Destroyer or Oppressor delays its next shot. Faint
         bullets with no word are going to miss: ignore them.</p>
      <h3>Keys</h3>
      <p>${key("Esc")} pause &nbsp; ${key("F11")} fullscreen &nbsp; ${key("↑")}${key("↓")} move through menus</p>
    </div>
    <button data-act="back">Got it</button>`;
}

export function aboutHtml(version: string, platform: Platform): string {
  const offline =
    platform.kind === "browser"
      ? `<button data-act="offline" class="secondary">Get the offline version</button>`
      : "";
  return `<h2>About Wordfront</h2>
    <p class="muted">Version ${version}${platform.kind === "browser" ? " · web" : ""}</p>
    <p>A free, open-source typing game.</p>
    <button data-act="tip">Buy me a coffee ☕</button>
    <button data-act="source" class="secondary">Source code and releases</button>
    ${offline}
    <button data-act="bug" class="secondary">Report a bug</button>
    <div class="credits">
      <h3>Credits</h3>
      <p>Code under the MIT License. Art and music made with ChatGPT and dedicated to the public
         domain (CC0 1.0).</p>
      <p>The word list is built from <b>wordfreq</b> by Robyn Speer (data CC BY-SA 4.0), the
         <b>SCOWL / Hunspell en_US</b> dictionary, and the <b>List of Dirty, Naughty, Obscene, and
         Otherwise Bad Words</b> (CC BY 4.0) as a blocklist. The word list itself is shared under
         <b>CC BY-SA 4.0</b>.</p>
      <p class="muted">${REPO.replace("https://", "")} · ${TIP_JAR.replace("https://", "")}</p>
    </div>
    <button data-act="back">Back</button>`;
}

export function resetConfirmHtml(runs: number, keepsLogs: boolean): string {
  return `<h2>Erase run history?</h2>
    <p>This deletes all ${runs} run${runs === 1 ? "" : "s"} from your history and charts. It can't be undone.</p>
    ${keepsLogs ? `<p class="muted">Your gameplay logs are kept.</p>` : ""}
    <button data-act="back">Cancel</button>
    <button data-act="reset-yes" class="danger">Erase history</button>`;
}
