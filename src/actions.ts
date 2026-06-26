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

/** Build the cliclick argument vector for a parsed keyspec. */
export function toCliclickArgs(parsed: ParsedKeySpec): string[] {
  const press = parsed.named ? `kp:${parsed.key}` : `t:${parsed.key}`;
  if (parsed.modifiers.length === 0) return [press];
  const mods = parsed.modifiers.join(",");
  return [`kd:${mods}`, press, `ku:${mods}`];
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
