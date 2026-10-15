import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError, createClient } from "../src/index.js";

const ev = (id: string) => ({
  schemaVersion: 1,
  id,
  timestamp: "2026-01-01T00:00:00.000Z",
  level: "info",
  message: id,
});

let server: Server | undefined;
afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
});

async function start(handler: Parameters<typeof createServer>[1]) {
  server = createServer(handler);
  await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
  return createClient({
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    token: "tok",
  });
}

describe("logs", () => {
  it("lists with query params and bearer auth", async () => {
    let seen = { url: "", auth: "" };
    const client = await start((req, res) => {
      seen = { url: req.url ?? "", auth: req.headers.authorization ?? "" };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ items: [ev("a")], nextCursor: null }));
    });
    const page = await client.logs.list("p 1", { minLevel: "error", limit: 5 });
    expect(page.items[0]?.id).toBe("a");
    expect(seen.url).toBe("/v1/projects/p%201/logs?minLevel=error&limit=5");
    expect(seen.auth).toBe("Bearer tok");
  });

  it("iterates across cursors", async () => {
    const client = await start((req, res) => {
      const cursor = new URL(req.url ?? "", "http://x").searchParams.get("cursor");
      res.end(
        JSON.stringify(
          cursor ? { items: [ev("b")], nextCursor: null } : { items: [ev("a")], nextCursor: "c1" },
        ),
      );
    });
    const ids: string[] = [];
    for await (const e of client.logs.iterate("p")) ids.push(e.id);
    expect(ids).toEqual(["a", "b"]);
  });

  it("throws ApiError with server code", async () => {
    const client = await start((_req, res) => {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: { code: "forbidden", message: "nope" } }));
    });
    await expect(client.logs.list("p")).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });

  it("throws a generic ApiError for non-JSON failures", async () => {
    const client = await start((_req, res) => {
      res.statusCode = 502;
      res.end("bad gateway");
    });
    const error = await client.logs.list("p").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("http_error");
  });
});

describe("stream", () => {
  it("parses SSE events split across chunks", async () => {
    const client = await start((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const payload = `id: 1\nevent: log\ndata: ${JSON.stringify(ev("s1"))}\n\n`;
      res.write(`: keepalive\n\n${payload.slice(0, 10)}`);
      setTimeout(() => {
        res.write(payload.slice(10));
        res.end();
      }, 10);
    });
    for await (const e of client.stream("p", { reconnect: false })) {
      expect(e.id).toBe("s1");
      return;
    }
    throw new Error("no events");
  });

  it("reconnects with Last-Event-ID", async () => {
    const seen: (string | undefined)[] = [];
    const client = await start((req, res) => {
      seen.push(req.headers["last-event-id"] as string | undefined);
      res.writeHead(200, { "content-type": "text/event-stream" });
      const n = seen.length;
      res.write(`id: ${n}\ndata: ${JSON.stringify(ev(`e${n}`))}\n\n`);
      res.end();
    });
    const ids: string[] = [];
    for await (const e of client.stream("p", { retryDelayMs: 5 })) {
      ids.push(e.id);
      if (ids.length === 2) break;
    }
    expect(ids).toEqual(["e1", "e2"]);
    expect(seen).toEqual([undefined, "1"]);
  });

  it("stops on abort and does not retry 401", async () => {
    const client = await start((_req, res) => {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: { code: "unauthorized", message: "no" } }));
    });
    await expect(client.stream("p").next()).rejects.toMatchObject({ status: 401 });

    const controller = new AbortController();
    controller.abort();
    const out = [];
    for await (const e of client.stream("p", { signal: controller.signal })) out.push(e);
    expect(out).toEqual([]);
  });
});
