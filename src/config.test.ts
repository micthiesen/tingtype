import { describe, expect, it } from "bun:test";
import { LogLevel } from "@micthiesen/mitools/logging";
import { normalizeAppConfig } from "./appConfig.js";
import { parseAvfoundationDevices, resolveDevice } from "./audio/devices.js";
import { parseConfig } from "./config.js";

describe("parseConfig (env)", () => {
  it("applies defaults for a bare environment", () => {
    const c = parseConfig({});
    expect(c.TINGTYPE_CONFIG).toBe("config.toml");
    expect(c.LOG_LEVEL).toBe(LogLevel.INFO);
  });
});

describe("normalizeAppConfig", () => {
  it("supplies full defaults for an empty config", () => {
    const c = normalizeAppConfig({});
    expect(c.audio.inputDevice).toContain("CUBILUX");
    expect(c.audio.sampleRate).toBe(48000);
    expect(c.detector.tones).toEqual([2016, 2484, 3141]);
    expect(c.detector.fs).toBe(48000);
    expect(c.gesture.holdMs).toBe(400);
    expect(c.gesture.bridgeMs).toBe(200);
    expect(c.actions.primary).toBe("ctrl+opt+space");
    expect(c.actions.secondary).toBe("return");
  });

  it("propagates the sample rate into the detector", () => {
    const c = normalizeAppConfig({ audio: { samplerate: 44100 } });
    expect(c.detector.fs).toBe(44100);
  });

  it("pads the noise floor to match the tone count", () => {
    const c = normalizeAppConfig({
      detector: { tones: [1000, 2000, 3000], noise_floor: [5] },
    });
    expect(c.detector.noiseFloor).toEqual([5, 0, 0]);
  });

  it("rejects a non-power-of-two window", () => {
    expect(() => normalizeAppConfig({ detector: { window: 1000 } })).toThrow(
      /power of two/,
    );
  });

  it("rejects a hop larger than the window", () => {
    expect(() => normalizeAppConfig({ detector: { window: 1024, hop: 2048 } })).toThrow(
      /hop/,
    );
  });
});

describe("avfoundation device parsing", () => {
  const stderr = `[AVFoundation indev @ 0x1] AVFoundation video devices:
[AVFoundation indev @ 0x1] [0] Insta360 Link
[AVFoundation indev @ 0x1] AVFoundation audio devices:
[AVFoundation indev @ 0x1] [0] Insta360 Link
[AVFoundation indev @ 0x1] [1] CUBILUX HLMS-C4 MIC IN
[AVFoundation indev @ 0x1] [2] MacBook Pro Microphone
[AVFoundation indev @ 0x1] [3] CUBILUX HLMS-C4 Line IN`;

  it("extracts only the audio devices", () => {
    const devices = parseAvfoundationDevices(stderr);
    expect(devices).toEqual([
      { index: 0, name: "Insta360 Link" },
      { index: 1, name: "CUBILUX HLMS-C4 MIC IN" },
      { index: 2, name: "MacBook Pro Microphone" },
      { index: 3, name: "CUBILUX HLMS-C4 Line IN" },
    ]);
  });

  it("resolves a device by case-insensitive substring", () => {
    const devices = parseAvfoundationDevices(stderr);
    expect(resolveDevice("line in", devices)?.index).toBe(3);
    expect(resolveDevice("nope", devices)).toBeUndefined();
  });
});
