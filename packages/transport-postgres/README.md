# @elie309/transport-postgres

Store `@elie309/logger` events in PostgreSQL. You supply the `pg` `Pool`; this package has no runtime dependency on `pg`.

```ts
import { Pool } from "pg";
import { createLogger } from "@elie309/logger";
import { PostgresTransport } from "@elie309/transport-postgres";

const transport = new PostgresTransport({ pool: new Pool({ connectionString: process.env.DATABASE_URL }) });
await transport.migrate(); // creates the table and indexes if missing
const logger = createLogger({ transports: [transport] });
```

Inserts use `ON CONFLICT (id) DO NOTHING`, so retried batches never create duplicates.
