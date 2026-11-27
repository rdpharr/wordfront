# Asset licences

Wordfront's source code is under the MIT License (see `LICENSE`). Everything else is
free to use too, under the terms below.

## Art and music: CC0 1.0 (public domain)

All images and music are dedicated to the public domain under
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/). Use, change and
share them for any purpose, commercial or not, without asking and without credit.

This covers:

- `assets/` (source art, music and the app icon)
- `public/assets/`, `public/favicon.png`, `public/icon-192.png` (the processed copies the game loads)
- `src-tauri/icons/` (desktop and mobile app icons)

They were made with ChatGPT (OpenAI) from the prompts in `docs/asset-prompts.md`, then
trimmed, resized and converted by `tools/process_assets.py`.

## Word list: CC BY-SA 4.0

`src/words.txt` is built from wordfreq's frequency data, which is licensed
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), so the word list is
CC BY-SA 4.0 too. You may use and change it, including commercially, as long as you
credit the sources listed in `CREDITS.md` and share changed versions of the list under
the same licence. This applies only to the word list, not to the code that uses it.
