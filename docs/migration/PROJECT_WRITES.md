# Project mutation migration evidence

Frozen Express source: routes/projects.js at 3b3a1535873aa0517aea41da32a407f3d9680547.
Fastify code: src/modules/project-write and src/modules/project-governance.

## Source-wired operations

POST /api/projects and PATCH /api/projects/:id use project_command; creation with a manager uses project_creation_command, with no silent omission of a requested manager when the schema is unavailable.
Task and milestone creation/update, comments, and deliverables all forward to the existing project_command with immutable actor and validated project ID. The entity ID is path-derived.
Workforce role assignment/remove/manager grant/revoke uses project_workforce_command; project customer member modifications use project_command member.save; archive/delete uses project_lifecycle_command and cannot bypass linked dependencies.

## Security and validation

Portal session is rechecked before each command. Actor ID is never taken from the body, and tenant/project authorization remains in audited SQL RPCs. Request filters are strict, version must be safe positive integer, UUIDs must validate, product arrays cannot contain duplicates, and deliverable URLs require HTTPS.
Negative mock tests cover unauthenticated writes, forged cross-origin requests, owner-role injection, stale version conflicts, cross-tenant SQL denial, invalid URLs, and foreign-key-blocked deletion.

## Not yet accepted

SQL grants, project manager appointment, current project role changes, concurrent version fences and audit side effects need disposable native PostgreSQL tests. GitHub App delivery, project workspace and custom project application actions are still pending. No production migration or deployment was performed.
