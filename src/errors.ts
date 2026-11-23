import { IdentityError, identityErrorBody } from './modules/auth/credentials.js';
import { RpcError, classifyRpcError } from './repositories/rpc-errors.js';
export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string,
    message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = 'HttpError';
  }
}
export function errorBody(error: unknown): { status: number; body: Record<string, unknown> } {
  if(error instanceof RpcError)return classifyRpcError(error);
  if (error instanceof IdentityError) {
    return {status: error.status, body: identityErrorBody(error)};
  }
  if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
    return { status: error.status, body: { message: error.message, code: error.code,
      ...(error.details ?? {}) } };
  }
  if (error instanceof Error && /:(42703|42P01|42883|PGRST202|PGRST204|PGRST205)$/.test(error.message)) {
    return {status:503,body:{code:'SCHEMA_NOT_READY',
      message:'Database schema is not ready for this application version.'}};
  }
  return { status: 503, body: { message: 'Service temporarily unavailable.', code: 'SERVICE_UNAVAILABLE' } };
}
