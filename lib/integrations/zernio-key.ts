/**
 * La API key de Zernio del workspace.
 *
 * Antes vivia en texto plano en workspaces.late_api_key_encrypted (el nombre
 * miente: nunca estuvo encriptada). Ahora se guarda en Vault desde la pantalla
 * de integraciones, igual que el resto de las keys.
 *
 * Esta funcion lee Vault primero y cae a la columna vieja si ahi no hay nada,
 * asi lo que ya estaba conectado sigue funcionando sin que nadie tenga que
 * volver a pegar la key. Cuando ya no queden workspaces con la key en la
 * columna, se puede borrar la columna y el fallback.
 *
 * Se usa el service client a proposito: read_secret solo lo aceptan Owner/Admin
 * o service_role, y esta key la necesita tambien un Member para responder en la
 * bandeja, un cron y un webhook. Es server-side, la key nunca llega al browser.
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
    if (fromVault) return fromVault;
  } catch (err) {
    // Sin permiso o Vault caido: se intenta el fallback antes de rendirse.
    console.error(
      "[zernio] no pude leer la key de Vault, pruebo el campo viejo:",
      err instanceof Error ? err.message : String(err),
    );
  }

  const { data } = await supabase
    .from("workspaces")
    .select("late_api_key_encrypted")
    .eq("id", workspaceId)
    .maybeSingle();

  return data?.late_api_key_encrypted?.trim() || null;
}
