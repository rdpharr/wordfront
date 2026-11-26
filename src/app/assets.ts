/** Loads the processed art (public/assets, built by tools/process_assets.py). */

export const SPRITE_NAMES = [
  "barricade",
  "soldier_up",
  "soldier_left",
  "shambler",
  "bomber",
  "boss",
  "firebomb",
  "acid",
  "poof",
  "airstrike_icon",
  "ground",
  "water",
  "title",
] as const;

export type SpriteName = (typeof SPRITE_NAMES)[number];

export interface Manifest {
  ground: { w: number; h: number; roadLeft: number; roadRight: number };
  music_game: { duration: number };
  music_title: { duration: number };
  /** squad slots (1-5) that have their own soldier art */
  soldiers?: number[];
}

export interface SoldierArt {
  up: HTMLImageElement;
  left: HTMLImageElement;
}

export interface Assets {
  img: Record<SpriteName, HTMLImageElement>;
  manifest: Manifest;
  /** one per squad slot (5); slots without their own art use the shared sprites */
  soldiers: SoldierArt[];
}

export const assetUrl = (file: string): string => `${import.meta.env.BASE_URL}assets/${file}`;

// The load event, not img.decode(): decode() can stall while the window is hidden
// or minimised, which would leave the game stuck on "Loading…".
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`couldn't load ${src}`));
    img.src = src;
  });
}

export async function loadAssets(): Promise<Assets> {
  const [manifest, ...imgs] = await Promise.all([
    fetch(assetUrl("manifest.json")).then((r) => {
      if (!r.ok) throw new Error(`manifest.json: ${r.status}`);
      return r.json() as Promise<Manifest>;
    }),
    ...SPRITE_NAMES.map((n) => loadImage(assetUrl(`${n}.webp`))),
  ]);
  const img = {} as Record<SpriteName, HTMLImageElement>;
  SPRITE_NAMES.forEach((n, i) => (img[n] = imgs[i]!));
  const own = new Set(manifest.soldiers ?? []);
  const soldiers = await Promise.all(
    [1, 2, 3, 4, 5].map(async (i): Promise<SoldierArt> => {
      if (!own.has(i)) return { up: img.soldier_up, left: img.soldier_left };
      const [up, left] = await Promise.all([
        loadImage(assetUrl(`soldier_up_${i}.webp`)),
        loadImage(assetUrl(`soldier_left_${i}.webp`)),
      ]);
      return { up, left };
    }),
  );
  return { img, manifest, soldiers };
}
