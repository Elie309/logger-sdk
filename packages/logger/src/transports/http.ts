import type { IngestRequest, LogEvent } from "@elie309/contracts";
import type { Transport } from "../types.js";

export interface HttpTransportOptions {
  /** Full ingest URL, e.g. `https://logs.example.com/v1/ingest`. */
  endpoint: string;
  apiKey: string;
  /** Per-attempt timeout. Default 5000. */
  timeoutMs?: number;
  /** Total attempts including the first. Default 3. */
  maxAttempts?: number;
  /** Base for exponential backoff. Default 250. */
  baseDelayMs?: number;
  /** Cap on a single backoff or Retry-After wait. Default 10000. */
  maxDelayMs?: number;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/** POSTs batches as JSON with timeout, bounded retries, backoff + jitter and Retry-After support. */
export class HttpTransport implements Transport {
  readonly #opts: Required<Omit<HttpTransportOptions, "headers" | "fetch">> &
    Pick<HttpTransportOptions, "headers" | "fetch">;

  constructor(options: HttpTransportOptions) {
    this.#opts = {
      timeoutMs: 5_000,
      maxAttempts: 3,
      baseDelayMs: 250,
      maxDelayMs: 10_000,
      ...options,
    };
  }

  async write(events: readonly LogEvent[]): Promise<void> {
    const body = JSON.stringify({ events: [...events] } satisfies IngestRequest);
    const doFetch = this.#opts.fetch ?? globalThis.fetch;
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.#opts.maxAttempts; attempt++) {
      let wait: number | undefined;
      try {
        const response = await doFetch(this.#opts.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.#opts.apiKey}`,
            ...this.#opts.headers,
          },
          body,
          signal: AbortSignal.timeout(this.#opts.timeoutMs),
        });
        if (response.ok) {
          await response.body?.cancel().catch(() => undefined);
          return;
        }
        await response.body?.cancel().catch(() => undefined);
        lastError = new HttpError(response.status, `Ingest failed with HTTP ${response.status}`);
        if (!retryable(response.status)) throw lastError;
        wait = parseRetryAfter(response.headers.get("retry-after"));
      } catch (error) {
        if (error instanceof HttpError && !retryable(error.status)) throw error;
        lastError = error;
      }
      if (attempt < this.#opts.maxAttempts) {
        const backoff = this.#opts.baseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random() / 2);
        await sleep(Math.min(wait ?? backoff, this.#opts.maxDelayMs));
      }
    }
    throw lastError;
  }
}
