import type { LogEvent } from "@elie309/contracts";
import type { Transport } from "../types.js";

/** Keeps events in an array. Intended for tests. */
export class MemoryTransport implements Transport {
  readonly events: LogEvent[] = [];

  async write(events: readonly LogEvent[]): Promise<void> {
    this.events.push(...events);
  }

  clear(): void {
    this.events.length = 0;
  }
}
