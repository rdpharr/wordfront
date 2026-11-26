# Asset prompts for ChatGPT

Game name: **Wordfront**.

## How to use these

1. **Do all the art in one ChatGPT conversation**, in the order below. Prompt A0 sets the style; every later prompt says "match the style of the reference image", which only works if A0 is in the same chat. If ChatGPT drifts, re-upload `A0_style_reference.png` with the prompt.
2. **Save each file with the exact filename given** into `wordfront\assets\incoming\`. I'll trim, resize and convert everything from there — you don't need to resize anything.
3. **Reject and regenerate if:**
   - the background is a *painted* grey/white checkerboard instead of real transparency (ask: "the background must be truly transparent, not a checkerboard pattern");
   - there's any text, letters, numbers, watermark or UI in the image (except the logo);
   - the camera angle or outline thickness clearly doesn't match A0;
   - a character is cropped at the edge of the canvas.
4. Characters are shown small in the game (40–130 px tall), so bold silhouettes and thick outlines matter more than detail.
5. Keep it original: don't add names of other games, studios or artists to the prompts.

The shared style block is repeated in each prompt on purpose — paste each prompt whole.

---

## Art

### A0 — Style reference / title screen art
**File:** `A0_style_reference.png` · **Size:** 1024×1536 (portrait)

```
Create a portrait illustration (1024x1536) for an original arcade typing game.

STYLE: bright, cartoony mobile-game art. Chunky, rounded, toy-like 3D-look shapes with soft shading, thick dark-brown outlines, saturated colours, warm late-morning daylight from the upper left. Camera is high and behind the defenders, looking up a long road at a three-quarter angle. Clean, readable silhouettes. Cartoon violence only, no gore. No text, no letters, no numbers, no watermark, no UI.

SCENE: a long, straight stone bridge runs from the bottom of the image to the top, narrowing with perspective toward the top. Calm turquoise water with small ripples on both sides. At the bottom centre, a small squad of six chubby soldiers in rounded blue helmets crouch behind a curved wall of tan sandbags, rifles pointed up the bridge. Marching down the bridge toward them is a crowd of goofy red-tinted cartoon undead: small shambling walkers with arms stretched out, a couple of raiders pushing wooden carts loaded with round black bombs, and one giant hulking mutant near the top. The enemies look silly and clumsy rather than scary. Leave the top third of the image less busy.
```

### A1 — Scrolling ground tile
**File:** `A1_ground_tile.png` · **Size:** 1024×1024 (square)
I draw this in perspective in code and scroll it, so it must be flat and straight-down.

```
Match the style of the reference image (colours, shading, outline weight).

Create a 1024x1024 texture tile seen from directly above (flat, orthographic, no perspective, no horizon). A straight stone road runs vertically through the middle, taking up the central 56% of the width, with low rounded stone kerbs along both edges. Turquoise water with gentle cartoon ripples fills both sides. Light details only: a few cracks in the paving, faded painted lane dashes down the centre, a small puddle, tiny tufts of grass by the kerbs. No characters, no objects, no shadows of objects.

The image must tile seamlessly from top to bottom: the top edge must continue perfectly into the bottom edge. The road must be perfectly vertical and centred. No text.
```

### A2 — Sandbag barricade
**File:** `A2_barricade.png` · **Size:** 1536×1024 (landscape), transparent

```
Match the style of the reference image (colours, shading, outline weight, camera angle).

A single curved wall of stacked tan sandbags, two to three bags high, bowed outward toward the top of the image, seen from a high angle behind it. Chunky rounded cartoon sandbags with stitching and soft shading. Isolated object centred on a truly transparent background, filling about 90% of the width, no ground, no shadow, no soldiers, no text.
```

### A3 — Soldier aiming straight up the road
**File:** `A3_soldier_up.png` · **Size:** 1024×1024, transparent

```
Match the style of the reference image (colours, shading, outline weight, camera angle).

One chubby cartoon soldier seen from a high angle behind, wearing a rounded blue helmet and a blue-grey uniform, holding a stubby rifle aimed straight ahead (toward the top of the image). Upper body only, as if standing behind a low wall (cut off at the waist with a clean edge). Friendly, toy-like proportions with a big helmet. Centred, filling about 70% of the canvas, on a truly transparent background. No ground, no shadow, no muzzle flash, no text.
```

### A4 — Soldier aiming diagonally left
**File:** `A4_soldier_left.png` · **Size:** 1024×1024, transparent
(I mirror this one for aiming right.)

```
Match the style of the reference image and the soldier in the previous image exactly (same helmet, uniform, rifle, proportions, outline weight).

The same soldier, same high angle from behind, now turned about 45 degrees to the left, rifle aimed diagonally toward the top-left corner of the image. Upper body only, cut off at the waist with a clean edge. Centred, filling about 70% of the canvas, on a truly transparent background. No ground, no shadow, no muzzle flash, no text.
```

### A5 — Shambler (small enemy)
**File:** `A5_shambler.png` · **Size:** 1024×1024, transparent

```
Match the style of the reference image (colours, shading, outline weight, camera angle).

One small, goofy cartoon undead walker, red-tinted skin, ragged brown clothes, both arms stretched out in front, mid-stride, walking toward the viewer (toward the bottom of the image), seen from a high three-quarter angle above and in front. Big head, short body, silly open-mouthed expression — funny, not scary, no blood or gore. Full body, centred, filling about 75% of the canvas height, on a truly transparent background. No ground, no shadow, no text.
```

### A6 — Bomber (medium enemy)
**File:** `A6_bomber.png` · **Size:** 1024×1024, transparent

```
Match the style of the reference image (colours, shading, outline weight, camera angle).

One cartoon raider with red-tinted skin, a scrappy leather vest and goggles, pushing a small wooden cart loaded with three round black cartoon bombs with fuses. The raider and cart move toward the viewer (the cart is in front, nearer the bottom of the image), seen from a high three-quarter angle above and in front. Chunky, toy-like proportions, mischievous grin, no gore. Full body and whole cart visible, centred, filling about 80% of the canvas, on a truly transparent background. No ground, no shadow, no text.
```

### A7 — Boss (large enemy)
**File:** `A7_boss.png` · **Size:** 1024×1024, transparent

```
Match the style of the reference image (colours, shading, outline weight, camera angle).

One giant hulking cartoon mutant, red-tinted skin with a few green glowing patches, huge shoulders and fists, tiny head, torn trousers, lumbering toward the viewer, seen from a high three-quarter angle above and in front. Its mouth is open with a green glow inside, as if about to spit. Big and intimidating but still cartoony and a bit dopey, no blood or gore. Full body, centred, filling about 85% of the canvas, on a truly transparent background. No ground, no shadow, no text.
```

### A8 — Firebomb (bomber's projectile)
**File:** `A8_firebomb.png` · **Size:** 1024×1024, transparent
(I rotate it in code, so it must point straight up.)

```
Match the style of the reference image (colours, shading, outline weight).

One cartoon glass bottle bomb with a lit rag fuse, the bottle pointing straight up (neck and flame at the top of the image), seen from above. Chunky rounded shape, bright orange-yellow cartoon flame. Centred, filling about 60% of the canvas height, on a truly transparent background. No ground, no shadow, no text.
```

### A9 — Acid glob (boss's projectile)
**File:** `A9_acid_glob.png` · **Size:** 1024×1024, transparent

```
Match the style of the reference image (colours, shading, outline weight).

One small blob of bright green cartoon acid, round and slightly wobbly with a white highlight and two tiny drips trailing upward. Simple and readable at very small sizes. Centred, filling about 50% of the canvas, on a truly transparent background. No ground, no shadow, no text.
```

### A10 — Poof cloud (kill effect)
**File:** `A10_poof.png` · **Size:** 1024×1024, transparent

```
Match the style of the reference image (colours, shading, outline weight).

One cartoon "poof" smoke cloud: a round cluster of puffy cream-white cloud balls with soft grey shading, plus a few small yellow star sparkles around the edge. Centred, filling about 80% of the canvas, on a truly transparent background. No text.
```

### A11 — Airstrike icon (HUD)
**File:** `A11_airstrike_icon.png` · **Size:** 1024×1024, transparent

```
Match the style of the reference image (colours, shading, outline weight).

A simple game icon: a chunky cartoon bomb with small fins, pointing down, inside a round red-orange badge with a thick dark outline. Bold and readable at 32 pixels. Centred, on a truly transparent background. No text.
```

### A12 — App icon
**File:** `A12_app_icon.png` · **Size:** 1024×1024

```
Match the style of the reference image (colours, shading, outline weight).

A square app icon with rounded corners: a close-up of one chubby soldier in a rounded blue helmet peeking over tan sandbags, with a bright yellow glowing tracer streak shooting upward. Saturated turquoise background. Bold and readable at small sizes. No text.
```

### A13 — Title logo
**File:** `A13_logo.png` · **Size:** 1536×1024, transparent

```
Match the style of the reference image (colours, shading, outline weight).

A chunky cartoon game logo that reads exactly "WORDFRONT" in big, bold, rounded 3D letters: warm yellow-orange face, thick dark-brown outline, slight bevel, a little arched. Small sandbag and helmet details tucked under the letters. Centred on a truly transparent background. Spell the word exactly as given, with no other text.
```

---

## Music

If ChatGPT won't produce an audio file itself, paste the same prompt into a music generator (e.g. Suno or Udio) — they're written in the "style + description" form those tools expect.

**Format:** MP3, WAV or OGG is fine. Save into `wordfront\assets\incoming\`. Sound effects (rifle pops, misses, kills, fanfare, game-over sting) are made in code so they react within 20 ms — no prompts needed for those.

### M1 — Gameplay loop
**File:** `M1_gameplay_loop.mp3` · about 2 minutes

```
Instrumental only, no vocals. Upbeat, punchy cartoon arcade-military track for a fast typing action game. 128 BPM, 4/4, key of D minor. Snappy marching snare and kick, bouncy staccato brass stabs, plucky synth bass, a catchy whistle-able lead on bright synth and glockenspiel, light toy-soldier fife flourishes. Energetic and fun, not dark or aggressive. Steady energy throughout with no big breakdown or fade, so it does not distract from concentrating; mid-range mix that leaves room for frequent gunshot sound effects. Ends on the same chord and groove it starts with so it can loop seamlessly. About 2 minutes.
```

### M2 — Title / menu theme
**File:** `M2_title_theme.mp3` · about 1 minute

```
Instrumental only, no vocals. Relaxed, cheerful cartoon military march for a game's title menu. 100 BPM, 4/4, key of D major. Light brushed snare, warm tuba bass, playful clarinet and glockenspiel melody, occasional friendly brass swell. Feels like the calm before a silly battle: confident, sunny, slightly cheeky. Even energy, no fade in or out, ends so it can loop seamlessly. About 1 minute.
```

---

## Squad update: five distinct soldiers

These replace the single soldier (A3/A4) so the squad has a mix of skin tones, hair and genders. Each soldier needs **two images**: aiming up the road (`A3_soldier_up_N.png`) and aiming diagonally left (`A4_soldier_left_N.png`; the game mirrors it for aiming right). Save them into `wordfront\assets\incoming\`. The game picks each one up as soon as both of its files are there; any soldier without art keeps the current sprite.

**Tips:**
- Do these in the **same ChatGPT chat as A0**, or re-upload `A0_style_reference.png` and `A3_soldier_up.png` first, so the uniform, helmet, outline weight and colours stay identical.
- Make each soldier's "up" image first, then their "left" image right after it, saying "the same soldier".
- The camera is a little more to the side than in the original A3, so the side of the face, the ear, the neck and the hands show. That's where skin tone and hair read at this small size.
- Same rejection rules as before: truly transparent background, no text, nothing cropped.

### Shared block (paste at the start of each soldier prompt)

```
Match the style of the reference images exactly: same rounded blue helmet, blue-grey uniform with tan crossed straps and belt, stubby rifle with a wooden stock, thick dark-brown outlines, soft shading, saturated colours, warm daylight from the upper left. Chubby, friendly, toy-like proportions with a big helmet. Upper body only, cut off at the waist with a clean edge, as if standing behind a low wall. Seen from a high angle behind and slightly to one side, so the side of the face, the ear, the neck and both hands are clearly visible. Centred, filling about 70% of the canvas, on a truly transparent background. No ground, no shadow, no muzzle flash, no text. 1024x1024.
```

### The five soldiers

For each, send **shared block + "UP" line**, then **shared block + "LEFT" line**.

| # | Who | Files |
| --- | --- | --- |
| 1 | Black woman, deep brown skin, curly black hair in two puffs below the helmet | `A3_soldier_up_1.png`, `A4_soldier_left_1.png` |
| 2 | South Asian man, warm brown skin, short black hair and a neat short beard along the jaw | `A3_soldier_up_2.png`, `A4_soldier_left_2.png` |
| 3 | East Asian woman, light warm skin, long straight black ponytail | `A3_soldier_up_3.png`, `A4_soldier_left_3.png` |
| 4 | Latino man, medium tan skin, short curly dark-brown hair | `A3_soldier_up_4.png`, `A4_soldier_left_4.png` |
| 5 | White woman, freckled light skin, two red braids | `A3_soldier_up_5.png`, `A4_soldier_left_5.png` |

**UP line** (swap in the description from the table):

```
This soldier: <description from the table>. Rifle aimed straight ahead, toward the top of the image.
```

**LEFT line:**

```
The same soldier as the previous image (same face, skin tone, hair and proportions), now turned about 45 degrees to the left, rifle aimed diagonally toward the top-left corner of the image.
```

### A0 (redo) — title art with the mixed squad
**File:** `A0_style_reference.png` (replaces the old one)

Paste the original A0 prompt, but replace the sentence starting "At the bottom centre" with:

```
At the bottom centre, a squad of five chubby soldiers in rounded blue helmets crouch behind a curved wall of tan sandbags, rifles pointed up the bridge: a Black woman with curly hair puffs, a South Asian man with a short beard, an East Asian woman with a black ponytail, a Latino man with curly dark hair, and a white woman with red braids. Their faces are partly visible in three-quarter view from behind.
```

### A12 (redo) — app icon
**File:** `A12_app_icon.png` (replaces the old one)

```
Match the style of the reference image (colours, shading, outline weight).

A square app icon with rounded corners: a close-up of a cheerful soldier, a Black woman with curly hair puffs and a rounded blue helmet, peeking over tan sandbags, with a bright yellow glowing tracer streak shooting upward. Saturated turquoise background. Bold and readable at small sizes. No text.
```

When they're in `incoming`, tell me and I'll re-run `tools/process_assets.py`. The new soldiers, title art and icon then appear without code changes.
