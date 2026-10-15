import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { LogEvent, SerializedError } from "@elie309/contracts";
import type { Transport } from "@elie309/logger";

export interface SqliteTransportOptions {
  /** Database file path, or `:memory:`. */
  path: string;
  /** Table name. Letters, digits and underscores only. Default `logs`. */
  table?: string;
  /** Delete rows older than this many days on startup and and at most hourly afterwards. */
  retentionDays?: number;
}

// Loaded lazily via getBuiltinModule: bundlers strip the `node:` prefix from `node:sqlite`,
// which then fails to resolve at runtime.
function loadSqlite(): typeof import("node:sqlite") {
  const mod = process.getBuiltinModule("node:sqlite");
  if (!mod) throw new Error("node:sqlite is unavailable; Node.js 22.5 or newer is required");
  return mod;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Stores events in SQLite. Inserts are idempotent on `id` and run in a single transaction. */
export class SqliteTransport implements Transport {
  readonly #db: DatabaseSync;
  readonly #table: string;
  readonly #insert: StatementSync;
  readonly #retentionDays: number | undefined;
  #lastPrune = 0;
  #closed = false;

  constructor(options: SqliteTransportOptions) {
    const table = options.table ?? "logs";
    if (!IDENTIFIER.test(table)) throw new Error(`Invalid table name: ${table}`);
    this.#table = table;
    this.#retentionDays = options.retentionDays;
    this.#db = new (loadSqlite().DatabaseSync)(options.path);
    if (options.path !== ":memory:") this.#db.exec("PRAGMA journal_mode = WAL");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        environment TEXT, service TEXT, release TEXT,
        request_id TEXT, trace_id TEXT, span_id TEXT,
        error TEXT, attributes TEXT, sdk TEXT
      );
      CREATE INDEX IF NOT EXISTS ${table}_timestamp_idx ON ${table} (timestamp);
      CREATE INDEX IF NOT EXISTS ${table}_level_idx ON ${table} (level, timestamp);
    `);
    this.#insert = this.#db.prepare(
      `INSERT OR IGNORE INTO ${table}
        (id, timestamp, level, message, environment, service, release, request_id, trace_id, span_id, error, attributes, sdk)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.#prune();
  }

  async write(events: readonly LogEvent[]): Promise<void> {
    if (this.#closed) throw new Error("SqliteTransport is closed");
    this.#db.exec("BEGIN");
    try {
      for (const e of events) {
        this.#insert.run(
          e.id,
          e.timestamp,
          e.level,
          e.message,
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
      }
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    if (Date.now() - this.#lastPrune > 3_600_000) this.#prune();
  }

  /** Read events oldest-first in insertion order. Mainly for tooling and tests. */
  all(limit = 1_000): LogEvent[] {
    const rows = this.#db
      .prepare(`SELECT * FROM ${this.#table} ORDER BY rowid ASC LIMIT ?`)
      .all(limit) as Record<string, string | null>[];
    return rows.map(rowToEvent);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#db.close();
  }

  #prune(): void {
    this.#lastPrune = Date.now();
    if (this.#retentionDays === undefined) return;
    const cutoff = new Date(Date.now() - this.#retentionDays * 86_400_000).toISOString();
    this.#db.prepare(`DELETE FROM ${this.#table} WHERE timestamp < ?`).run(cutoff);
  }
}

function rowToEvent(row: Record<string, string | null>): LogEvent {
  const event = {
    schemaVersion: 1,
    id: row.id as string,
    timestamp: row.timestamp as string,
    level: row.level as LogEvent["level"],
    message: row.message as string,
  } as LogEvent;
  if (row.environment) event.environment = row.environment;
  if (row.service) event.service = row.service;
  if (row.release) event.release = row.release;
  if (row.request_id) event.requestId = row.request_id;
  if (row.trace_id) event.traceId = row.trace_id;
  if (row.span_id) event.spanId = row.span_id;
  if (row.error) event.error = JSON.parse(row.error) as SerializedError;
  if (row.attributes) event.attributes = JSON.parse(row.attributes) as Record<string, unknown>;
  if (row.sdk) event.sdk = JSON.parse(row.sdk) as { name: string; version: string };
  return event;
}
