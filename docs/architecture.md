# Open-Source Observability Platform
## Architecture Proposal — First Draft

**Status:** Initial proposal  
**Purpose:** Define a starting architecture for an open-source logging and error-tracking service.  
**Flexibility:** All technologies, package boundaries, endpoints, schemas, and features described below are suggestions, not requirements.

---

## 1. Project Overview

The goal is to build a lightweight, self-hostable observability backend that applications can use to collect logs, track errors, stream events in real time, and send notifications when configured conditions are met.

The platform should be useful independently of any particular dashboard or frontend.

Potential use cases include:

- Centralized application logging.
- Error and exception tracking.
- Searching and filtering historical logs.
- Monitoring events in real time.
- Email notifications for important errors or configured conditions.
- Future integrations with frameworks, hosting platforms, and observability standards.

The initial implementation should focus on a reliable core rather than trying to reproduce every feature offered by established observability platforms.

### Design principles

- **Open source:** Make self-hosting and community contributions possible.
- **Dashboard-independent:** The core backend should not depend on a particular frontend.
- **Simple to adopt:** Applications should be able to integrate using a small SDK.
- **Modular:** Keep ingestion, querying, background processing, and integrations logically separated.
- **Type-safe:** Prefer shared contracts and validation across TypeScript packages.
- **Incremental:** Start with the smallest useful feature set and expand based on actual needs.
- **Self-hostable:** Provide a straightforward local development and deployment experience.
- **Secure by default:** Apply project-level authorization, credential separation, and sensible data-handling limits.

---

## 2. High-Level Architecture

The following is a proposed logical architecture, not a mandatory deployment topology.

```text
┌──────────────────────────────┐
│       Applications           │
│                              │
│  Next.js / Node.js / Others  │
└──────────────┬───────────────┘
               │
               │ Logging SDK
               ▼
┌──────────────────────────────┐
│       Ingestion API          │
│                              │
│ Authentication               │
│ Validation and limits        │
│ Event persistence            │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│          Database            │
│                              │
│ Projects / Events / Errors   │
│ Alert rules / Other metadata │
└──────────────┬───────────────┘
               │
               ├─────────────────────┐
               │                     │
               ▼                     ▼
┌────────────────────────┐  ┌──────────────────────┐
│ Query and Streaming API│  │ Background Processing│
│                        │  │                      │
│ Search / Filters       │  │ Error grouping       │
│ Pagination             │  │ Alert evaluation     │
│ Real-time event stream │  │ Email notifications  │
└────────────┬───────────┘  └──────────────────────┘
             │
             ▼
┌──────────────────────────────┐
│ External Dashboards / Tools  │
│                              │
│ Personal dashboard           │
│ Community dashboards         │
│ Scripts and internal tools   │
└──────────────────────────────┘
```

Background processing could use a dedicated worker, a queue, scheduled jobs, or a simpler mechanism in the initial version. The final choice should depend on reliability and workload requirements.

---

## 3. Repository Strategy

A TypeScript monorepo is a reasonable starting point because several components will share event definitions, validation schemas, and API contracts.

A package manager with workspace support, such as pnpm, could manage the repository.

The exact repository structure should remain flexible.

### Possible structure

```text
observability/
├── apps/
│   ├── api/
│   └── worker/
├── packages/
│   ├── logger/
│   ├── client/
│   ├── contracts/
│   ├── database/
│   ├── email/
│   └── config/
├── integrations/
│   ├── nextjs/
│   └── opentelemetry/
├── tests/
├── scripts/
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env.example
├── LICENSE
└── README.md
```

This is an example rather than a required directory layout. Some packages could be combined initially and separated later when there is a clear benefit.

### Suggested responsibilities

| Component | Responsibility |
|---|---|
| `apps/api` | Accept events, authenticate requests, expose query and management endpoints. |
| `apps/worker` | Process asynchronous jobs, evaluate alerts, send notifications, perform cleanup. |
| `packages/logger` | SDK installed by applications to create and transmit structured events. |
| `packages/client` | TypeScript client for querying data and managing resources through the API. |
| `packages/contracts` | Shared event types, validation schemas, and API contracts. |
| `packages/database` | Database schema, access layer, and migrations. |
| `packages/email` | Optional abstraction for sending email notifications. |
| `packages/config` | Shared configuration and tooling conventions. |
| `integrations/` | Optional adapters for specific frameworks and observability systems. |

These boundaries can be adjusted as the project develops.

---

## 4. Logging SDK

The logging SDK would be installed in applications that want to send events to the service.

For example, a server-side application might initialize a logger with a project credential and send structured events when something happens.

### Potential capabilities

- Log levels such as `debug`, `info`, `warn`, `error`, and `fatal`.
- Structured messages and custom attributes.
- Exception serialization, including stack traces when available.
- Environment metadata, such as development, staging, and production.
- Service and release identifiers.
- Optional request and trace identifiers.
- Batching to reduce network overhead.
- Bounded retries and request timeouts.
- A flush method for pending events.
- Graceful shutdown support.
- Configurable redaction of sensitive fields.

The initial SDK could target Node.js and server-side JavaScript or TypeScript applications. Browser support should be evaluated separately because credentials, privacy, and event volume introduce additional considerations.

### Example event

A possible event structure:

```ts
type LogLevel =
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "fatal";

interface LogEvent {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;

  environment?: string;
  service?: string;
  release?: string;

  requestId?: string;
  traceId?: string;
  spanId?: string;

  error?: {
    name?: string;
    message?: string;
    stack?: string;
  };

  attributes?: Record<string, unknown>;
}
```

This schema is illustrative. The final schema should be informed by the query requirements, storage design, security concerns, and potential OpenTelemetry compatibility.

The server should establish or validate the project's identity from the ingestion credential rather than trusting an arbitrary `projectId` supplied by the application.

### SDK responsibilities

The SDK should focus on collecting, normalizing, and transmitting events. It should not need direct database access or depend on a dashboard implementation.

The SDK should also avoid allowing an application outage to become worse because logging is unavailable. Network operations should have sensible timeouts, and buffering should be bounded.

---

## 5. API Service

The API is the central interface between applications, SDKs, dashboards, and administrative tools.

Its responsibilities could include:

- Receiving and validating events.
- Authenticating ingestion and read requests.
- Enforcing project access restrictions.
- Persisting accepted events.
- Querying logs and errors.
- Managing projects and credentials.
- Managing alert configurations.
- Providing real-time event streams.
- Applying request limits and payload-size limits.

### Potential endpoint layout

The following endpoints illustrate a possible REST-style API. Their names, methods, and response formats are not fixed.

| Purpose | Example endpoint |
|---|---|
| Submit events | `POST /v1/ingest` |
| List projects | `GET /v1/projects` |
| Create a project | `POST /v1/projects` |
| Query logs | `GET /v1/projects/:projectId/logs` |
| Query grouped errors | `GET /v1/projects/:projectId/errors` |
| Subscribe to events | `GET /v1/projects/:projectId/stream` |
| List alert rules | `GET /v1/projects/:projectId/alerts` |
| Create an alert rule | `POST /v1/projects/:projectId/alerts` |
| Update an alert rule | `PATCH /v1/projects/:projectId/alerts/:alertId` |
| Delete an alert rule | `DELETE /v1/projects/:projectId/alerts/:alertId` |

The API may use versioned routes, but the exact versioning policy can be decided before the first public release.

### Ingestion behavior

A possible ingestion flow is:

1. Receive an event or batch of events.
2. Authenticate the ingestion credential.
3. Determine the associated project.
4. Validate the event structure and payload limits.
5. Apply rate limits and any necessary redaction.
6. Persist the accepted events.
7. Return an acknowledgement.

The API should not report an event as successfully stored before the selected persistence guarantee has been met.

### Framework choice

A lightweight framework such as Hono or a more structured framework such as NestJS could work. The choice should be based on the desired developer experience, validation patterns, testing strategy, and operational needs—not on this document.

---

## 6. Database and Data Model

A relational database such as PostgreSQL is a reasonable initial option. Prisma could provide TypeScript-friendly database access and migrations.

Neither choice is mandatory. The data volume, query patterns, hosting environment, and maintenance burden should guide the final decision.

### Potential entities

**Projects**

Represent applications or services that send data to the platform.

Possible fields include an ID, name, creation timestamp, and configuration metadata.

**Credentials**

Represent access credentials and their scopes. Credentials may be associated with a project or an account, depending on the eventual access-control model.

**Log events**

Store normalized events, including timestamp, severity, message, environment, service, error details, and custom attributes.

**Error groups**

Represent recurring errors grouped using a stable fingerprint. A group might contain its first-seen time, last-seen time, occurrence count, and relevant metadata.

**Alert rules**

Store the conditions under which notifications should be generated.

**Notification records**

Optionally track notification attempts, delivery status, and errors.

### Data retention

Retention should be configurable or at least documented. A cleanup process may eventually remove expired events and related records.

The initial design should consider indexes for project ID, timestamp, severity, and fields commonly used in filters. Indexes should be driven by real query patterns because excessive indexing increases storage and write costs.

A separate analytics database or search engine is not necessary by default. Such components could be introduced if PostgreSQL no longer meets measured performance requirements.

---

## 7. Read and Management Client

A separate TypeScript client package could make it easier for dashboards and scripts to communicate with the API.

Potential operations include:

- Querying and filtering logs.
- Retrieving error groups and occurrence details.
- Listing projects.
- Managing alert configurations.
- Subscribing to real-time events.
- Handling pagination and API errors consistently.

The client should wrap the public API rather than access the database directly.

### Dashboard independence

The core platform should not require a built-in dashboard.

For example, a personal dashboard could live in a separate repository, use its own frontend framework and deployment configuration, and communicate with the service through the API. A different developer could build an entirely separate dashboard without modifying the core repository.

This separation also allows the API and data model to evolve independently from individual user interfaces, provided the public API remains compatible.

### Browser security

Permanent read or management credentials should not be embedded in browser bundles. A dashboard can keep sensitive credentials in its server-side environment and proxy requests through its backend.

If direct browser-to-service access becomes useful, short-lived, narrowly scoped tokens could be considered later. Real-time browser subscriptions should use an appropriate authentication mechanism rather than exposing a permanent secret.

---

## 8. Real-Time Event Streaming

Real-time streaming would allow dashboards to display new logs without repeatedly polling the API.

Server-Sent Events (SSE) could be a simple initial option because the main requirement is likely a one-way stream from server to client.

WebSockets could be evaluated if future features require bidirectional communication or other capabilities that SSE cannot conveniently provide.

### Potential stream behavior

- Subscribe to events for an authorized project.
- Receive new events as they are accepted or processed.
- Filter events where practical.
- Reconnect after temporary network failures.
- Apply limits on concurrent connections and resource consumption.

The exact delivery guarantees need to be defined. A real-time stream should not automatically be treated as a durable event queue. Clients that need complete historical data should be able to query persisted events separately.

---

## 9. Error Grouping

Error tracking could begin with a simple grouping strategy.

For example, similar exceptions could be grouped using a fingerprint based on error type, normalized message, and relevant stack information.

Each group could track:

- First occurrence.
- Most recent occurrence.
- Total occurrences.
- A representative stack trace.
- Environment and service metadata.
- Recent example events.

Grouping needs careful design to avoid combining unrelated errors or creating a separate group for every occurrence.

It does not necessarily need to be part of the first ingestion implementation. The initial version could store individual error events and add grouping after the basic pipeline works reliably.

---

## 10. Alerts and Notifications

The platform could eventually notify users when important events or patterns occur.

Possible conditions include:

- A new error group appears.
- An error reaches a configured occurrence threshold.
- A particular severity is recorded.
- An event matches a configured filter.

Email is a possible first notification channel.

### Potential processing flow

1. An event is persisted.
2. A background process evaluates relevant alert rules.
3. A matching rule produces a notification job.
4. The notification is sent through the configured email provider.
5. The system records the outcome and retries eligible failures according to a defined policy.

This flow is a proposal. The initial implementation could use a simpler approach if the expected workload is small.

### Background job options

A worker process and a job queue can improve isolation and reliability, but they introduce operational complexity.

Possible options include:

- Simple scheduled or asynchronous processing.
- A dedicated worker that reads pending database jobs.
- A queue backed by an external service or Redis.

The project should not add Redis or another dependency solely because it is common in similar systems. Choose a mechanism based on required delivery guarantees, retry behavior, throughput, and ease of self-hosting.

---

## 11. Security and Access Control

Security should be considered part of the initial design, even if the first release supports only a small number of users.

### Credential separation

It may be useful to distinguish at least three permission categories:

**Ingestion credentials**

Allow applications to submit events to an authorized project. They should not grant permission to read historical logs or manage project settings.

**Read credentials**

Allow authorized clients to query and stream permitted project data.

**Management credentials**

Allow authorized users or services to create projects, rotate credentials, and modify settings or alert rules.

These are conceptual categories. They could be implemented using separate key types, scopes, or another access-control mechanism.

### Additional protections

- Enforce authorization on every project-specific query and stream.
- Validate incoming data and enforce payload limits.
- Apply rate limits to ingestion and management operations.
- Use HTTPS in deployed environments.
- Support credential rotation and revocation.
- Redact sensitive fields where appropriate.
- Avoid recording credentials or sensitive payloads in internal logs.
- Define retention and deletion behavior.
- Keep management secrets out of browser bundles.
- Consider abuse prevention for publicly accessible ingestion endpoints.

---

## 12. Integrations and Future Compatibility

The first implementation could use an explicit SDK to submit structured events.

Additional integrations can be considered as the core stabilizes.

### Potential integrations

**Next.js**

An integration could simplify capturing server-side errors and attaching request or release metadata.

**OpenTelemetry**

An adapter or compatible ingestion path could allow existing instrumentation to feed the service. Compatibility should be defined explicitly rather than assumed from supporting a few similar fields.

**Docker and infrastructure logs**

Collecting container stdout and stderr generally requires a collector, logging driver, or agent. It is a separate capability from installing an SDK in an application.

**Hosting platform logs**

Automatically collecting logs from services such as Vercel may require a platform-specific integration, API access, or export mechanism. It should not be assumed that the SDK alone can collect all platform runtime logs.

These integrations should remain optional so the core can stay small and focused.

---

## 13. Local Development and Deployment

Docker Compose could provide a convenient local development environment.

A first setup might include:

- The API.
- PostgreSQL.
- An optional worker.
- An email testing service, if notifications are implemented.

The exact service list depends on the features selected for the first milestone.

Deployment documentation should eventually cover configuration, database initialization, migrations, upgrades, backups, retention, and credential management.

A self-hosted installation should not require unnecessary external services. Optional integrations should be disabled or replaceable when they are not configured.

---

## 14. Testing and Reliability

Testing should grow alongside the features rather than being postponed until the end.

Potential test categories include:

- Unit tests for event validation and normalization.
- SDK tests for serialization, batching, retries, and flushing.
- API tests for authentication and project isolation.
- Database integration tests for ingestion and queries.
- Streaming tests for reconnection and authorization.
- Worker tests for retries and duplicate-job handling.
- End-to-end tests for a complete event ingestion and retrieval flow.

Important reliability questions include how the system behaves when the database is unavailable, when email delivery fails, when events arrive in large batches, and when clients retry requests.

Exactly-once delivery should not be assumed. If retries can create duplicates, the ingestion and processing design should consider idempotency or document the delivery semantics clearly.

---

## 15. Suggested Development Phases

These phases are a possible roadmap, not commitments or release requirements.

### Phase 1 — Minimal end-to-end pipeline

- Set up the repository and development tooling.
- Define an initial event contract.
- Establish the initial database schema.
- Create projects and ingestion credentials.
- Implement the ingestion endpoint.
- Build the first server-side logging SDK.
- Persist and retrieve events.
- Add basic authentication and validation.

**Goal:** An application can submit an event and retrieve it through the API.

### Phase 2 — Useful log querying

- Add filtering and pagination.
- Improve exception serialization and stack-trace handling.
- Add environment and service metadata.
- Add initial real-time streaming if needed.
- Add integration tests and operational error handling.

**Goal:** A separate dashboard can browse historical events and optionally display new events live.

### Phase 3 — Error tracking and alerts

- Introduce error grouping.
- Define initial alert rules.
- Add background processing where necessary.
- Implement email notifications.
- Add notification status and retry handling.
- Implement retention and cleanup.

**Goal:** The service can identify recurring errors and notify users according to configured conditions.

### Phase 4 — Packaging and integrations

- Prepare the SDK and client for publication.
- Document installation and configuration.
- Add Docker-based deployment guidance.
- Evaluate a Next.js integration.
- Evaluate OpenTelemetry support.
- Evaluate a container-log collector or platform-specific integrations.

**Goal:** Make the platform easier to adopt, operate, and extend.

The project can stop after an earlier phase if that already meets its needs.

---

## 16. Decisions Still Open

The following questions can be answered when they become relevant. None should be considered settled by this document.

- What should the project and npm packages be called?
- Which open-source license best fits the intended project?
- Should the API use Hono, NestJS, or another framework?
- Should PostgreSQL and Prisma be the initial database stack?
- Which fields should be indexed and retained?
- How should project ownership and user authentication work?
- How should ingestion, read, and management credentials be issued and rotated?
- Should browser-based streaming be supported in the first release?
- Is a worker necessary immediately, or can background processing start more simply?
- Which job queue, if any, is justified?
- Which email provider or provider abstraction should be used?
- What delivery and retry guarantees should be provided?
- Which SDK features are essential for the first release?
- Which deployment environments should be officially supported?
- Should OpenTelemetry compatibility be an early goal or a later integration?
- Is a built-in dashboard ever desirable, or should dashboards remain independent projects?

Decisions should be made based on requirements, implementation experience, and operational complexity rather than treating this draft as a fixed specification.

---

## 17. Initial Scope Recommendation

A sensible starting point is a small, complete system:

1. A server-side SDK that emits structured events.
2. An API that authenticates, validates, and stores those events.
3. A database schema that supports basic querying.
4. A read API that an independent dashboard can consume.
5. Enough tests and documentation to make the system usable locally.

Error grouping, notifications, advanced streaming, external collectors, and additional integrations can follow when the base pipeline is stable.

The central architectural objective is to maintain a clear boundary between **event producers, the observability backend, and independent consumers**. That boundary should make it possible to change SDKs, dashboards, frameworks, and deployment strategies without requiring the entire project to be rewritten.

---

*This document is an initial architecture proposal. It records a possible direction for discussion and implementation; it does not establish mandatory technologies, interfaces, features, or release commitments.*
