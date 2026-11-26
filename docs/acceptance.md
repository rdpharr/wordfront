# Acceptance check — 2026-11-25

Build: `src-tauri/target/release/wordfront.exe` (6.8 MB, portable, uses the WebView2 runtime built into Windows). 53 TypeScript tests and 1 Rust test pass.

| # | Criterion (from the spec) | How it was checked | Result |
| --- | --- | --- | --- |
| 1 | Launches from a desktop shortcut with no browser and no network connection | Launched the .exe: opens its own "Wordfront" window, 32 MB. The app process opened no outside network connections; all files are embedded; the page's content security policy only allows its own files. | Pass. Desktop shortcut not created yet. |
| 2 | Typing the first letter of any on-screen word locks the nearest enemy with that letter within one frame | Unit tests: the lock happens in the same simulation step the key arrives in; nearest wins; same-step letters narrow first. | Pass |
| 3 | Wrong letters never change the locked target and always reset the multiplier | Unit tests (locked miss keeps the lock; streak and multiplier reset). | Pass |
| 4 | Finishing a word destroys its enemy; contact with any enemy or missile ends the game | Unit tests, including a projectile reaching the outermost soldier. | Pass |
| 5 | Enter fires an EMP only when one remains; the HUD count updates | Unit test (3 to start, 4th ignored; one earned back every `emp.refillEvery` typed words, up to `emp.max`; a strike resets the wave to its full count of enemies, with new words, after a short pause, `emp.resetWave`); HUD icons and refill bar checked in screenshots. | Pass |
| 6 | Waves 1–20 are playable with difficulty visibly rising; no enemy spawns off screen or with an unreadable label | 30 simulated players reached waves 7–21; typing demand rises smoothly from 20% to ~100% of a player's pace by wave 19–20 (`npm run analyze`). Test: every wave spawn across 15+ waves is inside the playfield. Labels are clamped on screen in the renderer. | Pass |
| 7 | Esc and loss of focus both pause; resuming restores exact state | Browser: Esc and window blur both open the pause menu; the game state is identical before and after 1.5 s paused; Resume continues from the same step. | Pass |
| 8 | Game-over stats match a hand count on a scripted test run | Unit test recounts score, correct, errors and longest streak from the keystroke log; run_end matches the game's stats. | Pass |
| 9 | Only lowercase a–z words ever appear; Shift and Caps Lock never cause a miss | Word list test (4,810 words, a–z only); keyboard test (uppercase maps to lowercase). | Pass |
| 10 | Run history and settings survive closing and reopening the app | Desktop app loaded an existing save with a marker score and settings, kept them, and filled in missing defaults on rewrite. | Pass |
| 11 | Holds 60 fps with 30 enemies and full particle effects on this PC | Browser (Chromium, same engine as WebView2) at 1080×1920: 240 consecutive frames at 16.7 ms (worst 16.8 ms) with 30 enemies, 271 particles, poofs, an airstrike ring and labels; renderer CPU time 0.4 ms per frame. | Pass |

Also checked: replaying a logged run's seed and keystrokes reproduces the same score and wave (unit tests and a real browser run); closing the desktop window mid-run finishes the run's log before exiting (window closed cleanly in 106 ms).

Not covered: how the game feels to a human player at length, and the music balance — those need play-testing.
