import { randomUUID } from "node:crypto";
import { type LogEvent, SCHEMA_VERSION } from "@elie309/contracts";
import { afterEach, describe, expect, it } from "vitest";

/** Structural copy of the logger's `Transport`, so test-utils does not depend on the logger. */
export interface Transport {
  write(events: readonly LogEvent[]): Promise<void>;
  flush?(): Promise<void>;
  close?(): Promise<void>;
}

export interface ConformanceHarness {
  transport: Transport;
  /** Return every stored event, oldest first. */
  readAll(): Promise<LogEvent[]>;
  cleanup(): Promise<void>;
}

export interface ConformanceOptions {
  /** True if writing the same event id twice must store it once. */
  dedupesIds: boolean;
}

export function makeEvent(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    level: "info",
    message: "hello",
    ...overrides,
  };
}

/** Behaviour every storage transport must share. Call inside a test file. */
export function runTransportConformance(
  name: string,
  create: () => Promise<ConformanceHarness>,
  options: ConformanceOptions,
): void {
  describe(`${name} conformance`, () => {
    const harnesses: ConformanceHarness[] = [];
    const make = async () => {
      const h = await create();
      harnesses.push(h);
      return h;
    };
    afterEach(async () => {
      for (const h of harnesses.splice(0)) await h.cleanup();
    });

    it("stores a batch in order", async () => {
      const h = await make();
      const events = [
        makeEvent({ message: "1" }),
        makeEvent({ message: "2" }),
        makeEvent({ message: "3" }),
      ];
      await h.transport.write(events);
      await h.transport.flush?.();
      expect((await h.readAll()).map((e) => e.message)).toEqual(["1", "2", "3"]);
    });

    it("round-trips all fields", async () => {
      const h = await make();
      const event = makeEvent({
        level: "error",
        message: "boom",
        environment: "prod",
        service: "api",
        release: "1.2.3",
        requestId: "r",
        traceId: "t",
        spanId: "s",
        error: { name: "Error", message: "boom", stack: "stack", cause: { message: "inner" } },
        attributes: { nested: { a: [1, 2, 3] }, flag: true, text: "ünïcode ✓" },
        sdk: { name: "@elie309/logger", version: "0.0.0" },
      });
      await h.transport.write([event]);
      await h.transport.flush?.();
      expect(await h.readAll()).toEqual([event]);
    });

    it("handles many events across multiple writes", async () => {
      const h = await make();
      for (let i = 0; i < 5; i++) {
        await h.transport.write(
          Array.from({ length: 120 }, (_, j) => makeEvent({ message: `${i}-${j}` })),
        );
      }
      await h.transport.flush?.();
      expect(await h.readAll()).toHaveLength(600);
    });

    it("close and flush are safe and idempotent", async () => {
      const h = await make();
      await h.transport.write([makeEvent()]);
      await h.transport.flush?.();
      await h.transport.close?.();
      await expect(h.transport.close?.()).resolves.toBeUndefined();
    });

    if (options.dedupesIds) {
      it("is idempotent for retried events with the same id", async () => {
        const h = await make();
        const event = makeEvent();
        await h.transport.write([event]);
        await h.transport.write([event, makeEvent({ message: "other" })]);
        await h.transport.flush?.();
        expect(await h.readAll()).toHaveLength(2);
      });
    }
  });
}
