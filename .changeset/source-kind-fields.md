---
"@elie309/contracts": minor
"@elie309/logger": minor
"@elie309/client": minor
"@elie309/transport-sqlite": minor
"@elie309/transport-postgres": minor
---

Add optional first-class `source` (`ui` | `action` | `api` | `server`) and `kind` fields to log events, query filters and storage transports (existing SQLite/Postgres tables are upgraded in place). The logger promotes `attributes.source` / `attributes.kind` to top-level fields and now reports its real package version in `sdk.version`.
