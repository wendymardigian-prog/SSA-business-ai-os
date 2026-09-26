/**
 * El canal de email (F62).
 *
 * Un canal como cualquier otro, con dos particularidades:
 *
 *  - **`late_account_id = "email:<direccion>"`**. Esa columna es NOT NULL en
 *    toda la tabla y la leen mas de cuarenta lugares asumiendo un texto.
 *    Aflojarla para un canal obligaria a revisar los cuarenta; ponerle un
 *    valor con prefijo no obliga a nada.
 *  - **Uno solo por workspace**, con un indice unico parcial. Dos canales
 *    para la misma direccion serian dos bandejas para los mismos correos.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

/** Como se guarda la direccion en `late_account_id`. */
export function emailAccountId(address: string): string {
  return `email:${address.trim().toLowerCase()}`;
}

/** La direccion de vuelta, a partir del `late_account_id`. */
export function addressFromAccountId(accountId: string): string | null {
  return accountId.startsWith("email:") ? accountId.slice(6) : null;
}

export type ChannelResult =
  | { ok: true; channelId: string; created: boolean }
  | { ok: false; error: string };

/** Una direccion valida, en minusculas. */
export function normalizeAddress(value: string): string | null {
  const address = value.trim().toLowerCase();
  // Deliberadamente simple: lo que importa es que tenga una arroba y algo
  // de cada lado. Validar direcciones de verdad con una expresion regular
  // es un problema sin solucion, y Resend rechaza las que no existen.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? address : null;
}

/**
 * Crea el canal de email, o actualiza el que hay.
 *
 * Cambiar la direccion no crea otro canal: mueve el existente. Si creara
 * uno nuevo, las conversaciones viejas quedarian colgando de un canal que
 * ya nadie mira.
 */
export async function ensureEmailChannel(
  supabase: Db,
  params: { workspaceId: string; address: string },
): Promise<ChannelResult> {
  const address = normalizeAddress(params.address);
  if (!address) return { ok: false, error: "Esa no parece una direccion de email" };

  const { data: existing } = await supabase
    .from("channels")
    .select("id")
    .eq("workspace_id", params.workspaceId)
    .eq("platform", "email")
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("channels")
      .update({
        email_address: address,
        late_account_id: emailAccountId(address),
        display_name: address,
        username: address,
        is_active: true,
        connection_status: "connected",
        last_error: null,
      })
      .eq("id", existing.id);

    if (error) {
      console.error("[email] no pude actualizar el canal:", error.message);
      return { ok: false, error: "No pude actualizar el canal de email" };
    }
    return { ok: true, channelId: existing.id, created: false };
  }

  const { data: created, error } = await supabase
    .from("channels")
    .insert({
      workspace_id: params.workspaceId,
      platform: "email",
      provider: "resend",
      email_address: address,
      late_account_id: emailAccountId(address),
      display_name: address,
      username: address,
      is_active: true,
      connection_status: "connected",
    })
    .select("id")
    .maybeSingle();

  if (error || !created) {
    console.error("[email] no pude crear el canal:", error?.message);
    return { ok: false, error: "No pude crear el canal de email" };
  }

  return { ok: true, channelId: created.id, created: true };
}

/** El canal de email del workspace, si hay. */
export async function getEmailChannel(
  supabase: Db,
  workspaceId: string,
): Promise<{ id: string; address: string | null; isActive: boolean } | null> {
  const { data } = await supabase
    .from("channels")
    .select("id, email_address, is_active")
    .eq("workspace_id", workspaceId)
    .eq("platform", "email")
    .maybeSingle();

  if (!data) return null;
  return { id: data.id, address: data.email_address, isActive: data.is_active };
}

/** El canal que recibe en esa direccion, sin saber de que workspace es. */
export async function findChannelByAddress(
  supabase: Db,
  address: string,
): Promise<{ id: string; workspaceId: string; address: string } | null> {
  const normalized = normalizeAddress(address);
  if (!normalized) return null;

  const { data } = await supabase
    .from("channels")
    .select("id, workspace_id, email_address")
    .eq("platform", "email")
    .eq("email_address", normalized)
    .eq("is_active", true)
    .maybeSingle();

  if (!data) return null;
  return { id: data.id, workspaceId: data.workspace_id, address: normalized };
}

/**
 * A que direccion nuestra llego el correo.
 *
 * Puede venir en `to`, en `cc` o en ninguno de los dos (copia oculta). Se
 * busca la que coincide con un canal nuestro; si no hay, se usa la primera
 * de `to`, que es lo mas parecido a la verdad.
 */
export function recipientAddress(params: {
  to: string[];
  cc?: string[];
  knownAddresses: string[];
}): string | null {
  const known = new Set(params.knownAddresses.map((a) => a.toLowerCase()));
  const all = [...params.to, ...(params.cc ?? [])].map((a) => a.toLowerCase());

  return all.find((address) => known.has(address)) ?? params.to[0]?.toLowerCase() ?? null;
}
