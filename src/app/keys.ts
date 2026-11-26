import type { SimInput } from "../core/types";

export type AppKey = SimInput | { kind: "pause" };

export interface KeyLike {
  key: string;
  repeat: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/**
 * Map a keyboard event to a game input, or null to ignore it. Uses the typed
 * character (event.key), not the physical key code, so non-QWERTY layouts work;
 * lowercases so Shift and Caps Lock never cause a miss.
 */
export function keyToInput(e: KeyLike): AppKey | null {
  if (e.repeat) return null;
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  switch (e.key) {
    case "Escape":
      return { kind: "pause" };
    case "Backspace":
      return { kind: "backspace" };
    case "Enter":
      return { kind: "emp" };
  }
  if (e.key.length === 1) {
    const ch = e.key.toLowerCase();
    if (ch >= "a" && ch <= "z") return { kind: "char", ch };
  }
  return null; // space, digits, punctuation, modifiers, function keys...
}
