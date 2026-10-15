# logger-sdk

[![CI](https://github.com/Elie309/logger-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/Elie309/logger-sdk/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A small, strictly-typed logging SDK for TypeScript projects. It never throws, never blocks your app, and sends structured events to the destination of your choice: HTTP, files, SQLite, PostgreSQL, or your own.

| Package | Purpose |
|---|---|
| [`@elie309/logger`](packages/logger) | The logger: levels, child loggers, batching, retries, redaction, console / HTTP / file transports |
| [`@elie309/contracts`](packages/contracts) | Zod schemas and types for log events and the API |
| [`@elie309/client`](packages/client) | Typed client to query and stream logs from a backend |
| [`@elie309/transport-sqlite`](packages/transport-sqlite) | Store logs in a local SQLite file (`node:sqlite`) |
| [`@elie309/transport-postgres`](packages/transport-postgres) | Store logs in PostgreSQL (bring your own `pg` pool) |

## Quick start

```bash
pnpm add @elie309/logger
```

```ts
import { createLogger, ConsoleTransport, HttpTransport } from "@elie309/logger";

const logger = createLogger({
  service: "billing-api",
  environment: process.env.NODE_ENV,
  release: process.env.GIT_SHA,
  transports: [
    new ConsoleTransport({ format: "pretty" }),
    new HttpTransport({ endpoint: "https://logs.example.com/v1/ingest", apiKey: process.env.LOG_KEY! }),
  ],
  flushOnExit: true,
});

logger.info("invoice created", { invoiceId: "inv_1", password: "hidden" }); // password -> [REDACTED]
logger.error(new Error("payment failed", { cause: new Error("card declined") }));

const requestLogger = logger.child({ requestId: "req_42" });
await logger.shutdown(); // flush and close transports
```

### Request context

```ts
import { withRequestContext } from "@elie309/logger";

app.use((req, _res, next) => withRequestContext({ requestId: req.id }, next));
// every logger call inside the request now carries requestId automatically
```

## Where logs can go

| Transport | Import | Notes |
|---|---|---|
| Console | `@elie309/logger` | JSON lines or pretty output |
| HTTP | `@elie309/logger` | Batched POST, timeout, retries with backoff + `Retry-After`, bearer auth |
| File | `@elie309/logger/file` | NDJSON, size and daily rotation, pruning. Works with jq, Loki, Vector, Fluent Bit |
| SQLite | `@elie309/transport-sqlite` | Node 22.5+, no native build |
| PostgreSQL | `@elie309/transport-postgres` | JSONB columns, idempotent inserts, migration helper |
| Custom | implement `Transport` | `write(events)`, optional `flush()` / `close()` |

## Delivery semantics

- **At-least-once.** Every event gets a client-side UUIDv7 `id`; retries resend the same ids, so stores can deduplicate (the SQLite and PostgreSQL transports do).
- **Bounded memory.** The queue holds at most `batch.maxQueue` events (default 1000); beyond that the oldest are dropped and counted in `logger.droppedCount`.
- **Failures never reach your app.** Transport errors go to the optional `onError` hook.
- **Not durable across crashes.** Events still in memory when the process is killed are lost. Call `flush()`/`shutdown()` on exit (`flushOnExit: true` does this for SIGTERM/SIGINT/beforeExit).

## Security

- Keys such as `password`, `token`, `authorization`, `cookie`, `apiKey` are redacted at any depth; add more with `redact.keys`.
- Never put read/management tokens in browser bundles. See [SECURITY.md](SECURITY.md).

## Development

```bash
pnpm install
pnpm build        # build all packages
pnpm check        # Biome format + lint
pnpm typecheck
pnpm test         # set TEST_POSTGRES_URL to include the PostgreSQL tests
```

See [CONTRIBUTING.md](CONTRIBUTING.md). The original platform architecture draft is kept in [docs/architecture.md](docs/architecture.md).

## License

[MIT](LICENSE)
