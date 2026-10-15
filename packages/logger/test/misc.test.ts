import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleTransport, createLogger, sanitize, serializeError } from "../src/index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ConsoleTransport", () => {
  it("writes json lines, info to stdout and errors to stderr", async () => {
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const log = createLogger({ transports: [new ConsoleTransport()] });
    log.info("a");
    log.error("b");
    await log.flush();
    expect(JSON.parse(String(out.mock.calls[0]?.[0])).message).toBe("a");
    expect(JSON.parse(String(err.mock.calls[0]?.[0])).message).toBe("b");
  });

  it("pretty format includes attributes and stacks", async () => {
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const log = createLogger({ transports: [new ConsoleTransport({ format: "pretty" })] });
    log.info("hello", { k: 1 });
    log.error(new Error("bad"));
    await log.flush();
    expect(String(out.mock.calls[0]?.[0])).toContain('INFO  hello {"k":1}');
    expect(String(err.mock.calls[0]?.[0])).toContain("Error: bad");
  });

  it("is the default transport", async () => {
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const log = createLogger();
    log.info("x");
    await log.flush();
    expect(out).toHaveBeenCalledTimes(1);
  });
});

describe("sanitize / serializeError", () => {
  it("handles assorted value types", () => {
    const value = sanitize({
      d: new Date("2026-01-01T00:00:00Z"),
      bad: new Date("nope"),
      m: new Map([["a", 1]]),
      s: new Set([1, 2]),
      f: function named() {},
      sym: Symbol("s"),
      n: Number.NaN,
      long: "x".repeat(9000),
      deep: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } },
      get boom(): never {
        throw new Error("getter");
      },
    }) as Record<string, unknown>;
    expect(value.d).toBe("2026-01-01T00:00:00.000Z");
    expect(value.bad).toBeNull();
    expect(value.m).toEqual({ a: 1 });
    expect(value.s).toEqual([1, 2]);
    expect(value.f).toBe("[Function named]");
    expect(value.sym).toBe("Symbol(s)");
    expect(value.n).toBe("NaN");
    expect(String(value.long)).toContain("[truncated]");
    expect(JSON.stringify(value.deep)).toContain("[MaxDepth]");
    expect(value.boom).toBe("[Throws]");
  });

  it("serializes strings, primitives and circular causes", () => {
    expect(serializeError("oops")).toEqual({ message: "oops" });
    expect(serializeError(5).message).toBe("5");
    const a = new Error("a");
    a.cause = a;
    expect(serializeError(a).cause?.message).toBe("[Circular cause]");
    const circ: Record<string, unknown> = {};
    circ.self = circ;
    expect(serializeError(circ).message).toContain("Circular");
  });
});

describe("flushOnExit", () => {
  it("registers and removes process hooks", async () => {
    const before = process.listenerCount("SIGTERM");
    const log = createLogger({ flushOnExit: true, transports: [{ write: async () => undefined }] });
    expect(process.listenerCount("SIGTERM")).toBe(before + 1);
    await log.shutdown();
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });

  it("warn and fatal accept errors or strings", async () => {
    const events: string[] = [];
    const log = createLogger({
      minLevel: "debug",
      transports: [
        { write: async (e) => void events.push(...e.map((x) => `${x.level}:${x.message}`)) },
      ],
    });
    log.debug("d");
    log.warn("w");
    log.fatal(new Error("f"));
    await log.flush();
    expect(events).toEqual(["debug:d", "warn:w", "fatal:f"]);
  });
});
