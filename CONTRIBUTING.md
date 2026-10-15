# Contributing

Thanks for helping out.

## Setup

Requires Node 20+ (22 recommended) and pnpm 10.

```bash
pnpm install
pnpm build
```

## Before opening a PR

```bash
pnpm check:fix   # Biome format + lint fixes
pnpm typecheck
pnpm test
pnpm lint:pkg    # publint + are-the-types-wrong on built packages
```

To run the PostgreSQL tests locally:

```bash
docker run -d --rm --name pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
TEST_POSTGRES_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test
```

## Standards

- Strict TypeScript (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`). No `any`, no non-null assertions.
- Biome is the only formatter/linter.
- New behaviour needs tests; new transports must pass `runTransportConformance` from `@elie309/test-utils`.
- Add a changeset for user-facing changes: `pnpm changeset`.

## Releases

Merging to `main` runs CI. Changesets opens a "version packages" PR; merging it publishes to npm (with provenance) after approval of the `npm` environment.
