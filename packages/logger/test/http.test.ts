import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger, HttpError, HttpTransport } from "../src/index.js";

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
});

async function start(
  handler: (
    req: { auth?: string | undefined; body: string },
    n: number,
  ) => { status: number; headers?: Record<string, string> },
): Promise<{ url: string; bodies: string[] }> {
  const bodies: string[] = [];
  let n = 0;
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      bodies.push(body);
      const out = handler({ auth: req.headers.authorization, body }, ++n);
      res.writeHead(out.status, out.headers);
      res.end("{}");
    });
  });
  server = srv;
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1/ingest`, bodies };
}

const event = {
  schemaVersion: 1,
  id: "i",
  timestamp: "2026-01-01T00:00:00.000Z",
  level: "info",
  message: "m",
} as const;

describe("HttpTransport", () => {
  it("sends bearer auth and a batch body", async () => {
    const { url, bodies } = await start(() => ({ status: 200 }));
    await new HttpTransport({ endpoint: url, apiKey: "k" }).write([event]);
    expect(JSON.parse(bodies[0] ?? "{}")).toEqual({ events: [event] });
  });

  it("retries 503 then succeeds, sending the same event ids", async () => {
    const { url, bodies } = await start((_r, n) => ({ status: n === 1 ? 503 : 200 }));
    await new HttpTransport({ endpoint: url, apiKey: "k", baseDelayMs: 1 }).write([event]);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
  });

  it("honors Retry-After on 429", async () => {
    const { url, bodies } = await start((_r, n) =>
      n === 1 ? { status: 429, headers: { "retry-after": "0" } } : { status: 200 },
    );
    await new HttpTransport({ endpoint: url, apiKey: "k" }).write([event]);
    expect(bodies).toHaveLength(2);
  });

  it("does not retry 4xx", async () => {
    const { url, bodies } = await start(() => ({ status: 401 }));
    const t = new HttpTransport({ endpoint: url, apiKey: "bad", baseDelayMs: 1 });
    await expect(t.write([event])).rejects.toBeInstanceOf(HttpError);
    expect(bodies).toHaveLength(1);
  });

  it("gives up after maxAttempts", async () => {
    const { url, bodies } = await start(() => ({ status: 500 }));
    const t = new HttpTransport({ endpoint: url, apiKey: "k", maxAttempts: 2, baseDelayMs: 1 });
    await expect(t.write([event])).rejects.toBeInstanceOf(HttpError);
    expect(bodies).toHaveLength(2);
  });

  it("times out a hung server and the logger does not throw or hang", async () => {
    server = createServer(() => undefined);
    await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const errors: unknown[] = [];
    const log = createLogger({
      transports: [
        new HttpTransport({ endpoint: url, apiKey: "k", timeoutMs: 50, maxAttempts: 1 }),
      ],
      onError: (e) => errors.push(e),
    });
    log.info("x");
    await log.flush();
    expect(errors).toHaveLength(1);
    server.closeAllConnections();
  });

  it("survives a refused connection", async () => {
    const errors: unknown[] = [];
    const log = createLogger({
      transports: [
        new HttpTransport({ endpoint: "http://127.0.0.1:1/", apiKey: "k", maxAttempts: 1 }),
      ],
      onError: (e) => errors.push(e),
    });
    log.info("x");
    await log.flush();
    expect(errors).toHaveLength(1);
  });
});
