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

- [x] **CI** (`.github/workflows/ci.yml`), on every push to `main` and every PR:
      version check, typecheck, unit tests, the game build, the Pages build and the Rust tests.
- [x] **Installers:** `bundle.active` with every target: Windows `.exe` (NSIS) and `.msi`,
      macOS `.dmg` for Apple Silicon and Intel (ad-hoc signed, so macOS offers "Open Anyway"
      instead of calling it damaged), Linux `.AppImage`, `.deb` and `.rpm`.
- [x] **Release** (`.github/workflows/release.yml`): push a `v*` tag that matches
      package.json and it builds all four into a draft GitHub Release, with download and
      unsigned-install notes (`.github/release-notes.md`). One job creates the draft first so
      the four builds don't race to create duplicates. Running it by hand builds the installers
      as workflow artifacts without releasing anything.
- [x] **Web version** (`.github/workflows/pages.yml`): deploys to GitHub Pages
      (`WF_BASE=/wordfront/`) when a release is published, so the web and offline versions
      match, and the "Get the offline version" link never 404s. One-time setup before the
      first deploy: Pages source "GitHub Actions", and a deployment tag rule `v*` on the
      `github-pages` environment (it only allows `main` at first, and a release run's ref is its tag).
      Both done; the web version is live.
- [x] **Updater signing key:** made with `npx tauri signer generate` (`~/.tauri/wordfront.key`).
      The private key and its password are repo secrets (`TAURI_SIGNING_PRIVATE_KEY`,
      `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`); keep a backup somewhere safe. If the key is lost,
      existing installs can never update again. A local `tauri build` needs the same two
      environment variables, since it signs the update bundles too.
- [x] **In-place updates:** `tauri-plugin-updater`. The banner's "Install it" downloads the new
      version, checks it against the public key in `tauri.conf.json`, installs it and restarts.
      If this copy can't install it (e.g. the release has nothing for it yet, or a `.deb`/`.rpm`
      install can't get admin rights), it opens the download page instead. The release
      workflow's `updater-manifest` job writes `latest.json` once every build has uploaded
      (`tools/updater_manifest.ts`); installs read it from the latest published release.

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
