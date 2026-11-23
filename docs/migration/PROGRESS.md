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
- `GET /api/workspaces` restores the original platform-owner total / ordinary user's active-organization count semantics, with actor-bound membership queries and no frontend-supplied tenant IDs.
- `GET /api/account/sessions`, `POST /api/account/sessions/revoke-others`, `POST /api/account/sessions/:id/revoke`, using the original service-only `session_command` RPC.
- Account profile GET/PATCH now use the original `account_profile` RPC with trusted actor/current session, strict version/time-zone validation and negative authorization tests.
- Finance invoice issuance, receipt recording, receipt reversal and invoice void now dispatch to the original atomic `finance_command` SQL RPC with strict integer-paise validation, idempotency keys and owner prechecks. Tests use isolated stores; native financial integrity is not yet proven.
- Read-only projects (list/detail/manager overview), filtered search, HRMS access and finance dashboard/overview via original privileged RPCs. Owner role is checked before finance; actor and current session hash are never browser supplied. Native SQL permission tests still required.
- Versioned project creation/update, tasks, milestones, comments and deliverables now route into the original `project_command` SQL transaction. Manager appointment uses the reviewed `project_creation_command`; a missing schema blocks nonempty manager assignment rather than silently dropping it. Negative tests cover forged actor, invalid objects, tenant-denied SQL, stale versions and insecure URLs.
- Project workforce directory, role assignment/revoke, member governance and guarded archive/delete now use the original `project_workforce_command`, `project_command` and `project_lifecycle_command`. SQL retains ownership, protected-role and dependency audit invariants. **Native SQL tests remain required.**
- Project workspace GET and action POST now use `project_workspace_command` for versioned milestone checklist, risks, resources and weekly updates. Inputs preserve frozen action names and strict UUID, HTTPS URL, enum, and version validation. Mock tests include origin, actor and SQL denial cases.
- Project custom-app GET/POST/PATCH now use the retained `project_custom_application_command` with actor/project boundary, positive version, strict allowed status and safe HTTPS URL policy. Negative tests prevent authority injection, cross-tenant SQL access and insecure links. Native SQL acceptance remains pending.
- Notifications: inbox dispatch/list, retry, own preferences GET/save and bounded receipt mark-read use the original `notification_command` SQL RPC. Tests verify current portal authority, SQL denial, strict preference booleans and dispatch-before-inbox ordering. Actual notification jobs and delivery remain unverified.
- Scoped project reports via `project_report` and CSV export with the exact frozen allowlist, 100-project cap and spreadsheet formula-injection protection. Mock tests cover SQL actor binding, 403 tenant denial, safe content type, and malicious CSV fields.
- Customer invitation inspection/acceptance uses hashed capability, SQL `provisioning_command` inspect/reserve/finish/failed transitions and only the reserved provider identity. **SQL/provider acceptance unverified.**
- Employee enrollment inspection/acceptance now uses one-use SQL `internal_employee_enrollment` proof, durable reserve/finish/reject/failed transitions, and strict provider identity matching. Managed review/start/renew/ready/cancel uses session-bound SQL authority, current roster versions, one-use capabilities and UUID idempotency. Manual delivery only; email is explicitly unavailable until an approved adapter is configured. Native SQL/provider acceptance is still required.
- Employee temporary sign-in uses verified Supabase user enrollment metadata and a successful legacy `internal_employee_credentials.login` before issuing a 10-minute setup cookie (no portal session).
- `GET /api/employee-credentials/status` and `POST /api/employee-credentials/replace` now use the original SQL reserve/reject/finish/failed lifecycle and verify the reserved provider identity. The real provider+database workflow remains unverified.
- Unit and Fastify inject tests cover sessions, role/tenant enforcement, MFA, cookie parsing, revocation, finance, private invitations and employee enrollment. Check the latest GitHub Actions run for actual execution results; mocks are not live-provider proof.
- Dockerfile, Compose isolated ephemeral PostgreSQL profile. A dependency lockfile was derived from v3; Node 24 `npm ci` successfully executed in GitHub Actions on earlier commit `71e73cdd`; full CI passed at `ec25fa03` (Node 24 + Docker). Latest head must be revalidated.

## Known compatibility differences and implementation warnings

1. Original `POST /api/auth/login` supports employee temporary credentials and returns `vsph.employee.setup` + `passwordChangeRequired:true`. This is **source-wired but not staging-verified** in Fastify. Disabled/no-profile identities fail closed with 403. Do not direct employee first logins here yet.
2. The Next.js login proxy forwards `vsph.employee.setup` but not an old `vsph.portal.sid`; backend cannot revoke an existing old portal token it never receives. Need a reviewed rotation strategy that does not change the frozen frontend's contract.
3. Product record writes require an additional tenant/version/idempotency design. `POST /api/apps/:app/records` is intentionally not enabled. The frontend must not treat an absent POST route as success.
4. GitHub, Music external SSO, Outreach and invitation delivery are not activated. Existing production contracts do not prove live provider readiness.
5. `@prisma/client` and Prisma 7 are declared but no schema/model is invented. SQL migrations and audited service-only RPCs remain authoritative.

## Blockers / acceptance gates

- No approved isolated Supabase and native PostgreSQL migration-history verification; no proof that live deployed tables/RPC privileges match the checked-in manifest.
- No live Supabase MFA credential tests, temporary password/invitation provider tests, real role/tenant journeys, secure external integration receiver.
- Runtime here cannot execute native SQL acceptance; GitHub Actions validates Node 24 `npm ci`, typecheck, lint, unit tests, build, and Docker without local credentials. GitHub Actions passed at checkpoint `ec25fa03` (Node 24 clean install, TypeScript, lint, isolated tests, build and Docker/Compose); workspaces and documentation on newer commits still require latest-head revalidation. Native DB and live provider acceptance are still unavailable.
- No cloud configuration, DNS, production schema, tokens or other live secrets were touched.
- `GET /api/health` reports database connectivity only, never production rollout readiness.

## Next prioritized slices

1. Finish manager-initiated temporary credential issuance and verify employee/customer one-use state transitions in disposable native PostgreSQL/Supabase.
2. Continue engineering delivery, organization ownership step-up, customers, HRMS and admin-onboarding using existing privileged SQL commands; verify all source-wired project routines in disposable PostgreSQL.
3. Verify finance integer-paise transactional integrity, journal filters/cursors and correction/audit flows against the disposable SQL migration history.
4. Add native finance snapshot verification; continue GitHub delivery, Music/Outreach, notification workers and background jobs with explicit provider gates.
5. Verify exact frontend API contract matrix and integration acceptance before enabling production traffic.

## Gate checklist

- [x] Node 24 clean npm ci validated on earlier GitHub Actions run (latest head must revalidate)
- [x] Type check on prior `ec25fa03` (latest-head rerun pending)
- [x] ESLint on prior `ec25fa03` (latest-head rerun pending)
- [x] Unit and HTTP tests on prior `ec25fa03` (latest-head rerun pending)
- [ ] Isolated native PostgreSQL SQL/RPC + negative tenant tests
- [x] Docker Compose/build checks on prior `ec25fa03` (latest-head rerun pending)
- [ ] Actual Supabase MFA/employee/customer flows on approved staging
- [ ] GitHub, Music, Outreach provider acceptance
- [ ] Security, snapshot backup, restore, deploy and rollback review
