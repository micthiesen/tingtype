import { normalizeAppConfig } from "../appConfig.js";
import type { DetectorOptions } from "./detect.js";

/**
 * Detector defaults for tests, derived from the config schema so tuning the
 * defaults in one place keeps the tests honest (no drifting hardcoded copies).
 */
const base = normalizeAppConfig({}).detector;

export const FS = base.fs;
export const WINDOW = base.window;
export const TONES = base.tones;

export function detectorOpts(
  overrides: Partial<DetectorOptions> = {},
): DetectorOptions {
  return { ...base, ...overrides };
}
