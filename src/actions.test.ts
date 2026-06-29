import { describe, expect, it } from "bun:test";
import {
  parseKeySpec,
  toAppleScript,
  toMacKeyEvent,
  toYdotoolArgs,
} from "./actions.js";

describe("parseKeySpec", () => {
  it("maps opt/alt to alt and recognizes named keys", () => {
    expect(parseKeySpec("ctrl+opt+space")).toEqual({
      modifiers: ["ctrl", "alt"],
      key: "space",
      named: true,
    });
  });

  it("aliases enter to return", () => {
    expect(parseKeySpec("return")).toEqual({
      modifiers: [],
      key: "return",
      named: true,
    });
    expect(parseKeySpec("enter")).toEqual({
      modifiers: [],
      key: "return",
      named: true,
    });
  });

  it("treats a single character as a typed key", () => {
    expect(parseKeySpec("cmd+a")).toEqual({
      modifiers: ["cmd"],
      key: "a",
      named: false,
    });
  });

  it("is case-insensitive and tolerant of whitespace", () => {
    expect(parseKeySpec(" CMD + Shift + Space ")).toEqual({
      modifiers: ["cmd", "shift"],
      key: "space",
      named: true,
    });
  });

  it("accepts known multi-char named keys", () => {
    expect(parseKeySpec("f5")).toEqual({ modifiers: [], key: "f5", named: true });
    expect(parseKeySpec("cmd+arrow-up")).toEqual({
      modifiers: ["cmd"],
      key: "arrow-up",
      named: true,
    });
  });

  it("rejects unknown modifiers, unknown keys, and empty specs", () => {
    expect(() => parseKeySpec("hyper+space")).toThrow(/modifier/);
    expect(() => parseKeySpec("ctrl+nope")).toThrow(/Unknown key/);
    expect(() => parseKeySpec("")).toThrow();
  });
});

describe("toAppleScript", () => {
  it("maps a named key to its key code with a using clause", () => {
    // space=49; opt→option, ctrl→control
    expect(toAppleScript(parseKeySpec("ctrl+opt+space"))).toBe(
      "key code 49 using {control down, option down}",
    );
  });

  it("emits a bare key code with no modifiers (return=36)", () => {
    expect(toAppleScript(parseKeySpec("return"))).toBe("key code 36");
  });

  it("uses keystroke for typed characters", () => {
    expect(toAppleScript(parseKeySpec("cmd+a"))).toBe(
      'keystroke "a" using {command down}',
    );
  });

  it("throws for a named key with no macOS key code", () => {
    // `volume-up` is in the vocabulary but has no stable virtual key code.
    expect(() => toAppleScript(parseKeySpec("volume-up"))).toThrow(/no macOS key code/);
  });
});

describe("toMacKeyEvent (CGEvent FFI mapping)", () => {
  it("maps a named key to its key code and ORs modifier flags", () => {
    // space=49; control=0x40000, option=0x80000 → 0xc0000
    expect(toMacKeyEvent(parseKeySpec("ctrl+opt+space"))).toEqual({
      keycode: 49,
      char: null,
      flags: 0xc0000,
    });
  });

  it("maps a bare named key with no flags (return=36)", () => {
    expect(toMacKeyEvent(parseKeySpec("return"))).toEqual({
      keycode: 36,
      char: null,
      flags: 0,
    });
  });

  it("maps a typed character to a char with cmd flag", () => {
    expect(toMacKeyEvent(parseKeySpec("cmd+a"))).toEqual({
      keycode: null,
      char: "a",
      flags: 0x100000,
    });
  });

  it("throws for a named key with no macOS key code", () => {
    expect(() => toMacKeyEvent(parseKeySpec("volume-up"))).toThrow(/no macOS key code/);
  });
});

describe("toYdotoolArgs", () => {
  it("presses modifiers, taps the key, then releases in reverse", () => {
    // ctrl=29, alt=56, space=57
    expect(toYdotoolArgs(parseKeySpec("ctrl+opt+space"))).toEqual([
      "29:1",
      "56:1",
      "57:1",
      "57:0",
      "56:0",
      "29:0",
    ]);
  });

  it("emits a bare tap with no modifiers", () => {
    // return=28
    expect(toYdotoolArgs(parseKeySpec("return"))).toEqual(["28:1", "28:0"]);
  });

  it("maps cmd to Super and typed characters to their keycode", () => {
    // cmd=125 (Super/Meta), a=30
    expect(toYdotoolArgs(parseKeySpec("cmd+a"))).toEqual([
      "125:1",
      "30:1",
      "30:0",
      "125:0",
    ]);
  });

  it("rejects the fn modifier (no Linux keycode)", () => {
    expect(() => toYdotoolArgs(parseKeySpec("fn+f5"))).toThrow(/no Linux keycode/);
  });
});
