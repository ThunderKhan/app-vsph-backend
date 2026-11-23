# Backend migration validation gates

Run on Node.js 24 (the supported runtime): `npm ci && npm run check && npm run build`.
The lockfile is provisionally derived from the earlier v3 dependency resolution; the
GitHub Actions clean install is the first reproducibility check, **not** evidence of successful provider acceptance.

Run `docker compose config` and `docker compose build` locally once Docker is installed.
The `isolated-db` profile is for an ephemeral disposable PostgreSQL only. It does
not configure a Supabase Auth stack or install the SQL schema.

No live Supabase URLs, service-role keys, GitHub App secrets or production infrastructure
are used in CI. Fastify inject tests use fake providers and session stores. Their results
cannot stand in for native SQL/RPC grants, real MFA, invitation delivery, reliable workers,
or a production deployment.

Before merging:
- Confirm all Node 24 CI jobs passed (not just configured).
- Obtain an approved disposable database, check the SQL manifest prerequisites and replay
  grant/tenant-negative tests using real service-role RPCs.
- Compare emitted response bodies and cookies against frontend proxy contract tests.
- Verify all integration receivers, exact proxy origins, migration rollback strategy and secrets.
- Leave the PR as draft until all independently verifiable acceptance gates are complete.
