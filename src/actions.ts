import { Logger } from "@micthiesen/mitools/logging";

const logger = new Logger("Actions");

/**
 * cliclick modifier tokens. opt/alt both map to `alt`. cliclick posts CGEvents,
 * so the process (or its parent terminal) needs Accessibility permission.
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

/** Friendly key aliases → cliclick `kp:` key names. */
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

/** cliclick's `kp:` named-key vocabulary (see `cliclick kp:?`). */
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
  /** A cliclick `kp:` key name, or a literal character to type via `t:`. */
  key: string;
  /** True when `key` is a named special key (`kp:`), false for a typed char (`t:`). */
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

/** Build the cliclick argument vector for a parsed keyspec (macOS). */
export function toCliclickArgs(parsed: ParsedKeySpec): string[] {
  const press = parsed.named ? `kp:${parsed.key}` : `t:${parsed.key}`;
  if (parsed.modifiers.length === 0) return [press];
  const mods = parsed.modifiers.join(",");
  return [`kd:${mods}`, press, `ku:${mods}`];
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
 * Linux keycodes for the named keys and characters in our keyspec vocabulary.
 * Mirrors the cliclick names so the same `config.toml` works on either platform.
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

/** Fires keypresses by shelling out to `cliclick`. */
export class CliclickPresser implements KeyPresser {
  constructor(private readonly binary = "cliclick") {}

  press(spec: string): void {
    let args: string[];
    try {
      args = toCliclickArgs(parseKeySpec(spec));
    } catch (err) {
      logger.error(`Bad keyspec "${spec}"`, err);
      return;
    }
    try {
      const proc = Bun.spawn([this.binary, ...args], {
        stdout: "ignore",
        stderr: "pipe",
      });
      proc.exited
        .then(async (code) => {
          if (code !== 0) {
            const stderr = await new Response(proc.stderr).text();
            logger.error(`cliclick exited ${code} for "${spec}": ${stderr.trim()}`);
          }
        })
        .catch((err) => logger.error(`cliclick wait failed for "${spec}"`, err));
    } catch (err) {
      logger.error(`Failed to spawn cliclick for "${spec}" (is it installed?)`, err);
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
  return process.platform === "darwin" ? new CliclickPresser() : new YdotoolPresser();
}
