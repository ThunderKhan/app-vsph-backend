# Backend migration progress — 23 November 2026

Source of truth: `ThunderKhan/vsph-control-center@3b3a1535873aa0517aea41da32a407f3d9680547`.
Frontend: `ThunderKhan/app-vsph-frontend@migration/remaining-frontend-parity` (acceptance checkpoint 20261123).
Destination: `ThunderKhan/app-vsph-backend@migration/fastify-backend-parity`.

## Implemented in first foundation commit
- Node 24 + TypeScript/Fastify 5 service entry point, bounded JSON bodies, no-store and origin enforcement, structured safe errors.
- Live dependency-check semantics for `GET /api/health`; never reports release readiness or mocks a successful database connection.
- Supabase admin client isolated to server, environment validation, Dockerfile and isolated PostgreSQL Compose profile.
- Deterministic foundation unit tests with Fastify inject (execution pending availability of dependencies).

## Blockers and release gates
- This repository begins README-only and has no package-lock.json. Generate and review a lockfile with Node 24 + network access before attempting `npm ci`/Docker or claiming reproducible builds.
- No database credentials or approved disposable introspected schema: Prisma models, production migrations, RPC grants, and finance persistence are **not** inferred.
- No real Supabase MFA/role sessions, provider/email/GitHub integration or staging acceptance evidence. A status of `releaseReady:false` is intentional.
- No production DNS, deployment, secrets or migrations touched.

## Next slices
1. Port identity verifier, role/session repositories and current-account routes using the legacy cookies and Supabase Auth.
2. Match the frontend server proxy and all source routes in the compatibility matrix.
3. Durable invitation/employee workflows and SQL/RPC boundary verification in a disposable DB.
4. Projects, HRMS, organizations, finance and workers in dependency order; negative role/tenant fixtures required for each.

## Gate checklist
- [ ] Node 24 npm lockfile and clean `npm ci`
- [ ] Type check
- [ ] ESLint
- [ ] Unit tests
- [ ] Disposable Postgres integration tests
- [ ] Docker image/build
- [ ] Live Supabase Auth and tenant access (staging only)
- [ ] Security review and upstream reconciliation
