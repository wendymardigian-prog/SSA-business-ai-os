/**
 * La API key de Zernio del workspace.
 *
 * Vive en **Supabase Vault**. Antes estaba en texto plano en
 * `workspaces.late_api_key_encrypted` —el nombre mentia: nunca estuvo
 * encriptada— y esta funcion caia a esa columna cuando Vault no tenia nada.
 * Ese respaldo existia para que lo que ya estaba conectado siguiera
 * andando sin que nadie volviera a pegar la key.
 *
 * La key se movio a Vault y la columna se borro (migracion 00090), asi que
 * el respaldo tambien se fue. Si Vault no la tiene, no hay key: se devuelve
 * null y quien llama muestra "conectala en Integraciones", que es lo unico
 * que se puede hacer al respecto.
 *
 * Se usa el service client a proposito: `read_secret` solo lo aceptan
 * Owner/Admin o service_role, y esta key la necesita tambien un Member para
 * responder en la bandeja, un cron y un webhook. Es del servidor: la key
 * nunca llega al navegador.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { readSecret, SECRET_NAMES } from "@/lib/vault";

async function serviceClient(): Promise<SupabaseClient> {
  const { createServiceClient } = await import("@/lib/supabase/server");
  return (await createServiceClient()) as unknown as SupabaseClient;
}

export async function getZernioApiKey(
  workspaceId: string,
  deps?: { supabase?: SupabaseClient },
): Promise<string | null> {
  const supabase = deps?.supabase ?? (await serviceClient());

  try {
    const fromVault = await readSecret(supabase, workspaceId, SECRET_NAMES.zernioApiKey);
    return fromVault?.trim() || null;
  } catch (err) {
    // Sin permiso o Vault caido. No hay a donde caer: se devuelve null y
    // quien llama decide que decir. Inventar una key no ayuda a nadie.
    console.error(
      "[zernio] no pude leer la key de Vault:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
