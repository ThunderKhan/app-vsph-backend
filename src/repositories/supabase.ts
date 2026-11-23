import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { type Env, hasSupabase } from '../config.js';
let admin: SupabaseClient | undefined;
export function serviceDatabase(env: Env): SupabaseClient {
  if (!hasSupabase(env)) throw new Error('Service database is not configured');
  // Service-role access must never be exposed to the browser. Authorization belongs
  // in route guards AND the existing service-only transactional SQL/RPC layer.
  return admin ??= createClient(env.SUPABASE_URL!, env.SUPABASE_SECRET_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}
export async function databaseReachable(env: Env): Promise<boolean> {
  if (!hasSupabase(env)) return false;
  try {
    const { error } = await serviceDatabase(env).from('applications').select('id').limit(1);
    return !error;
  } catch { return false; }
}
