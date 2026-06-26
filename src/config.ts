import { baseConfigSchema, Injector } from "@micthiesen/mitools/config";
import { z } from "zod";

/**
 * Operational/env config (log level, optional Pushover creds for fatal-error
 * notifications). Tuning lives in the TOML file — see {@link ./appConfig.ts}.
 */
const configSchema = baseConfigSchema.extend({
  /** Path to the tuning TOML; relative paths resolve from the process cwd. */
  TINGTYPE_CONFIG: z.string().optional().default("config.toml"),
});

export type Config = z.infer<typeof configSchema>;

/** Pure parse — used for hermetic default tests. */
export function parseConfig(env: NodeJS.ProcessEnv): Config {
  return configSchema.parse(env);
}

let cached: Config | undefined;

export function loadConfig(): Config {
  if (cached) return cached;
  const config = parseConfig(process.env);
  Injector.configure({ config }); // Logger + pushover read this
  cached = config;
  return config;
}

export function getConfig(): Config {
  if (!cached) throw new Error("Config not loaded. Call loadConfig() first.");
  return cached;
}
