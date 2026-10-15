import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTransportConformance } from "@elie309/test-utils";
import { expect, it } from "vitest";
import { SqliteTransport } from "../src/index.js";

runTransportConformance(
  "SqliteTransport",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "sqlite-"));
    const transport = new SqliteTransport({ path: join(dir, "logs.db") });
    return {
      transport,
      readAll: async () => transport.all(),
      cleanup: async () => {
        await transport.close();
        await rm(dir, { recursive: true, force: true });
      },
    };
  },
  { dedupesIds: true },
);

it("rejects unsafe table names", () => {
  expect(() => new SqliteTransport({ path: ":memory:", table: "logs; DROP TABLE x" })).toThrow();
});

it("prunes rows older than retentionDays on startup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sqlite-"));
  const path = join(dir, "logs.db");
  const old = new SqliteTransport({ path });
  await old.write([
    {
      schemaVersion: 1,
      id: "old",
      timestamp: "2000-01-01T00:00:00.000Z",
      level: "info",
      message: "old",
    },
  ]);
  await old.close();
  const fresh = new SqliteTransport({ path, retentionDays: 1 });
  expect(fresh.all()).toHaveLength(0);
  await fresh.close();
  await rm(dir, { recursive: true, force: true });
});

it("rejects writes after close", async () => {
  const t = new SqliteTransport({ path: ":memory:" });
  await t.close();
  await expect(t.write([])).rejects.toThrow("closed");
});
