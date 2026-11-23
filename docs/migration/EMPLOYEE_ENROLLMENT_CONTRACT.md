# Employee enrollment migration contract

Frozen reference: ThunderKhan/vsph-control-center@3b3a1535873aa0517aea41da32a407f3d9680547.
SQL reference: supabase/migrations/20261106054740_internal_employee_enrollment.sql.
Next gateway: src/features/employee-entry/EnrollmentGatewayContract.ts.

## Public proof

- POST /api/employee-enrollment/inspect: strict id/43-character token, SHA-256 capability and no principal.
- POST /api/employee-enrollment/accept: strict id/token/password(8-128)/confirmed, durable SQL reserve then provider identity check and write, followed by finish.
- Provider password rejection uses SQL reject. Ambiguous writes use failed, never a false successful response. Stale, already accepted and revoked invitations are rejected by the original SQL function.

## Manager operations

- GET /api/employee-enrollment/delivery: real portal session plus internal_employee_command access RPC; emailConfigured is false.
- GET /api/employee-enrollment/employees/:id: portal and currentHash-bound review RPC.
- POST /api/employee-enrollment/employees/:id: start with versioned roster, confirmed true, UUID Idempotency-Key; provision an unconfirmed Supabase identity and finish via ready.
- POST /api/employee-enrollment/:id/renew: renew current version with a new one-use private capability then ready.
- POST /api/employee-enrollment/:id/cancel: SQL-cancel using actor, current portal hash, roster and enrollment versions.
- The manager can choose manual handoff. Explicit email mode fails with EMAIL_NOT_CONFIGURED before issuing an invitation. An idempotent replay never reveals a private link.

## Acceptance required

Native disposable SQL authorization tests must prove HR/owner boundaries, disabled or reassigned issuer denial, concurrent reservation exclusion, and activation only after finish. Test Supabase Admin Identity id/metadata/email confirmation/MFA factor behavior in approved staging. No provider verification or production migration was performed. Not release-ready.
