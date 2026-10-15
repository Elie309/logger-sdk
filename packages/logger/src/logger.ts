import {
  LEVEL_SEVERITY,
  LIMITS,
  LOG_SOURCES,
  type LogEvent,
  type LogLevel,
  type LogSource,
  SCHEMA_VERSION,
} from "@elie309/contracts";
import { getRequestContext } from "./context.js";
import { createRedactor, type Redactor } from "./redact.js";
import { sanitizeAttributes, serializeError } from "./serialize.js";
import { ConsoleTransport } from "./transports/console.js";
import type { Attributes, LoggerOptions, Transport } from "./types.js";
import { uuidv7 } from "./uuid.js";

declare const __SDK_VERSION__: string | undefined;

/** Version is injected from package.json at build time (see tsup.config.ts). */
export const SDK_INFO = {
  name: "@elie309/logger",
  version: typeof __SDK_VERSION__ === "string" ? __SDK_VERSION__ : "0.0.0-dev",
} as const;

const TRACE_KEYS = ["requestId", "traceId", "spanId"] as const;

interface Core {
  readonly options: LoggerOptions;
  readonly transports: readonly Transport[];
  readonly redact: Redactor;
  readonly minSeverity: number;
  readonly maxSize: number;
  readonly maxQueue: number;
  readonly maxIntervalMs: number;
  queue: LogEvent[];
  timer: ReturnType<typeof setTimeout> | undefined;
  inFlight: Set<Promise<void>>;
  dropped: number;
  closed: boolean;
  removeExitHooks: (() => void) | undefined;
}

/** Internal: state shared between a logger and its children. */
interface Shared {
  core: Core;
  bindings: Attributes;
}

export class Logger {
  readonly #core: Core;
  readonly #bindings: Attributes;

  constructor(options: LoggerOptions = {}, shared?: Shared) {
    if (shared) {
      this.#core = shared.core;
      this.#bindings = shared.bindings;
      return;
    }
    const batch = options.batch ?? {};
    this.#core = {
      options,
      transports: options.transports?.length ? options.transports : [new ConsoleTransport()],
      redact: createRedactor(options.redact),
      minSeverity: LEVEL_SEVERITY[options.minLevel ?? "info"],
      maxSize: Math.max(1, batch.maxSize ?? 50),
      maxQueue: Math.max(1, batch.maxQueue ?? 1_000),
      maxIntervalMs: Math.max(1, batch.maxIntervalMs ?? 2_000),
      queue: [],
      timer: undefined,
      inFlight: new Set(),
      dropped: 0,
      closed: false,
      removeExitHooks: undefined,
    };
    this.#bindings = { ...options.bindings };
    if (options.flushOnExit) this.#core.removeExitHooks = installExitHooks(this);
  }

  /** Number of events discarded because the queue was full. */
  get droppedCount(): number {
    return this.#core.dropped;
  }

  debug(message: string, attributes?: Attributes): void {
    this.#log("debug", message, attributes);
  }

  info(message: string, attributes?: Attributes): void {
    this.#log("info", message, attributes);
  }

  warn(messageOrError: unknown, attributes?: Attributes): void {
    this.#log("warn", messageOrError, attributes);
  }

  error(messageOrError: unknown, attributes?: Attributes): void {
    this.#log("error", messageOrError, attributes);
  }

  fatal(messageOrError: unknown, attributes?: Attributes): void {
    this.#log("fatal", messageOrError, attributes);
  }

  /** New logger sharing this one's queue and transports, with extra bound attributes. */
  child(bindings: Attributes): Logger {
    return new Logger(this.#core.options, {
      core: this.#core,
      bindings: { ...this.#bindings, ...bindings },
    });
  }

  /** Send everything queued and wait for in-flight writes and transport buffers. */
  async flush(): Promise<void> {
    const core = this.#core;
    this.#drain();
    await Promise.allSettled([...core.inFlight]);
    await Promise.allSettled(
      core.transports.map(async (t) => {
        try {
          await t.flush?.();
        } catch (error) {
          this.#report(error);
        }
      }),
    );
  }

  /** Flush, close transports and stop accepting events. Safe to call more than once. */
  async shutdown(): Promise<void> {
    const core = this.#core;
    if (core.closed) return;
    await this.flush();
    core.closed = true;
    core.removeExitHooks?.();
    await Promise.allSettled(
      core.transports.map(async (t) => {
        try {
          await t.close?.();
        } catch (error) {
          this.#report(error);
        }
      }),
    );
  }

  #log(level: LogLevel, messageOrError: unknown, attributes: Attributes | undefined): void {
    const core = this.#core;
    if (core.closed || LEVEL_SEVERITY[level] < core.minSeverity) return;
    try {
      this.#enqueue(this.#build(level, messageOrError, attributes));
    } catch (error) {
      this.#report(error);
    }
  }

  #build(level: LogLevel, messageOrError: unknown, attributes: Attributes | undefined): LogEvent {
    const { options, redact } = this.#core;
    const ambient = getRequestContext() ?? {};
    const merged: Attributes = { ...ambient, ...this.#bindings, ...attributes };

    const event: LogEvent = {
      schemaVersion: SCHEMA_VERSION,
      id: uuidv7(),
      timestamp: new Date().toISOString(),
      level,
      message: "",
      sdk: SDK_INFO,
    };
    if (options.environment) event.environment = options.environment;
    if (options.service) event.service = options.service;
    if (options.release) event.release = options.release;

    for (const key of TRACE_KEYS) {
      const value = merged[key];
      if (typeof value === "string") event[key] = value;
      delete merged[key];
    }

    if (
      typeof merged.source === "string" &&
      (LOG_SOURCES as readonly string[]).includes(merged.source)
    ) {
      event.source = merged.source as LogSource;
      delete merged.source;
    }
    if (typeof merged.kind === "string") {
      event.kind = merged.kind.slice(0, 64);
      delete merged.kind;
    }

    if (messageOrError instanceof Error) {
      event.error = serializeError(messageOrError);
      event.message = messageOrError.message;
    } else if (typeof messageOrError === "string") {
      event.message = messageOrError;
    } else {
      event.error = serializeError(messageOrError);
      event.message = event.error.message ?? "Unknown error";
    }
    event.message = event.message.slice(0, LIMITS.maxMessageLength);

    if (merged.err instanceof Error || merged.error instanceof Error) {
      const cause = (merged.err ?? merged.error) as Error;
      event.error ??= serializeError(cause);
      delete merged.err;
      delete merged.error;
    }

    if (Object.keys(merged).length > 0) {
      event.attributes = redact(sanitizeAttributes(merged));
    }
    return event;
  }

  #enqueue(event: LogEvent): void {
    const core = this.#core;
    if (core.queue.length >= core.maxQueue) {
      core.queue.shift();
      core.dropped++;
    }
    core.queue.push(event);

    if (core.queue.length >= core.maxSize) {
      this.#drain();
    } else if (core.timer === undefined) {
      core.timer = setTimeout(() => this.#drain(), core.maxIntervalMs);
      core.timer.unref?.();
    }
  }

  #drain(): void {
    const core = this.#core;
    if (core.timer !== undefined) {
      clearTimeout(core.timer);
      core.timer = undefined;
    }
    while (core.queue.length > 0) {
      const batch = core.queue.splice(0, LIMITS.maxBatchSize);
      const task: Promise<void> = this.#send(batch).finally(() => core.inFlight.delete(task));
      core.inFlight.add(task);
    }
  }

  async #send(batch: readonly LogEvent[]): Promise<void> {
    const results = await Promise.allSettled(
      this.#core.transports.map((t) => Promise.resolve().then(() => t.write(batch))),
    );
    for (const result of results) {
      if (result.status === "rejected") this.#report(result.reason);
    }
  }

  #report(error: unknown): void {
    try {
      this.#core.options.onError?.(error);
    } catch {
      // onError must never break the host application.
    }
  }
}

function installExitHooks(logger: Logger): () => void {
  const flush = () => {
    void logger.flush();
  };
  const onSignal = (signal: NodeJS.Signals) => {
    void logger.shutdown().finally(() => {
      process.removeListener(signal, onSignal);
      process.kill(process.pid, signal);
    });
  };
  process.once("beforeExit", flush);
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
  return () => {
    process.removeListener("beforeExit", flush);
    process.removeListener("SIGTERM", onSignal);
    process.removeListener("SIGINT", onSignal);
  };
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return new Logger(options);
}
