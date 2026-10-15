import type { LogEvent } from "@elie309/contracts";
import type { Transport } from "@elie309/logger";

/** The subset of `pg.Pool` / `pg.Client` this transport needs. */
export interface PgQueryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface PostgresTransportOptions {
  pool: PgQueryable;
  /** Optionally schema-qualified, e.g. `public.logs`. Default `logs`. */
  table?: string;
  /** Called from `close()` so the transport can end a pool it owns. Default: leave the pool open. */
  closePool?: () => Promise<void>;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;
const COLUMNS = 15;
const CHUNK = 500;

export class PostgresTransport implements Transport {
  readonly #pool: PgQueryable;
  readonly #table: string;
  readonly #closePool: (() => Promise<void>) | undefined;
  #closed = false;

  constructor(options: PostgresTransportOptions) {
    const table = options.table ?? "logs";
    if (!IDENTIFIER.test(table)) throw new Error(`Invalid table name: ${table}`);
    this.#pool = options.pool;
    this.#table = table;
    this.#closePool = options.closePool;
  }

  /** SQL that creates the table and indexes. Safe to run repeatedly. */
  migrationSql(): string {
    const t = this.#table;
    const index = t.replace(".", "_");
    return `
      CREATE TABLE IF NOT EXISTS ${t} (
        id          text PRIMARY KEY,
        seq         bigint GENERATED ALWAYS AS IDENTITY,
        timestamp   timestamptz NOT NULL,
        level       text NOT NULL,
        message     text NOT NULL,
        source      text, kind text,
        environment text, service text, release text,
        request_id  text, trace_id text, span_id text,
        error       jsonb, attributes jsonb, sdk jsonb
      );
      ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS source text;
      ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS kind text;
      CREATE INDEX IF NOT EXISTS ${index}_timestamp_idx ON ${t} (timestamp DESC);
      CREATE INDEX IF NOT EXISTS ${index}_level_idx ON ${t} (level, timestamp DESC);
    `;
  }

  async migrate(): Promise<void> {
    await this.#pool.query(this.migrationSql());
  }

  async write(events: readonly LogEvent[]): Promise<void> {
    if (this.#closed) throw new Error("PostgresTransport is closed");
    for (let i = 0; i < events.length; i += CHUNK) {
      const chunk = events.slice(i, i + CHUNK);
      const values: unknown[] = [];
      const rows = chunk.map((e, row) => {
        values.push(
          e.id,
          e.timestamp,
          e.level,
          e.message,
          e.source ?? null,
          e.kind ?? null,
          e.environment ?? null,
          e.service ?? null,
          e.release ?? null,
          e.requestId ?? null,
          e.traceId ?? null,
          e.spanId ?? null,
          e.error ? JSON.stringify(e.error) : null,
          e.attributes ? JSON.stringify(e.attributes) : null,
          e.sdk ? JSON.stringify(e.sdk) : null,
        );
        const base = row * COLUMNS;
        const params = Array.from({ length: COLUMNS }, (_, c) => `$${base + c + 1}`);
        // jsonb columns are the last three
        params[12] = `${params[12]}::jsonb`;
        params[13] = `${params[13]}::jsonb`;
        params[14] = `${params[14]}::jsonb`;
        return `(${params.join(", ")})`;
      });
      await this.#pool.query(
        `INSERT INTO ${this.#table}
          (id, timestamp, level, message, source, kind, environment, service, release, request_id, trace_id, span_id, error, attributes, sdk)
         VALUES ${rows.join(", ")}
         ON CONFLICT (id) DO NOTHING`,
        values,
      );
    }
  }

  /** Delete events older than `days`. Returns nothing; schedule it yourself (cron, startup). */
  async purgeOlderThan(days: number): Promise<void> {
    await this.#pool.query(
      `DELETE FROM ${this.#table} WHERE timestamp < now() - ($1::int * interval '1 day')`,
      [days],
    );
  }

  /** Read events oldest-first in insertion order. Mainly for tooling and tests. */
  async all(limit = 1_000): Promise<LogEvent[]> {
    const { rows } = await this.#pool.query(
      `SELECT * FROM ${this.#table} ORDER BY seq ASC LIMIT $1`,
      [limit],
    );
    return rows.map(rowToEvent);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#closePool?.();
  }
}

function rowToEvent(row: Record<string, unknown>): LogEvent {
  const ts = row.timestamp;
  const event = {
    schemaVersion: 1,
    id: row.id as string,
    timestamp: ts instanceof Date ? ts.toISOString() : String(ts),
    level: row.level as LogEvent["level"],
    message: row.message as string,
  } as LogEvent;
  if (row.source) event.source = row.source as NonNullable<LogEvent["source"]>;
  if (row.kind) event.kind = row.kind as string;
  if (row.environment) event.environment = row.environment as string;
  if (row.service) event.service = row.service as string;
  if (row.release) event.release = row.release as string;
  if (row.request_id) event.requestId = row.request_id as string;
  if (row.trace_id) event.traceId = row.trace_id as string;
  if (row.span_id) event.spanId = row.span_id as string;
  if (row.error) event.error = row.error as NonNullable<LogEvent["error"]>;
  if (row.attributes) event.attributes = row.attributes as Record<string, unknown>;
  if (row.sdk) event.sdk = row.sdk as NonNullable<LogEvent["sdk"]>;
  return event;
}
