import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  PUBLIC_ORIGIN: z.string().url().default('http://localhost:3000'),
  SUPABASE_URL: z.string().url().optional().or(z.literal('')),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
});
export type Env = z.infer<typeof schema>;
export function parseEnv(input: NodeJS.ProcessEnv): Env {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new Error('Invalid backend environment configuration');
  const env = parsed.data;
  const publicUrl = new URL(env.PUBLIC_ORIGIN);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname);
  if (publicUrl.origin !== env.PUBLIC_ORIGIN || publicUrl.username || publicUrl.password ||
      (publicUrl.protocol !== 'https:' && !(local && publicUrl.protocol === 'http:')) ||
      (env.NODE_ENV === 'production' && publicUrl.protocol !== 'https:')) {
    throw new Error('PUBLIC_ORIGIN must be a trusted exact HTTPS origin (localhost HTTP allowed in development)');
  }
  const configured = Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY && env.SUPABASE_SECRET_KEY);
  if ([env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, env.SUPABASE_SECRET_KEY].some(Boolean) && !configured) {
    throw new Error('Supabase URL and both API keys must be configured together');
  }
  if (configured && (new URL(env.SUPABASE_URL!).protocol !== 'https:' ||
      [env.SUPABASE_PUBLISHABLE_KEY!, env.SUPABASE_SECRET_KEY!].some(x => /^YOUR_|^sb_.*\.\.\./.test(x)))) {
    throw new Error('Supabase credentials are placeholders or the endpoint is not HTTPS');
  }
  return env;
}
export function hasSupabase(env: Env): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY && env.SUPABASE_SECRET_KEY);
}
