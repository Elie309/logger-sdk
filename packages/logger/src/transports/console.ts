import type { LogEvent } from "@elie309/contracts";
import type { Transport } from "../types.js";

export interface ConsoleTransportOptions {
  /** `json` writes one JSON object per line; `pretty` is human-friendly. Default `json`. */
  format?: "json" | "pretty";
}

/** Writes to stdout (debug/info) and stderr (warn and above) without using `console`. */
export class ConsoleTransport implements Transport {
  readonly #format: "json" | "pretty";

  constructor(options: ConsoleTransportOptions = {}) {
    this.#format = options.format ?? "json";
  }

  async write(events: readonly LogEvent[]): Promise<void> {
    for (const event of events) {
      const line = this.#format === "json" ? JSON.stringify(event) : pretty(event);
      const stream =
        event.level === "debug" || event.level === "info" ? process.stdout : process.stderr;
      stream.write(`${line}\n`);
    }
  }
}

function pretty(event: LogEvent): string {
  const head = `${event.timestamp} ${event.level.toUpperCase().padEnd(5)} ${event.message}`;
  const extra = [
    event.attributes ? JSON.stringify(event.attributes) : "",
    event.error?.stack ?? event.error?.message ?? "",
  ].filter(Boolean);
  return extra.length > 0 ? `${head} ${extra.join("\n")}` : head;
}
