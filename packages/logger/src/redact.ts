import type { Attributes, RedactOptions } from "./types.js";

export const DEFAULT_REDACT_KEYS: readonly string[] = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "set-cookie",
  "creditcard",
  "card_number",
  "ssn",
];

export type Redactor = (attributes: Attributes) => Attributes;

/** Build a redactor that masks values of matching keys at any depth. Input is not mutated. */
export function createRedactor(options: RedactOptions = {}): Redactor {
  const keys = new Set(
    [...DEFAULT_REDACT_KEYS, ...(options.keys ?? [])].map((k) => k.toLowerCase()),
  );
  const censor = options.censor ?? "[REDACTED]";

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = keys.has(k.toLowerCase()) ? censor : walk(v);
      }
      return out;
    }
    return value;
  };

  return (attributes) => walk(attributes) as Attributes;
}
