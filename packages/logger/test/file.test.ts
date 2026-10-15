import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTransportConformance } from "@elie309/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileTransport } from "../src/file.js";
import { createLogger } from "../src/index.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "logger-file-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("FileTransport", () => {
  it("writes NDJSON that parses line by line", async () => {
    const path = join(dir, "nested", "app.log");
    const log = createLogger({ transports: [new FileTransport({ path })] });
    log.info("one", { a: 1 });
    log.info("two");
    await log.shutdown();
    const lines = (await readFile(path, "utf8")).trim().split("\n");
    expect(lines.map((l) => JSON.parse(l).message)).toEqual(["one", "two"]);
  });

  it("rotates by size and prunes to maxFiles", async () => {
    const path = join(dir, "app.log");
    const t = new FileTransport({ path, maxBytes: 300, maxFiles: 2 });
    const log = createLogger({ transports: [t], batch: { maxSize: 1 } });
    for (let i = 0; i < 12; i++) {
      log.info(`message number ${i}`, { pad: "x".repeat(50) });
      await log.flush();
      await new Promise((r) => setTimeout(r, 2));
    }
    await log.shutdown();
    const files = await readdir(dir);
    expect(files).toContain("app.log");
    expect(files.filter((f) => f.startsWith("app.log.")).length).toBeLessThanOrEqual(2);
    expect(files.length).toBeGreaterThan(1);
  });

  it("appends to an existing file across instances", async () => {
    const path = join(dir, "app.log");
    for (const msg of ["a", "b"]) {
      const log = createLogger({ transports: [new FileTransport({ path })] });
      log.info(msg);
      await log.shutdown();
    }
    expect((await readFile(path, "utf8")).trim().split("\n")).toHaveLength(2);
  });
});

runTransportConformance(
  "FileTransport",
  async () => {
    const d = await mkdtemp(join(tmpdir(), "logger-conf-"));
    const path = join(d, "app.log");
    const transport = new FileTransport({ path });
    return {
      transport,
      readAll: async () =>
        (await readFile(path, "utf8"))
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l)),
      cleanup: async () => {
        await transport.close();
        await rm(d, { recursive: true, force: true });
      },
    };
  },
  { dedupesIds: false },
);
