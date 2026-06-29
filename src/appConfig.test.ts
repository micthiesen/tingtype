import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAppConfig, normalizeAppConfig } from "./appConfig.js";

describe("normalizeAppConfig", () => {
  test("a bare config boots on built-in defaults", () => {
    const c = normalizeAppConfig({});
    expect(c.audio.inputDevice).toBe("CUBILUX HLMS-C4 Line IN");
    expect(c.detector.window).toBe(1024);
    expect(c.actions.primary).toBe("ctrl+opt+space");
  });

  test("rejects a non-power-of-two window", () => {
    expect(() => normalizeAppConfig({ detector: { window: 1000 } })).toThrow(
      /power of two/,
    );
  });

  test("rejects a bad keyspec at load time", () => {
    expect(() => normalizeAppConfig({ actions: { primary: "ctrl+nope" } })).toThrow(
      /actions\.primary/,
    );
  });
});

describe("loadAppConfig with config.local.toml", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tingtype-cfg-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("falls back to defaults when neither file exists", () => {
    const c = loadAppConfig(join(dir, "config.toml"));
    expect(c.audio.inputDevice).toBe("CUBILUX HLMS-C4 Line IN");
  });

  test("local override wins on overlapping keys, base fills the rest", () => {
    const base = join(dir, "config.toml");
    writeFileSync(
      base,
      '[audio]\ninput_device = "alsa:ting_shared"\nsamplerate = 48000\n',
    );
    writeFileSync(
      join(dir, "config.local.toml"),
      '[audio]\ninput_device = "CUBILUX HLMS-C4 Line IN"\n',
    );
    const c = loadAppConfig(base);
    // Override replaces the device; the base samplerate survives the merge.
    expect(c.audio.inputDevice).toBe("CUBILUX HLMS-C4 Line IN");
    expect(c.audio.sampleRate).toBe(48000);
  });

  test("merge is deep across tables — a local audio override leaves detector alone", () => {
    const base = join(dir, "config.toml");
    writeFileSync(base, "[detector]\nk_consecutive = 7\n");
    writeFileSync(join(dir, "config.local.toml"), '[audio]\ninput_device = "Mic"\n');
    const c = loadAppConfig(base);
    expect(c.audio.inputDevice).toBe("Mic");
    expect(c.detector.kConsecutive).toBe(7);
  });
});
