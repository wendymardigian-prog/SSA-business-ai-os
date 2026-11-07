/**
 * El secreto con el que se firman los links con seguimiento (`attribution_link_secret`, Extra I, F40). SOLO servidor:
 * habla con Vault, así que lo usa quien manda el mensaje y la ruta `/l/<token>`, siempre con el cliente de SERVICIO.
 * Uno por workspace; se genera la primera vez que hace falta (mismo patrón que `lib/forms/signed-link.ts`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { SECRET_NAMES } from "@/lib/secret-names";
import { readSecret } from "@/lib/vault";
import { getOrCreateSecret } from "@/lib/vault-get-or-create";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

/** La clave de firma de este workspace: se genera la primera vez y queda en Vault. */
export async function getOrCreateAttributionLinkSecret(service: Db, workspaceId: string): Promise<string> {
  // Un error de Vault sube: generar otra pisaria la guardada (lib/vault-get-or-create.ts).
  return getOrCreateSecret(service, workspaceId, SECRET_NAMES.attributionLinkSecret, "de los links medidos");
}

/** La clave para VERIFICAR un link: nunca crea una (sin clave, nunca se firmó nada en este workspace). Null si no está o no se pudo leer. */
export async function readAttributionLinkSecret(service: Db, workspaceId: string): Promise<string | null> {
  try {
    return await readSecret(service, workspaceId, SECRET_NAMES.attributionLinkSecret);
  } catch {
    return null;
  }
}
