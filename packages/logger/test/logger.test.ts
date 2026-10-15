import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transport } from "../src/index.js";
import { createLogger, MemoryTransport, uuidv7, withRequestContext } from "../src/index.js";

describe("Logger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("filters by minLevel and builds valid events", async () => {
    const mem = new MemoryTransport();
    const log = createLogger({ transports: [mem], service: "api", environment: "test" });
    log.debug("hidden");
    log.info("shown", { a: 1 });
    await log.flush();
    expect(mem.events).toHaveLength(1);
    expect(mem.events[0]).toMatchObject({
      level: "info",
      message: "shown",
      service: "api",
      environment: "test",
      attributes: { a: 1 },
      schemaVersion: 1,
    });
  });

  it("flushes on maxSize and on interval", async () => {
    const mem = new MemoryTransport();
    const log = createLogger({ transports: [mem], batch: { maxSize: 2, maxIntervalMs: 1000 } });
    log.info("1");
    expect(mem.events).toHaveLength(0);
    log.info("2");
    await vi.advanceTimersByTimeAsync(0);
    expect(mem.events).toHaveLength(2);
    log.info("3");
    await vi.advanceTimersByTimeAsync(1000);
    expect(mem.events).toHaveLength(3);
  });

  it("serializes errors with causes", async () => {
    const mem = new MemoryTransport();
    const log = createLogger({ transports: [mem] });
    log.error(new Error("outer", { cause: new Error("inner") }));
    await log.flush();
    const event = mem.events[0];
    expect(event?.message).toBe("outer");
    expect(event?.error?.cause?.message).toBe("inner");
    expect(event?.error?.stack).toBeTypeOf("string");
  });

  it("handles non-Error throwables, circular data and bigint", async () => {
    const mem = new MemoryTransport();
    const log = createLogger({ transports: [mem] });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    log.error({ code: 42 });
    log.info("x", { circular, big: 10n });
    await log.flush();
    expect(mem.events[0]?.error?.message).toContain("42");
    expect(mem.events[1]?.attributes).toEqual({ circular: { self: "[Circular]" }, big: "10" });
  });

  it("redacts sensitive keys at any depth", async () => {
    const mem = new MemoryTransport();
    const log = createLogger({ transports: [mem], redact: { keys: ["ssn2"] } });
    log.info("x", { user: { Password: "p", name: "n" }, list: [{ token: "t" }], ssn2: "1" });
    await log.flush();
    expect(mem.events[0]?.attributes).toEqual({
      user: { Password: "[REDACTED]", name: "n" },
      list: [{ token: "[REDACTED]" }],
      ssn2: "[REDACTED]",
    });
  });

  it("child loggers bind attributes and promote trace ids", async () => {
    const mem = new MemoryTransport();
    const log = createLogger({ transports: [mem] });
    log.child({ requestId: "r1", region: "eu" }).info("hi");
    await log.flush();
    expect(mem.events[0]?.requestId).toBe("r1");
    expect(mem.events[0]?.attributes).toEqual({ region: "eu" });
  });

  it("promotes source and kind to top-level fields", async () => {
    const mem = new MemoryTransport();
    const log = createLogger({ transports: [mem] });
    log.error("x", { source: "ui", kind: "boundary", page: "/a" });
    log.error("y", { source: "bogus" });
    await log.flush();
    expect(mem.events[0]).toMatchObject({ source: "ui", kind: "boundary" });
    expect(mem.events[0]?.attributes).toEqual({ page: "/a" });
    expect(mem.events[1]?.source).toBeUndefined();
    expect(mem.events[1]?.attributes).toEqual({ source: "bogus" });
  });

  it("inherits ambient request context", async () => {
    const mem = new MemoryTransport();
    const log = createLogger({ transports: [mem] });
    await withRequestContext({ requestId: "ctx" }, async () => {
      await Promise.resolve();
      log.info("inside");
    });
    await log.flush();
    expect(mem.events[0]?.requestId).toBe("ctx");
  });

  it("drops oldest events when the queue is full", async () => {
    const mem = new MemoryTransport();
    const log = createLogger({
      transports: [mem],
      batch: { maxQueue: 2, maxSize: 100, maxIntervalMs: 10_000 },
    });
    log.info("1");
    log.info("2");
    log.info("3");
    expect(log.droppedCount).toBe(1);
    await log.flush();
    expect(mem.events.map((e) => e.message)).toEqual(["2", "3"]);
  });

  it("isolates transport failures and reports them", async () => {
    const mem = new MemoryTransport();
    const bad: Transport = { write: () => Promise.reject(new Error("boom")) };
    const throwing: Transport = {
      write: () => {
        throw new Error("sync boom");
      },
    };
    const onError = vi.fn();
    const log = createLogger({ transports: [bad, throwing, mem], onError });
    log.info("still delivered");
    await log.flush();
    expect(mem.events).toHaveLength(1);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("never throws even if onError throws", async () => {
    const bad: Transport = { write: () => Promise.reject(new Error("boom")) };
    const log = createLogger({
      transports: [bad],
      onError: () => {
        throw new Error("nope");
      },
    });
    log.info("x");
    await expect(log.flush()).resolves.toBeUndefined();
  });

  it("shutdown flushes, closes transports and ignores later logs", async () => {
    const mem = new MemoryTransport();
    const close = vi.fn(async () => undefined);
    const log = createLogger({ transports: [mem, { write: async () => undefined, close }] });
    log.info("a");
    await log.shutdown();
    log.info("b");
    await log.shutdown();
    expect(mem.events).toHaveLength(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("uuidv7", () => {
  it("is well-formed and time-ordered", () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });
});
