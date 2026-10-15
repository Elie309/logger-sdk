# @elie309/contracts

## 0.2.0

### Minor Changes

- 428cb95: Add optional first-class `source` (`ui` | `action` | `api` | `server`) and `kind` fields to log events, query filters and storage transports (existing SQLite/Postgres tables are upgraded in place). The logger promotes `attributes.source` / `attributes.kind` to top-level fields and now reports its real package version in `sdk.version`.

## 0.1.0

### Minor Changes

- 0f9de7d: Initial release: event contracts, logger with batching/retries/redaction, console/HTTP/file transports, SQLite and PostgreSQL transports, and a query/stream client.
