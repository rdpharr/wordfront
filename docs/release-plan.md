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

- **Help screen:** how to play (type a word to lock on, finish it to fire, Esc to pause,
  airstrikes, jams, enemy types). Reachable from the title, the pause menu and game over;
  opens automatically on the first launch.
- **Reset history:** in Options, with a confirmation step. It must keep `logsImported`
  set (or delete the logs too), or the next launch rebuilds the history from the logs.
- **About screen:** version, credits and licences (required: the word list's CC BY-SA 4.0
  notice and its wordfreq/SCOWL/LDNOOBW credits, since every build ships it), Buy Me a Coffee link, "Report a bug"
  (opens a GitHub issue with the version filled in). On desktop, links open in the
  system browser (Tauri opener plugin).
- **Update check (desktop only):** `tauri-plugin-updater` reads `latest.json` from the
  latest GitHub release. "Version X is available" with Install / Later. A switch in
  Options turns it off. Needs `connect-src` for GitHub in the CSP.
- **Web version:** hide Quit, no update check, and a "Get the offline version" link to the
  Releases page. Saves use the browser's localStorage, and gameplay logs are off.
- **Window:** F11 fullscreen; remember window size and position. Check the 940 px default
  height on 768/800 px-tall laptop screens.

## Phase 3: Release pipeline (GitHub Actions)

- **CI on every push and PR:** `npm run typecheck`, `npm test`, `cargo test`,
  `npm run version:check`.
- **Pages:** build with Vite `base: "/wordfront/"` and deploy to GitHub Pages on push to
  `main` (or on each release, so the web and offline versions match).
- **Release on a `v*` tag:** `tauri-action` builds on Windows, macOS and Ubuntu runners
  and publishes them to a GitHub Release (as a draft to check first):
  - Windows: `.exe` (NSIS) installer, plus `.msi`
  - macOS: `.dmg` for Apple Silicon and Intel (or one universal build)
  - Linux: `.AppImage` and `.deb`
  - `latest.json` for the updater
- **Bundling:** turn on `bundle.active` and list `icon.icns` and `icon.png` too.
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
