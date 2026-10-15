# @elie309/client

Typed client for the log query and streaming API. Responses are validated against `@elie309/contracts`.

```ts
import { createClient } from "@elie309/client";

const client = createClient({ baseUrl: "https://logs.example.com", token: process.env.LOGS_READ_TOKEN! });

for await (const event of client.logs.iterate("my-project", { minLevel: "error" })) {
  console.log(event.message);
}
```

**Never embed a permanent read token in a browser bundle.** Call this client from a server and proxy to your dashboard.
