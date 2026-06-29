import { dlopen, FFIType } from "bun:ffi";
import { Logger } from "@micthiesen/mitools/logging";

const logger = new Logger("Actions");

/**
 * Canonical modifier tokens. opt/alt both map to `alt`. The platform pressers map
 * these on: macOS via osascript "… down" tokens, Linux via input-event keycodes.
 */
const MODIFIERS: Record<string, string> = {
  cmd: "cmd",
  command: "cmd",
  ctrl: "ctrl",
  control: "ctrl",
  opt: "alt",
  alt: "alt",
  option: "alt",
  shift: "shift",
  fn: "fn",
};

/** Friendly key aliases → canonical named-key names. */
const KEY_ALIASES: Record<string, string> = {
  enter: "return",
  return: "return",
  space: "space",
  spacebar: "space",
  tab: "tab",
  esc: "esc",
  escape: "esc",
  delete: "delete",
  backspace: "delete",
};

/** The named-key vocabulary a keyspec may use (mapped per-platform by the presser). */
const KNOWN_NAMED_KEYS = new Set([
  "arrow-down",
  "arrow-left",
  "arrow-right",
  "arrow-up",
  "brightness-down",
  "brightness-up",
  "delete",
  "end",
  "enter",
  "esc",
  "f1",
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f7",
  "f8",
  "f9",
  "f10",
  "f11",
  "f12",
  "f13",
  "f14",
  "f15",
  "f16",
  "fwd-delete",
  "home",
  "keys-light-down",
  "keys-light-toggle",
  "keys-light-up",
  "mute",
  "num-0",
  "num-1",
  "num-2",
  "num-3",
  "num-4",
  "num-5",
  "num-6",
  "num-7",
  "num-8",
  "num-9",
  "num-clear",
  "num-divide",
  "num-enter",
  "num-equals",
  "num-minus",
  "num-multiply",
  "num-plus",
  "page-down",
  "page-up",
  "play-next",
  "play-pause",
  "play-previous",
  "return",
  "space",
  "tab",
  "volume-down",
  "volume-up",
]);

export interface ParsedKeySpec {
  modifiers: string[];
  /** A named special key (e.g. "return", "space"), or a single literal character. */
  key: string;
  /** True when `key` is a named special key, false for a typed character. */
  named: boolean;
}

/** Parse "ctrl+opt+space" → { modifiers: ["ctrl","alt"], key: "space", named: true }. */
export function parseKeySpec(spec: string): ParsedKeySpec {
  const parts = spec
    .split("+")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
  if (parts.length === 0) throw new Error(`Empty keyspec: "${spec}"`);

  const keyToken = parts[parts.length - 1];
  const modTokens = parts.slice(0, -1);

  const modifiers = modTokens.map((m) => {
    const mapped = MODIFIERS[m];
    if (!mapped) throw new Error(`Unknown modifier "${m}" in keyspec "${spec}"`);
    return mapped;
  });

  const aliased = KEY_ALIASES[keyToken];
  if (aliased) return { modifiers, key: aliased, named: true };
  if (keyToken.length === 1) return { modifiers, key: keyToken, named: false };
  if (KNOWN_NAMED_KEYS.has(keyToken)) return { modifiers, key: keyToken, named: true };
  throw new Error(`Unknown key "${keyToken}" in keyspec "${spec}"`);
}

/**
 * macOS modifiers as AppleScript `using { … }` tokens. (System Events has no `fn`
 * modifier, so a keyspec using `fn` throws — logged as a no-op by the presser.)
 */
const APPLESCRIPT_MODIFIERS: Record<string, string> = {
  cmd: "command down",
  ctrl: "control down",
  alt: "option down",
  shift: "shift down",
};

/** CGEventFlags masks for the modifiers (used by the in-process FFI presser). */
const MACOS_MODIFIER_FLAGS: Record<string, number> = {
  shift: 0x20000, // kCGEventFlagMaskShift
  ctrl: 0x40000, // kCGEventFlagMaskControl
  alt: 0x80000, // kCGEventFlagMaskAlternate (option)
  cmd: 0x100000, // kCGEventFlagMaskCommand
};

/**
 * macOS virtual key codes (kVK_*) for the named-key vocabulary. Shared by both
 * macOS backends — the in-process CGEvent presser (`CGEventCreateKeyboardEvent`)
 * and the osascript fallback (`key code N`). We do NOT use `cliclick kp:`: its
 * CGEvent special-keys (e.g. Return) are silently dropped by apps on recent macOS.
 * The common subset is mapped; less-common names (media/volume/brightness) have no
 * stable virtual key code and throw if configured (logged as a no-op by the presser).
 */
const MACOS_KEY_CODES: Record<string, number> = {
  return: 36,
  space: 49,
  tab: 48,
  esc: 53,
  delete: 51, // Backspace (the mac "delete" key)
  "fwd-delete": 117,
  "arrow-up": 126,
  "arrow-down": 125,
  "arrow-left": 123,
  "arrow-right": 124,
  home: 115,
  end: 119,
  "page-up": 116,
  "page-down": 121,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111,
};

/**
 * Build the AppleScript statement for a parsed keyspec (macOS), to run as
 * `tell application "System Events" to <stmt>`. Named keys use `key code`; a typed
 * character uses `keystroke`. Modifiers attach via a `using { … }` clause.
 */
export function toAppleScript(parsed: ParsedKeySpec): string {
  const using = parsed.modifiers.map((m) => {
    const tok = APPLESCRIPT_MODIFIERS[m];
    if (!tok) throw new Error(`Modifier "${m}" has no AppleScript equivalent`);
    return tok;
  });
  const usingClause = using.length > 0 ? ` using {${using.join(", ")}}` : "";

  if (parsed.named) {
    const code = MACOS_KEY_CODES[parsed.key];
    if (code === undefined) {
      throw new Error(
        `Key "${parsed.key}" has no macOS key code (unsupported via osascript)`,
      );
    }
    return `key code ${code}${usingClause}`;
  }
  // Typed character: escape backslash and quote for the AppleScript string literal.
  const ch = parsed.key.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `keystroke "${ch}"${usingClause}`;
}

/** A resolved macOS key event: a virtual key code OR a literal char, plus modifier flags. */
export interface MacKeyEvent {
  /** macOS virtual key code for a named key, or null when typing a `char`. */
  keycode: number | null;
  /** Literal character to type via a unicode event, or null for a `keycode`. */
  char: string | null;
  /** Combined CGEventFlags modifier mask. */
  flags: number;
}

/** Resolve a parsed keyspec to a CGEvent keycode/char + modifier flags (macOS). */
export function toMacKeyEvent(parsed: ParsedKeySpec): MacKeyEvent {
  let flags = 0;
  for (const m of parsed.modifiers) {
    const mask = MACOS_MODIFIER_FLAGS[m];
    if (mask === undefined) {
      throw new Error(`Modifier "${m}" has no macOS flag mask (unsupported)`);
    }
    flags |= mask;
  }
  if (parsed.named) {
    const keycode = MACOS_KEY_CODES[parsed.key];
    if (keycode === undefined) {
      throw new Error(`Key "${parsed.key}" has no macOS key code (unsupported)`);
    }
    return { keycode, char: null, flags };
  }
  return { keycode: null, char: parsed.key, flags };
}

/**
 * Linux input-event keycodes (`/usr/include/linux/input-event-codes.h`) for the
 * modifiers we emit. `cmd` maps to Super/Meta — the closest Linux analogue of the
 * mac Command key.
 */
const YDOTOOL_MODIFIER_CODES: Record<string, number> = {
  ctrl: 29, // KEY_LEFTCTRL
  alt: 56, // KEY_LEFTALT
  shift: 42, // KEY_LEFTSHIFT
  cmd: 125, // KEY_LEFTMETA (Super)
};

/**
 * Linux keycodes for the common subset of the keyspec vocabulary — the keys a
 * `config.toml` realistically uses on both platforms. Less-common cliclick names
 * (f13–f16, the num-pad, media/volume/brightness keys) are macOS-only and will
 * throw on Linux (logged as a no-op by {@link YdotoolPresser}) if configured.
 * `delete`/`backspace` map to Backspace (KEY_BACKSPACE), matching the mac key.
 */
const YDOTOOL_KEY_CODES: Record<string, number> = {
  // named special keys
  return: 28, // KEY_ENTER
  enter: 28,
  space: 57,
  tab: 15,
  esc: 1,
  delete: 14, // KEY_BACKSPACE (the mac "delete" key)
  "fwd-delete": 111, // KEY_DELETE (forward delete)
  "arrow-up": 103,
  "arrow-down": 108,
  "arrow-left": 105,
  "arrow-right": 106,
  home: 102,
  end: 107,
  "page-up": 104,
  "page-down": 109,
  f1: 59,
  f2: 60,
  f3: 61,
  f4: 62,
  f5: 63,
  f6: 64,
  f7: 65,
  f8: 66,
  f9: 67,
  f10: 68,
  f11: 87,
  f12: 88,
  // letters
  a: 30,
  b: 48,
  c: 46,
  d: 32,
  e: 18,
  f: 33,
  g: 34,
  h: 35,
  i: 23,
  j: 36,
  k: 37,
  l: 38,
  m: 50,
  n: 49,
  o: 24,
  p: 25,
  q: 16,
  r: 19,
  s: 31,
  t: 20,
  u: 22,
  v: 47,
  w: 17,
  x: 45,
  y: 21,
  z: 44,
  // digits
  "1": 2,
  "2": 3,
  "3": 4,
  "4": 5,
  "5": 6,
  "6": 7,
  "7": 8,
  "8": 9,
  "9": 10,
  "0": 11,
  // common punctuation
  "-": 12,
  "=": 13,
  "[": 26,
  "]": 27,
  ";": 39,
  "'": 40,
  "`": 41,
  "\\": 43,
  ",": 51,
  ".": 52,
  "/": 53,
};

/**
 * Build the `ydotool key` argument vector for a parsed keyspec (Linux). ydotool
 * speaks raw `<keycode>:<state>` events, so we press the modifiers, tap the key,
 * then release the modifiers in reverse order.
 */
export function toYdotoolArgs(parsed: ParsedKeySpec): string[] {
  const modCodes = parsed.modifiers.map((m) => {
    const code = YDOTOOL_MODIFIER_CODES[m];
    if (code === undefined) {
      throw new Error(`Modifier "${m}" has no Linux keycode (unsupported via ydotool)`);
    }
    return code;
  });
  const keyCode = YDOTOOL_KEY_CODES[parsed.key];
  if (keyCode === undefined) {
    throw new Error(
      `Key "${parsed.key}" has no Linux keycode (unsupported via ydotool)`,
    );
  }
  const seq: string[] = [];
  for (const code of modCodes) seq.push(`${code}:1`);
  seq.push(`${keyCode}:1`, `${keyCode}:0`);
  for (const code of [...modCodes].reverse()) seq.push(`${code}:0`);
  return seq;
}

export interface KeyPresser {
  press(spec: string): void;
}

/**
 * Fires keypresses in-process via CoreGraphics CGEvents (Bun FFI) — the macOS
 * fast path. No subprocess, so dispatch is ~sub-ms instead of the ~90ms it costs
 * to spawn osascript/cliclick per press (which is what made macOS feel laggier
 * than Linux's persistent ydotoold). Posts to the HID event tap, which delivers
 * special keys (Return) to apps and triggers global hotkeys. Needs Accessibility
 * (the daemon's TingType.app identity has it) — but NOT Automation. Construction
 * throws if the frameworks can't be dlopen'd, so the caller can fall back to
 * {@link AppleScriptPresser}.
 */
export class CgEventPresser implements KeyPresser {
  private readonly cg;
  private readonly cf;

  constructor() {
    this.cg = dlopen("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics", {
      CGEventCreateKeyboardEvent: {
        args: [FFIType.ptr, FFIType.u16, FFIType.bool],
        returns: FFIType.ptr,
      },
      CGEventPost: { args: [FFIType.u32, FFIType.ptr], returns: FFIType.void },
      CGEventSetFlags: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.void },
      CGEventKeyboardSetUnicodeString: {
        args: [FFIType.ptr, FFIType.u64, FFIType.ptr],
        returns: FFIType.void,
      },
    });
    this.cf = dlopen(
      "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation",
      { CFRelease: { args: [FFIType.ptr], returns: FFIType.void } },
    );
  }

  press(spec: string): void {
    let ev: MacKeyEvent;
    try {
      ev = toMacKeyEvent(parseKeySpec(spec));
    } catch (err) {
      logger.error(`Bad keyspec "${spec}"`, err);
      return;
    }
    const cg = this.cg.symbols;
    const cf = this.cf.symbols;
    const HID_TAP = 0; // kCGHIDEventTap
    const charBuf = ev.char !== null ? new Uint16Array([ev.char.charCodeAt(0)]) : null;
    try {
      // Post key-down then key-up; a typed char carries a unicode string instead
      // of relying on the key code, and modifiers ride along as event flags.
      for (const down of [true, false]) {
        const event = cg.CGEventCreateKeyboardEvent(null, ev.keycode ?? 0, down);
        if (charBuf) cg.CGEventKeyboardSetUnicodeString(event, charBuf.length, charBuf);
        if (ev.flags !== 0) cg.CGEventSetFlags(event, ev.flags);
        cg.CGEventPost(HID_TAP, event);
        cf.CFRelease(event);
      }
    } catch (err) {
      logger.error(`Failed to post CGEvent for "${spec}"`, err);
    }
  }
}

/**
 * Fires keypresses on macOS via `osascript` driving System Events — the fallback
 * when the CGEvent FFI path can't load. This uses the Accessibility API (not raw
 * CGEvents like cliclick), so special keys such as Return reach the focused app.
 * Needs Accessibility *and* Automation ("control System Events") permission.
 */
export class AppleScriptPresser implements KeyPresser {
  constructor(private readonly binary = "osascript") {}

  press(spec: string): void {
    let stmt: string;
    try {
      stmt = toAppleScript(parseKeySpec(spec));
    } catch (err) {
      logger.error(`Bad keyspec "${spec}"`, err);
      return;
    }
    const script = `tell application "System Events" to ${stmt}`;
    try {
      const proc = Bun.spawn([this.binary, "-e", script], {
        stdout: "ignore",
        stderr: "pipe",
      });
      proc.exited
        .then(async (code) => {
          if (code !== 0) {
            const stderr = await new Response(proc.stderr).text();
            logger.error(`osascript exited ${code} for "${spec}": ${stderr.trim()}`);
          }
        })
        .catch((err) => logger.error(`osascript wait failed for "${spec}"`, err));
    } catch (err) {
      logger.error(`Failed to spawn osascript for "${spec}"`, err);
    }
  }
}

/**
 * Fires keypresses by shelling out to `ydotool` (Linux). Requires `ydotoold`
 * running with access to `/dev/uinput`; it injects at the kernel input layer, so
 * it works regardless of the Wayland compositor (unlike compositor-specific tools).
 */
export class YdotoolPresser implements KeyPresser {
  constructor(private readonly binary = "ydotool") {}

  press(spec: string): void {
    let args: string[];
    try {
      args = toYdotoolArgs(parseKeySpec(spec));
    } catch (err) {
      logger.error(`Bad keyspec "${spec}"`, err);
      return;
    }
    try {
      const proc = Bun.spawn([this.binary, "key", ...args], {
        stdout: "ignore",
        stderr: "pipe",
      });
      proc.exited
        .then(async (code) => {
          if (code !== 0) {
            const stderr = await new Response(proc.stderr).text();
            logger.error(`ydotool exited ${code} for "${spec}": ${stderr.trim()}`);
          }
        })
        .catch((err) => logger.error(`ydotool wait failed for "${spec}"`, err));
    } catch (err) {
      logger.error(
        `Failed to spawn ydotool for "${spec}" (is it installed and ydotoold running?)`,
        err,
      );
    }
  }
}

/** Pick the keypress backend for the current platform. */
export function createPresser(): KeyPresser {
  if (process.platform !== "darwin") return new YdotoolPresser();
  // Prefer the in-process CGEvent path; fall back to osascript if FFI can't load.
  try {
    return new CgEventPresser();
  } catch (err) {
    logger.warn(`CGEvent FFI unavailable, falling back to osascript: ${String(err)}`);
    return new AppleScriptPresser();
  }
}
