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

/**
 * Que sabemos de la clave: esta, no esta, o no pudimos mirar.
 *
 * `getZernioApiKey` devuelve null en los tres casos menos uno, y eso es un
 * problema para quien decide algo irreversible-ish con ese null: una falla
 * momentanea de Vault no es lo mismo que "se desconecto Zernio". Marcar la
 * cuenta de Instagram como "no disponible" por un error de red seria un susto
 * y, hasta la proxima sincronizacion, un Instagram que no programa. Quien
 * necesita la diferencia usa esto.
 */
export type ZernioKeyState =
  | { state: "present"; key: string }
  | { state: "absent" }
  | { state: "unknown" };

export async function getZernioKeyState(
  workspaceId: string,
  deps?: { supabase?: SupabaseClient },
): Promise<ZernioKeyState> {
  const supabase = deps?.supabase ?? (await serviceClient());

  try {
    const fromVault = (await readSecret(supabase, workspaceId, SECRET_NAMES.zernioApiKey))?.trim();
    return fromVault ? { state: "present", key: fromVault } : { state: "absent" };
  } catch (err) {
    // Sin permiso o Vault caido. No sabemos si la clave esta: no es "absent".
    console.error(
      "[zernio] no pude leer la key de Vault:",
      err instanceof Error ? err.message : String(err),
    );
    return { state: "unknown" };
  }
}

export async function getZernioApiKey(
  workspaceId: string,
  deps?: { supabase?: SupabaseClient },
): Promise<string | null> {
  // Sin key, o sin poder leerla, no hay a donde caer: se devuelve null y quien
  // llama decide que decir. Inventar una key no ayuda a nadie.
  const result = await getZernioKeyState(workspaceId, deps);
  return result.state === "present" ? result.key : null;
}
