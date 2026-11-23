# Backend migration progress — 23 November 2026

**Authoritative reference:** `ThunderKhan/vsph-control-center@3b3a1535873aa0517aea41da32a407f3d9680547`  
**Frontend reference:** `ThunderKhan/app-vsph-frontend@65df1f9878ac7cc60d090befe6a3bb2947a49c90` (`migration/remaining-frontend-parity`)  
**Destination:** `ThunderKhan/app-vsph-backend@migration/fastify-backend-parity`

## Implemented source slices (not deployed)

- Node 24, TypeScript, Fastify 5, environment validation, no-store/security headers, same-origin write protection, JSON body bound and redacted logs.
- `GET /api/health` performs an actual server-side Supabase table connectivity check when configured. `releaseReady` is always `false`.
- Supabase Auth per-attempt identity verification, provider assurance/MFA gating, local-only provider session cleanup; negative identity tests use isolated fake providers.
- Opaque SHA-256 hashed portal/app sessions, current profile checks, product session bound to live portal session, stale/disabled identity denial, product entitlement checks; API HTTP routes wired.
- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, `POST /api/auth/app-login`, `POST /api/auth/app-logout`.
- `GET /api/apps`, `GET /api/apps/:app/contexts`, `GET /api/apps/:app/context`, `GET /api/apps/:app/records` with static CRM/Music adapters and scoped reads.
- `GET /api/account/sessions`, `POST /api/account/sessions/revoke-others`, `POST /api/account/sessions/:id/revoke`, using the original service-only `session_command` RPC.
- Account profile GET/PATCH now use the original `account_profile` RPC with trusted actor/current session, strict version/time-zone validation and negative authorization tests.
- Finance invoice issuance, receipt recording, receipt reversal and invoice void now dispatch to the original atomic `finance_command` SQL RPC with strict integer-paise validation, idempotency keys and owner prechecks. Tests use isolated stores; native financial integrity is not yet proven.
- Read-only projects (list/detail/manager overview), filtered search, HRMS access and finance dashboard/overview via original privileged RPCs. Owner role is checked before finance; actor and current session hash are never browser supplied. Native SQL permission tests still required.
- Customer invitation inspection/acceptance uses hashed capability, SQL `provisioning_command` inspect/reserve/finish/failed transitions and only the reserved provider identity. **SQL/provider acceptance unverified.**
- Employee temporary sign-in uses verified Supabase user enrollment metadata and a successful legacy `internal_employee_credentials.login` before issuing a 10-minute setup cookie (no portal session).
- `GET /api/employee-credentials/status` and `POST /api/employee-credentials/replace` now use the original SQL reserve/reject/finish/failed lifecycle and verify the reserved provider identity. The real provider+database workflow remains unverified.
- Unit and Fastify inject test files for absent sessions, unauthorized tenants, MFA enforcement, cookie parsing, session revocation and origin protection. **Execution not yet verified.**
- Dockerfile, Compose isolated ephemeral PostgreSQL profile. A dependency lockfile was derived from v3; Node 24 `npm ci` successfully executed in GitHub Actions on earlier commit `71e73cdd`. Latest head must be revalidated.

## Known compatibility differences and implementation warnings

1. Original `POST /api/auth/login` supports employee temporary credentials and returns `vsph.employee.setup` + `passwordChangeRequired:true`. This is **source-wired but not staging-verified** in Fastify. Disabled/no-profile identities fail closed with 403. Do not direct employee first logins here yet.
2. The Next.js login proxy forwards `vsph.employee.setup` but not an old `vsph.portal.sid`; backend cannot revoke an existing old portal token it never receives. Need a reviewed rotation strategy that does not change the frozen frontend's contract.
3. Product record writes require an additional tenant/version/idempotency design. `POST /api/apps/:app/records` is intentionally not enabled. The frontend must not treat an absent POST route as success.
4. GitHub, Music external SSO, Outreach and invitation delivery are not activated. Existing production contracts do not prove live provider readiness.
5. `@prisma/client` and Prisma 7 are declared but no schema/model is invented. SQL migrations and audited service-only RPCs remain authoritative.

## Blockers / acceptance gates

- No approved isolated Supabase and native PostgreSQL migration-history verification; no proof that live deployed tables/RPC privileges match the checked-in manifest.
- No live Supabase MFA credential tests, temporary password/invitation provider tests, real role/tenant journeys, secure external integration receiver.
- Runtime here provides Node 22 and no GitHub network or Docker; GitHub Actions validates Node 24 `npm ci`, typecheck, lint, unit tests, build, and Docker without local credentials. An earlier commit (`de89aebe`) passed both CI jobs; latest head requires revalidation. Native DB and live provider acceptance are still unavailable.
- No cloud configuration, DNS, production schema, tokens or other live secrets were touched.
- `GET /api/health` reports database connectivity only, never production rollout readiness.

## Next prioritized slices

1. Finish employee credential issuance and employee-enrollment proof/acceptance; verify one-use flows using native disposable PostgreSQL.
2. Organizations, customers, HRMS and projects via the retained privileged SQL commands; add current-role/tenant denial tests.
3. Finance unchanged integer-paise RPC contracts and transactional correction/audit flows.
4. GitHub delivery, Music/Outreach, workers with explicit provider gates.
5. Verify exact frontend API contract matrix and integration acceptance before enabling production traffic.

## Gate checklist

- [x] Node 24 clean npm ci validated on earlier GitHub Actions run (latest head must revalidate)
- [ ] Type check
- [ ] ESLint
- [ ] Unit and HTTP tests
- [ ] Isolated native PostgreSQL SQL/RPC + negative tenant tests
- [ ] Docker Compose checks
- [ ] Actual Supabase MFA/employee/customer flows on approved staging
- [ ] GitHub, Music, Outreach provider acceptance
- [ ] Security, snapshot backup, restore, deploy and rollback review
