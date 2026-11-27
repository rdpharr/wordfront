# Wordfront

## Review before every commit

Every commit gets a code review first. Run the `/code-review` skill on the pending changes,
fix what it finds (or say why a finding doesn't apply), then record the review:

```
node .claude/hooks/review-gate.mjs --record
```

A PreToolUse hook (`.claude/settings.json` → `.claude/hooks/review-gate.mjs`) blocks
`git commit` while any uncommitted file differs from what was recorded, so editing after the
review means reviewing again. `--status` lists what isn't covered. Never get around the gate
(no `--no-verify`, no recording without reviewing, no committing through another tool).

## Release decisions

See `docs/release-plan.md`: zero spend (no code signing, no domain), the GitHub Pages web
build is the main way to play and the desktop builds are the "offline version", everything is
open (MIT code, CC0 art and music, CC BY-SA word list).
