import type { LogEvent, LogLevel } from "@elie309/contracts";

/** Destination for batches of log events. Implementations must not throw synchronously. */
export interface Transport {
  /** Persist or forward a batch. Reject to signal failure; the logger reports it via `onError`. */
  write(events: readonly LogEvent[]): Promise<void>;
  /** Force out anything the transport itself buffers. */
  flush?(): Promise<void>;
  /** Release resources. Called once from `logger.shutdown()`. */
  close?(): Promise<void>;
}

export type Attributes = Record<string, unknown>;

export interface BatchOptions {
  /** Flush as soon as this many events are queued. Default 50. */
  maxSize?: number;
  /** Flush at least this often while events are pending. Default 2000. */
  maxIntervalMs?: number;
  /** Hard cap on queued events; the oldest are dropped beyond it. Default 1000. */
  maxQueue?: number;
}

export interface RedactOptions {
  /** Case-insensitive key names whose values are replaced anywhere in attributes. */
  keys?: readonly string[];
  /** Replacement text. Default `[REDACTED]`. */
  censor?: string;
}

export interface LoggerOptions {
  service?: string;
  environment?: string;
  release?: string;
  /** Events below this level are discarded. Default `info`. */
  minLevel?: LogLevel;
  /** One or more destinations. Defaults to a `ConsoleTransport`. */
  transports?: readonly Transport[];
  batch?: BatchOptions;
  redact?: RedactOptions;
  /** Bound onto every event, e.g. `{ region: "eu" }`. */
  bindings?: Attributes;
  /** Receives internal failures (transport errors, dropped events). Must not throw. */
  onError?: (error: unknown) => void;
  /** Install `beforeExit` / SIGTERM / SIGINT hooks that flush pending events. Default false. */
  flushOnExit?: boolean;
}
