# @elie309/transport-sqlite

Store `@elie309/logger` events in a local SQLite file using the built-in `node:sqlite` module (Node 22.5+, no native build step).

```ts
import { createLogger } from "@elie309/logger";
import { SqliteTransport } from "@elie309/transport-sqlite";

const logger = createLogger({ transports: [new SqliteTransport({ path: "./logs.db", retentionDays: 30 })] });
```
