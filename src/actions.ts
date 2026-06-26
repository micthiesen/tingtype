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
  // Assume it's a cliclick special-key name (e.g. arrow-up, f5, page-down).
  return { modifiers, key: keyToken, named: true };
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
      proc.exited.then(async (code) => {
        if (code !== 0) {
          const stderr = await new Response(proc.stderr).text();
          logger.error(`cliclick exited ${code} for "${spec}": ${stderr.trim()}`);
        }
      });
    } catch (err) {
      logger.error(`Failed to spawn cliclick for "${spec}" (is it installed?)`, err);
    }
  }
}
