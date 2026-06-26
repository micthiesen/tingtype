import { Logger } from "@micthiesen/mitools/logging";

// No test sends a real notification or fires a real keypress: disable the
// error→Pushover hook and strip live creds Bun auto-loads from .env.
Logger.onError = null;
for (const key of ["PUSHOVER_TOKEN", "PUSHOVER_USER"]) delete process.env[key];
