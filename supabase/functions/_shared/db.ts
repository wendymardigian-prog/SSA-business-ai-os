/**
 * Cliente de Supabase con service role para las Edge Functions.
 *
 * Un webhook no tiene usuario logueado, asi que escribe con la service key y
 * saltea RLS. Esta key la inyecta Supabase sola: no se configura a mano.
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en la Edge Function");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export type { SupabaseClient };
