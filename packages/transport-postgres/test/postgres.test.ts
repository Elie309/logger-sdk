import { randomUUID } from "node:crypto";
import { runTransportConformance } from "@elie309/test-utils";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { PostgresTransport } from "../src/index.js";

const url = process.env.TEST_POSTGRES_URL;

// Always runs: pure SQL-generation checks need no database.
describe("PostgresTransport (no database)", () => {
  const pool = { query: async () => ({ rows: [] }) };
  it("rejects unsafe table names", () => {
    expect(() => new PostgresTransport({ pool, table: "x; DROP TABLE y" })).toThrow();
  });
  it("generates idempotent inserts with numbered params", async () => {
    const calls: { text: string; values?: unknown[] }[] = [];
    const t = new PostgresTransport({
      pool: {
        query: async (text, values) => {
          calls.push(values ? { text, values } : { text });
          return { rows: [] };
        },
      },
    });
    const e = {
      schemaVersion: 1,
      id: "a",
      timestamp: "2026-01-01T00:00:00.000Z",
      level: "info",
      message: "m",
    } as const;
    await t.write([e, { ...e, id: "b" }]);
    expect(calls[0]?.text).toContain("ON CONFLICT (id) DO NOTHING");
    expect(calls[0]?.text).toContain("$14");
    expect(calls[0]?.values).toHaveLength(26);
  });
  it("rejects writes after close", async () => {
    const t = new PostgresTransport({ pool });
    await t.close();
    await expect(t.write([])).rejects.toThrow("closed");
  });
});

// Runs against a real database when TEST_POSTGRES_URL is set (always in CI on ubuntu).
describe.skipIf(!url)("PostgresTransport (real database)", () => {
  runTransportConformance(
    "PostgresTransport",
    async () => {
      const pool = new pg.Pool({ connectionString: url });
      const table = `logs_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const transport = new PostgresTransport({ pool, table });
      await transport.migrate();
      return {
        transport,
        readAll: () => transport.all(),
        cleanup: async () => {
          await pool.query(`DROP TABLE IF EXISTS ${table}`);
          await pool.end();
        },
      };
    },
    { dedupesIds: true },
  );
});
