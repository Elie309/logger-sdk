import { describe, expect, it } from "vitest";
import {
  compareLevels,
  IngestRequestSchema,
  isLogLevel,
  LEVEL_SEVERITY,
  LIMITS,
  LogEventSchema,
  SCHEMA_VERSION,
} from "../src/index.js";

const valid = {
  schemaVersion: SCHEMA_VERSION,
  id: "01890000-0000-7000-8000-000000000000",
  timestamp: "2026-01-01T00:00:00.000Z",
  level: "info",
  message: "hello",
} as const;

describe("LogEventSchema", () => {
  it("accepts a minimal event", () => {
    expect(LogEventSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts nested error causes", () => {
    const result = LogEventSchema.safeParse({
      ...valid,
      error: { name: "Error", message: "a", cause: { name: "Error", message: "b" } },
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown levels and bad timestamps", () => {
    expect(LogEventSchema.safeParse({ ...valid, level: "trace" }).success).toBe(false);
    expect(LogEventSchema.safeParse({ ...valid, timestamp: "yesterday" }).success).toBe(false);
  });

  it("rejects over-long messages", () => {
    const message = "x".repeat(LIMITS.maxMessageLength + 1);
    expect(LogEventSchema.safeParse({ ...valid, message }).success).toBe(false);
  });
});

describe("IngestRequestSchema", () => {
  it("requires at least one event and enforces the batch limit", () => {
    expect(IngestRequestSchema.safeParse({ events: [] }).success).toBe(false);
    const events = Array.from({ length: LIMITS.maxBatchSize + 1 }, () => valid);
    expect(IngestRequestSchema.safeParse({ events }).success).toBe(false);
    expect(IngestRequestSchema.safeParse({ events: [valid] }).success).toBe(true);
  });
});

describe("levels", () => {
  it("orders levels by severity", () => {
    expect(compareLevels("error", "info")).toBeGreaterThan(0);
    expect(LEVEL_SEVERITY.fatal).toBeGreaterThan(LEVEL_SEVERITY.error);
  });

  it("guards level strings", () => {
    expect(isLogLevel("warn")).toBe(true);
    expect(isLogLevel("nope")).toBe(false);
    expect(isLogLevel(3)).toBe(false);
  });
});
