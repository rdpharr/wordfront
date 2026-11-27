# Release plan

Getting Wordfront ready to publish. Decided 2026-11-26.

## Decisions

- **Everything is open.** Code: MIT. Art and music: CC0 (public domain). The word list
  has to stay CC BY-SA 4.0 because wordfreq's data is CC BY-SA. See `LICENSE`,
  `LICENSE-ASSETS.md`, `CREDITS.md`.
- **No spending.** No code signing, no domain, no paid services. Everything runs on free
  GitHub features (public repo, Actions, Releases, Pages).
- **The web version is the main way to play**, at <https://rdpharr.github.io/wordfront/>.
  The desktop builds are offered as the **offline version**.
- **Unsigned desktop builds.** Windows shows a SmartScreen warning and macOS's Gatekeeper
  blocks the first launch. The README and release notes walk people through both (see
  Phase 4).
- **Accounts:** GitHub `rdpharr`, Buy Me a Coffee `rdpharr`.
- **App identifier:** `io.github.rdpharr.wordfront`. Save data lives in a `Wordfront` folder
  under the OS's per-user data folder, so it doesn't depend on the identifier.
- **Art and music** were made with ChatGPT.

## Phase 1: Foundations

- [x] Data folder works on Windows, macOS and Linux (Rust shell and dev server)
- [x] Identifier `io.github.rdpharr.wordfront`
- [x] One version number: `package.json`. `tauri.conf.json` reads it; `npm version x.y.z`
      copies it into `Cargo.toml`/`Cargo.lock` (`npm run version:check` checks them)
- [x] LICENSE, LICENSE-ASSETS.md, credits for art and music
- [x] Commit, create the public `rdpharr/wordfront` repo, push (default branch `main`);
      commits use the GitHub no-reply address
- [x] Code review before every commit (`CLAUDE.md`, `.claude/hooks/review-gate.mjs`)

## Phase 2: In-game features

- [x] **Help screen** (`src/app/screens.ts`): how to aim, jams, streaks, airstrikes and each
      enemy, with numbers taken from the config. From the title, the pause menu and game
      over; opens by itself on the first launch (`helpSeen` in the save).
- [x] **Reset history:** Options → "Reset run history…" → confirm. Keeps `logsImported` set
      so the logs don't bring the runs back; the logs themselves stay.
- [x] **About screen:** version, Buy Me a Coffee, source and releases, "Report a bug" (a new
      GitHub issue with the version filled in), and credits including the word list's
      CC BY-SA 4.0 notice. Desktop opens links through the `open_link` command, which only
      allows the project's own pages.
- [x] **Update check (desktop):** at launch it asks the GitHub API for the latest release;
      if it's newer, the title screen says so with "Download it" (opens the release page)
      and "Later". "Check for updates" in Options turns it off. In-place install moves to
      Phase 3, because it needs the updater signing key.
- [x] **Web version:** no Quit button, no logging or update options, "Get the offline
      version" in About. Saves use the browser's localStorage.
- [x] **Window:** F11 toggles fullscreen (desktop and web). The desktop app remembers size,
      position and fullscreen (window-state plugin) and shrinks a window taller than the
      screen to fit.

## Phase 3: Release pipeline (GitHub Actions)

- **CI on every push and PR:** `npm run typecheck`, `npm test`, `cargo test`,
  `npm run version:check`.
- **Pages:** build with Vite `base: "/wordfront/"` and deploy to GitHub Pages on push to
  `main` (or on each release, so the web and offline versions match). Publish the first
  release before or with the first Pages deploy: the web version's "Get the offline
  version" opens `/releases/latest`, which is a 404 until a release exists.
- **Release on a `v*` tag:** `tauri-action` builds on Windows, macOS and Ubuntu runners
  and publishes them to a GitHub Release (as a draft to check first):
  - Windows: `.exe` (NSIS) installer, plus `.msi`
  - macOS: `.dmg` for Apple Silicon and Intel (or one universal build)
  - Linux: `.AppImage` and `.deb`
  - `latest.json` for the updater
- **Bundling:** turn on `bundle.active` and list `icon.icns` and `icon.png` too.
- **In-place updates:** add `tauri-plugin-updater` so "Download it" becomes "Install"
  (the check and banner from Phase 2 stay as the fallback, e.g. for `.deb`).
- **Updater signing key:** free, made with `npx tauri signer generate`. The private key and
  its password go in repo secrets, with a backup somewhere safe. If the key is lost,
  existing installs can never update again.
- Linux: only the AppImage can update itself; `.deb` users download new versions.

## Phase 4: Repo polish

- README: logo, gameplay GIF, a big "Play in your browser" link, "Offline version"
  downloads per OS, controls, privacy ("no telemetry, no accounts; the only network use
  is the desktop update check, which you can turn off"), credits, tip jar, and a licence
  section linking `LICENSE-ASSETS.md` (LICENSE itself stays plain MIT so GitHub detects it).
- Unsigned install notes:
  - Windows: "Windows protected your PC" → More info → Run anyway.
  - macOS: open it once, then System Settings → Privacy & Security → Open Anyway. If macOS
    says the app is damaged: `xattr -dr com.apple.quarantine /Applications/Wordfront.app`.
  - Linux: `chmod +x Wordfront*.AppImage`, or install the `.deb`.
- `.github/FUNDING.yml` with `buy_me_a_coffee: rdpharr`.
- `CHANGELOG.md`, bug and idea issue templates, repo description and topics, a
  1280×640 social preview image.

## Phase 5: Test and release

- Play the real built packages on Windows, macOS and Linux (a VM or a friend's machine
  for the ones you don't have), and the Pages build in Chrome, Firefox and Safari.
- Try a non-US keyboard layout (AZERTY, one with dead keys).
- Release v0.9.0, then v0.9.1, to prove the updater works end to end.
- Tag v1.0.0.
