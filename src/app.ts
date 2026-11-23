import Fastify, { type FastifyInstance } from 'fastify';
import { type Env, hasSupabase } from './config.js';
import { errorBody, HttpError } from './errors.js';
import { databaseReachable } from './repositories/supabase.js';
import { installAuthRoutes, type AuthDependencies } from './modules/auth/routes.js';
import { installInvitationRoutes } from './modules/invitations/routes.js';
import { supabaseInvitationStore } from './modules/invitations/supabase-store.js';
import type { InvitationStore } from './modules/invitations/store.js';
import { supabaseAuthStore } from './modules/auth/supabase-store.js';
import { installTemporaryCredentials } from './modules/credentials/routes.js';
import { installReadRoutes } from './modules/read/routes.js';
import { installFinanceCommands } from './modules/finance/routes.js';
import { installProfileRoutes } from './modules/profile/routes.js';
import { installPublicEmployeeEnrollment } from './modules/employee-enrollment/routes.js';
import { installManagedEmployeeEnrollment } from './modules/employee-enrollment/manager-routes.js';
import { installProjectWriteRoutes } from './modules/project-write/routes.js';
import { supabaseProjectWriteStore } from './modules/project-write/supabase-store.js';
import type { ProjectWriteStore } from './modules/project-write/store.js';
import { supabaseManagerEnrollmentStore } from './modules/employee-enrollment/supabase-manager-store.js';
import type { ManagerEnrollmentStore } from './modules/employee-enrollment/manager-store.js';
import { supabaseEnrollmentStore } from './modules/employee-enrollment/supabase-store.js';
import type { EnrollmentStore } from './modules/employee-enrollment/store.js';
import { supabaseProfileStore } from './modules/profile/supabase-store.js';
import type { AccountProfileStore } from './modules/profile/store.js';
import { supabaseFinanceStore } from './modules/finance/supabase-store.js';
import type { FinanceCommandStore } from './modules/finance/store.js';
import { supabaseReadStore } from './modules/read/supabase-store.js';
import type { PortalReadStore } from './modules/read/store.js';
import { supabaseCredentialStore } from './modules/credentials/supabase-store.js';
import type { CredentialStore } from './modules/credentials/store.js';

export type Runtime = { checkDatabase?: () => Promise<boolean>; auth?: AuthDependencies; invitations?: InvitationStore; credentials?: CredentialStore; reads?: PortalReadStore; finance?: FinanceCommandStore; profile?: AccountProfileStore; employeeEnrollment?: EnrollmentStore; managedEnrollment?: ManagerEnrollmentStore; projectWrites?: ProjectWriteStore };
/** Builds without external side effects. Provider connections are opt-in and never fabricated. */
export function buildApp(env: Env, runtime: Runtime = {}): FastifyInstance {
  const app = Fastify({
    trustProxy: false,
    bodyLimit: 102400,
    logger: { redact: [
      'req.headers.authorization', 'req.headers.cookie', 'req.body.password',
      'req.body.totpCode', 'req.body.token', 'res.headers.set-cookie',
    ] },
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options','DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cache-Control', 'no-store');
    reply.header('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    reply.header('Cross-Origin-Resource-Policy','same-origin');
    reply.header('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    if(env.NODE_ENV==='production')reply.header('Strict-Transport-Security','max-age=31536000');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
        request.headers.origin !== env.PUBLIC_ORIGIN) {
      throw new HttpError(403, 'ORIGIN_DENIED', 'Request origin not permitted.');
    }
  });
  app.setErrorHandler((error, request, reply) => {
    // No raw errors, database messages, or provider payloads in responses.
    const mapped = errorBody(error);
    request.log.error({ errorType: error instanceof Error ? error.name : 'Unknown', status: mapped.status }, 'request failed');
    if(mapped.status===429)reply.header('Retry-After','60');
    reply.code(mapped.status).send(mapped.body);
  });
  app.get('/api/health', async (_request, reply) => {
    const ok = hasSupabase(env) && await (runtime.checkDatabase?.() ?? databaseReachable(env));
    return reply.code(ok ? 200 : 503).send({
      status: ok ? 'ok' : hasSupabase(env) ? 'database_unavailable' : 'not_configured',
      database: ok, releaseReady: false, scope: 'database-connectivity-only',
    });
  });
  installAuthRoutes(app,env,runtime.auth);
  installInvitationRoutes(app,runtime.auth?.store??supabaseAuthStore(env),
    runtime.invitations??supabaseInvitationStore(env));
  installTemporaryCredentials(app,runtime.credentials??supabaseCredentialStore(env),env.NODE_ENV==='production');
  installReadRoutes(app,runtime.auth?.store??supabaseAuthStore(env),runtime.reads??supabaseReadStore(env));
  installFinanceCommands(app,runtime.auth?.store??supabaseAuthStore(env),runtime.finance??supabaseFinanceStore(env));
  installProfileRoutes(app,runtime.auth?.store??supabaseAuthStore(env),runtime.profile??supabaseProfileStore(env));
  installPublicEmployeeEnrollment(app,runtime.employeeEnrollment??supabaseEnrollmentStore(env));
  installManagedEmployeeEnrollment(app,env,runtime.auth?.store??supabaseAuthStore(env),
    runtime.managedEnrollment??supabaseManagerEnrollmentStore(env));
  installProjectWriteRoutes(app,runtime.auth?.store??supabaseAuthStore(env),
    runtime.projectWrites??supabaseProjectWriteStore(env));
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ message: 'Not found.', code: 'NOT_FOUND' }));
  return app;
}
