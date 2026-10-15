import { LIMITS, type SerializedError } from "@elie309/contracts";
import type { Attributes } from "./types.js";

const MAX_DEPTH = 6;
const MAX_STRING = 8_192;
const MAX_KEYS = 100;
const MAX_ARRAY = 100;

export function serializeError(
  error: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): SerializedError {
  if (error instanceof Error) {
    if (seen.has(error)) return { name: error.name, message: "[Circular cause]" };
    seen.add(error);
    const out: SerializedError = { name: error.name, message: error.message };
    if (error.stack) out.stack = error.stack.slice(0, LIMITS.maxStackLength);
    if (error.cause !== undefined && depth < LIMITS.maxErrorCauseDepth) {
      out.cause = serializeError(error.cause, depth + 1, seen);
    }
    return out;
  }
  if (typeof error === "string") return { message: error.slice(0, MAX_STRING) };
  return { message: safeStringify(error) };
}

function safeStringify(value: unknown): string {
  try {
    return (JSON.stringify(sanitize(value)) ?? String(value)).slice(0, MAX_STRING);
  } catch {
    return "[Unserializable]";
  }
}

/**
 * Produce a JSON-safe copy: handles circular refs, BigInt, Error, Date, Map/Set, functions and
 * symbols, and caps depth, key count and string length so one event cannot become huge.
 */
export function sanitize(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  switch (typeof value) {
    case "string":
      return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value;
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "boolean":
    case "undefined":
      return value;
    case "bigint":
      return value.toString();
    case "symbol":
      return value.toString();
    case "function":
      return `[Function ${value.name || "anonymous"}]`;
    default:
      break;
  }
  if (value === null) return null;
  const obj = value as object;
  if (seen.has(obj)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[MaxDepth]";
  seen.add(obj);
  try {
    if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? null : obj.toISOString();
    if (obj instanceof Error) return serializeError(obj, 0, seen);
    if (obj instanceof Map) return sanitize(Object.fromEntries(obj), depth + 1, seen);
    if (obj instanceof Set) return sanitize([...obj], depth + 1, seen);
    if (Array.isArray(obj)) return obj.slice(0, MAX_ARRAY).map((v) => sanitize(v, depth + 1, seen));
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).slice(0, MAX_KEYS)) {
      try {
        out[key] = sanitize((obj as Record<string, unknown>)[key], depth + 1, seen);
      } catch {
        out[key] = "[Throws]";
      }
    }
    return out;
  } finally {
    seen.delete(obj);
  }
}

export function sanitizeAttributes(attributes: Attributes): Attributes {
  return sanitize(attributes) as Attributes;
}
