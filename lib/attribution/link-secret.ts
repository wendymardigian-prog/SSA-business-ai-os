/**
 * El secreto con el que se firman los links con seguimiento (`attribution_link_secret`, Extra I, F40). SOLO servidor:
 * habla con Vault, así que lo usa quien manda el mensaje y la ruta `/l/<token>`, siempre con el cliente de SERVICIO.
 * Uno por workspace; se genera la primera vez que hace falta (mismo patrón que `lib/forms/signed-link.ts`).
 */
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SECRET_NAMES } from "@/lib/secret-names";
import { readSecret, storeSecret } from "@/lib/vault";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

/** La clave de firma de este workspace: se genera la primera vez y queda en Vault. */
export async function getOrCreateAttributionLinkSecret(service: Db, workspaceId: string): Promise<string> {
  try {
    const existing = await readSecret(service, workspaceId, SECRET_NAMES.attributionLinkSecret);
    if (existing) return existing;
  } catch {
    // No estar es el caso normal la primera vez.
  }
  const secret = randomBytes(32).toString("base64url");
  const stored = await storeSecret(service, workspaceId, SECRET_NAMES.attributionLinkSecret, secret);
  if (!stored.ok) throw new Error(`No pude guardar la clave de firma de los links: ${stored.error}`);
  return secret;
}

/** La clave para VERIFICAR un link: nunca crea una (sin clave, nunca se firmó nada en este workspace). Null si no está o no se pudo leer. */
export async function readAttributionLinkSecret(service: Db, workspaceId: string): Promise<string | null> {
  try {
    return await readSecret(service, workspaceId, SECRET_NAMES.attributionLinkSecret);
  } catch {
    return null;
  }
}
