import { describe, expect, it } from "vitest";
import { keyToInput, type KeyLike } from "../src/app/keys";

const k = (key: string, extra: Partial<KeyLike> = {}): KeyLike => ({
  key,
  repeat: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...extra,
});

describe("keyboard mapping", () => {
  it("lowercases letters so Shift and Caps Lock never cause a miss", () => {
    expect(keyToInput(k("a"))).toEqual({ kind: "char", ch: "a" });
    expect(keyToInput(k("A"))).toEqual({ kind: "char", ch: "a" });
  });

  it("maps Enter, Backspace and Escape", () => {
    expect(keyToInput(k("Enter"))).toEqual({ kind: "emp" });
    expect(keyToInput(k("Backspace"))).toEqual({ kind: "backspace" });
    expect(keyToInput(k("Escape"))).toEqual({ kind: "pause" });
  });

  it("ignores auto-repeat, modifier chords, modifiers, space, digits and punctuation", () => {
    expect(keyToInput(k("a", { repeat: true }))).toBeNull();
    expect(keyToInput(k("r", { ctrlKey: true }))).toBeNull();
    for (const key of ["Shift", "CapsLock", "Control", " ", "1", ".", "é", "F5", "Tab"]) {
      expect(keyToInput(k(key))).toBeNull();
    }
  });
});
