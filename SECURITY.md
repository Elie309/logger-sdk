# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's "Report a vulnerability" button on the Security tab of this repository. Do not open a public issue. Expect an initial response within a few days.

## Guidance for users

- Keep ingestion keys, read tokens and database credentials in server-side environment variables.
- Never embed read or management tokens in browser bundles.
- Extend `redact.keys` for any sensitive field names specific to your application.
