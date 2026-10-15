export const LOG_LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/** Numeric severity, higher is more severe. Used for `minLevel` filtering. */
export const LEVEL_SEVERITY: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && (LOG_LEVELS as readonly string[]).includes(value);
}

export function compareLevels(a: LogLevel, b: LogLevel): number {
  return LEVEL_SEVERITY[a] - LEVEL_SEVERITY[b];
}
