export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string,
    message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = 'HttpError';
  }
}
export function errorBody(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
    return { status: error.status, body: { message: error.message, code: error.code,
      ...(error.details ?? {}) } };
  }
  return { status: 503, body: { message: 'Service temporarily unavailable.', code: 'SERVICE_UNAVAILABLE' } };
}
