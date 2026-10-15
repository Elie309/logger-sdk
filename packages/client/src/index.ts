import {
  ApiErrorBodySchema,
  type LogEvent,
  LogEventSchema,
  type LogPage,
  LogPageSchema,
  type LogQuery,
} from "@elie309/contracts";

export interface ClientOptions {
  /** Base URL of the API, without a trailing path. */
  baseUrl: string;
  /** Read/management token. Keep it server-side. */
  token: string;
  fetch?: typeof fetch;
  /** Per-request timeout for non-streaming calls. Default 15000. */
  timeoutMs?: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface StreamOptions {
  signal?: AbortSignal;
  /** Resume after this event id (sent as `Last-Event-ID`). */
  lastEventId?: string;
  /** Reconnect automatically after network failures. Default true. */
  reconnect?: boolean;
  /** Base reconnect delay in ms; doubles up to 30s. Default 500. */
  retryDelayMs?: number;
}

export interface Client {
  logs: {
    list(projectId: string, query?: LogQuery): Promise<LogPage>;
    /** Iterate every matching event, following cursors page by page. */
    iterate(projectId: string, query?: Omit<LogQuery, "cursor">): AsyncGenerator<LogEvent>;
  };
  /** Live events via Server-Sent Events. */
  stream(projectId: string, options?: StreamOptions): AsyncGenerator<LogEvent>;
}

function buildQuery(query: LogQuery | undefined): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

export function createClient(options: ClientOptions): Client {
  const base = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? globalThis.fetch;
  const headers = { authorization: `Bearer ${options.token}`, accept: "application/json" };

  async function failure(response: Response): Promise<ApiError> {
    const body: unknown = await response.json().catch(() => undefined);
    const parsed = ApiErrorBodySchema.safeParse(body);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      return new ApiError(response.status, code, message, details);
    }
    return new ApiError(
      response.status,
      "http_error",
      `Request failed with HTTP ${response.status}`,
    );
  }

  async function list(projectId: string, query?: LogQuery): Promise<LogPage> {
    const url = `${base}/v1/projects/${encodeURIComponent(projectId)}/logs${buildQuery(query)}`;
    const response = await doFetch(url, {
      headers,
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
    if (!response.ok) throw await failure(response);
    return LogPageSchema.parse(await response.json());
  }

  async function* iterate(projectId: string, query?: Omit<LogQuery, "cursor">) {
    let cursor: string | undefined;
    do {
      const page = await list(projectId, cursor ? { ...query, cursor } : query);
      yield* page.items;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  async function* stream(projectId: string, opts: StreamOptions = {}): AsyncGenerator<LogEvent> {
    const url = `${base}/v1/projects/${encodeURIComponent(projectId)}/stream`;
    let lastEventId = opts.lastEventId;
    let delay = opts.retryDelayMs ?? 500;
    const reconnect = opts.reconnect ?? true;

    while (!opts.signal?.aborted) {
      try {
        const response = await doFetch(url, {
          headers: {
            ...headers,
            accept: "text/event-stream",
            ...(lastEventId ? { "last-event-id": lastEventId } : {}),
          },
          ...(opts.signal ? { signal: opts.signal } : {}),
        });
        if (!response.ok) throw await failure(response);
        if (!response.body) throw new Error("Stream response has no body");
        delay = opts.retryDelayMs ?? 500;
        for await (const message of parseSse(response.body)) {
          if (message.id) lastEventId = message.id;
          if (message.event === "log" || message.event === undefined) {
            yield LogEventSchema.parse(JSON.parse(message.data));
          }
        }
      } catch (error) {
        if (opts.signal?.aborted) return;
        const fatal = error instanceof ApiError && error.status < 500 && error.status !== 429;
        if (fatal || !reconnect) throw error;
      }
      if (!reconnect) return;
      await sleep(delay, opts.signal);
      delay = Math.min(delay * 2, 30_000);
    }
  }

  return { logs: { list, iterate }, stream };
}

interface SseMessage {
  id?: string;
  event?: string;
  data: string;
}

/** Minimal SSE parser: handles chunk boundaries, multi-line data, comments, CRLF. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let current: { id?: string; event?: string; data: string[] } = { data: [] };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let newline = buffer.search(/\r\n|\n|\r/);
      while (newline !== -1) {
        const match = /^(\r\n|\n|\r)/.exec(buffer.slice(newline));
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + (match?.[0].length ?? 1));
        if (line === "") {
          if (current.data.length > 0) {
            const message: SseMessage = { data: current.data.join("\n") };
            if (current.id !== undefined) message.id = current.id;
            if (current.event !== undefined) message.event = current.event;
            yield message;
          }
          current = { data: [] };
        } else if (!line.startsWith(":")) {
          const colon = line.indexOf(":");
          const field = colon === -1 ? line : line.slice(0, colon);
          let val = colon === -1 ? "" : line.slice(colon + 1);
          if (val.startsWith(" ")) val = val.slice(1);
          if (field === "data") current.data.push(val);
          else if (field === "id") current.id = val;
          else if (field === "event") current.event = val;
        }
        newline = buffer.search(/\r\n|\n|\r/);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
