import { type FastifyRequest } from 'fastify';
import { EMPLOYEE_SETUP_COOKIE, PORTAL_COOKIE, applicationCookieNames } from './session-tokens.js';
const tokenPattern = /^[A-Za-z0-9_-]{32,128}$/;
const cookieNamePattern = /^vsph\.[a-z][a-z0-9_]{1,39}\.sid$/;
export function sessionCookies(request: FastifyRequest): Record<string, string> {
  const header = request.headers.cookie;
  if (!header) return {};
  if (header.length > 8192) return {};
  const cookies: Record<string,string> = Object.create(null) as Record<string,string>;
  const pairs = header.split(';');
  if (pairs.length > 102) return {};
  for (const pair of pairs) {
    const cut = pair.indexOf('=');
    if (cut < 1) continue;
    const name = pair.slice(0,cut).trim(), token = pair.slice(cut+1).trim();
    if (name !== PORTAL_COOKIE && name !== EMPLOYEE_SETUP_COOKIE && !cookieNamePattern.test(name)) continue;
    if (!tokenPattern.test(token) || Object.hasOwn(cookies,name)) return {};
    cookies[name] = token;
  }
  return cookies;
}
export function sessionSetCookie(name: string, value: string, secure: boolean, maxAgeSeconds: number): string {
  if (name !== PORTAL_COOKIE && name !== EMPLOYEE_SETUP_COOKIE && !cookieNamePattern.test(name))
    throw new Error('Invalid session cookie name');
  if (!tokenPattern.test(value)) throw new Error('Invalid session token');
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure?'; Secure':''}`;
}
export function expireCookies(cookies: Record<string,string>, secure:boolean): string[] {
  return [PORTAL_COOKIE, EMPLOYEE_SETUP_COOKIE, ...applicationCookieNames(cookies)]
    .map(name=>`${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure?'; Secure':''}`);
}
