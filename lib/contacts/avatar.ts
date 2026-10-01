/**
 * Fotos de perfil estables (F16).
 *
 * Hasta ahora Instagram SI manda la foto del contacto (`msg.sender.picture`),
 * pero `find_or_link_contact` la guardaba con COALESCE: la primera URL del CDN
 * de Meta que entraba quedaba para siempre, y esas URLs VENCEN en unos dias.
 * La burbuja terminaba con un icono roto.
 *
 * La solucion no es "refrescar siempre": una foto que alguien subio a mano
 * (`avatar_source = 'manual'`) no se puede perder porque llego un mensaje
 * nuevo. La migracion 00104 ya resuelve el caso mas simple (una foto
 * `external` se refresca con la URL fresca de cada mensaje, adentro de
 * `find_or_link_contact`). Lo que falta, y es lo que hace este modulo, es
 * COPIAR esa foto a nuestro Storage (bucket publico `avatars`), para no
 * depender de que el CDN de Meta siga sirviendo esa URL.
 *
 * Modulo mixto: `shouldRefreshAvatar` es pura y testeada aparte;
 * `storeContactAvatar` hace IO (descarga, sube, actualiza) y nunca lanza.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AvatarSource, Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

export const AVATAR_BUCKET = "avatars";

/** Mismo limite que el bucket (migracion 00095): 2 MB. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/** Los unicos mime que el bucket acepta (migracion 00095). */
const ALLOWED_AVATAR_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface ContactAvatarState {
  avatarUrl: string | null;
  avatarSource: AvatarSource | null;
  avatarUpdatedAt: string | null;
}

/** Cada cuanto se refresca una foto que ya esta en nuestro Storage. */
export const AVATAR_REFRESH_DAYS = 30;

/**
 * Si conviene copiar/refrescar la foto de este contacto.
 *
 *   manual   nunca: alguien la puso a mano.
 *   (ninguna) siempre: no hay nada que mostrar.
 *   external siempre: es la URL cruda del proveedor, y copiarla a Storage es
 *            justamente lo que la hace estable. find_or_link_contact ya la
 *            refresco en la base (00104); esto la copia al bucket.
 *   storage  solo si pasaron mas de 30 dias desde la ultima copia.
 */
export function shouldRefreshAvatar(contact: ContactAvatarState, now: Date): boolean {
  if (contact.avatarSource === "manual") return false;
  if (!contact.avatarUrl) return true;
  if (contact.avatarSource !== "storage") return true;
  if (!contact.avatarUpdatedAt) return true;
  const updated = new Date(contact.avatarUpdatedAt).getTime();
  if (!Number.isFinite(updated)) return true;
  return now.getTime() - updated > AVATAR_REFRESH_DAYS * 24 * 60 * 60 * 1000;
}

/** El mime por sus primeros bytes. Solo jpeg/png/webp: lo que el bucket acepta. */
function sniffAvatarMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export type StoreContactAvatarResult = { ok: true } | { ok: false; reason: string };

/**
 * Lo que llaman los dos webhooks: lee el estado actual del contacto, decide
 * si hace falta refrescar, y SOLO SI HACE FALTA resuelve la URL (con
 * `resolveSourceUrl`) y la guarda. Nunca lanza.
 *
 * `resolveSourceUrl` es perezosa a proposito: para WhatsApp, conseguir la URL
 * es una llamada a Evolution (`fetchProfilePictureUrl`), y el criterio es NO
 * pedirsela en cada mensaje, solo cuando el avatar lo necesita (F16). Para
 * Instagram la URL ya viene en el payload, asi que el resolver no hace ningun
 * IO: igual se evalua perezoso, por la misma interfaz para los dos canales.
 *
 * Va DESPUES de `maybeScheduleAgentTurn` en los dos receptores: es una
 * mejora cosmetica, no algo de lo que el agente dependa, y no tiene que
 * demorar el turno.
 */
export async function maybeStoreContactAvatar(args: {
  supabase: Db;
  workspaceId: string;
  contactId: string;
  resolveSourceUrl: () => Promise<string | null> | string | null;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  try {
    const { data: contact, error } = await args.supabase
      .from("contacts")
      .select("avatar_url, avatar_source, avatar_updated_at")
      .eq("id", args.contactId)
      .maybeSingle();

    if (error || !contact) return;

    const now = args.now ?? new Date();
    if (!shouldRefreshAvatar({ avatarUrl: contact.avatar_url, avatarSource: contact.avatar_source, avatarUpdatedAt: contact.avatar_updated_at }, now)) {
      return;
    }

    const sourceUrl = await args.resolveSourceUrl();
    if (!sourceUrl) return;

    const result = await storeContactAvatar({
      supabase: args.supabase,
      workspaceId: args.workspaceId,
      contactId: args.contactId,
      sourceUrl,
      now,
      fetchImpl: args.fetchImpl,
    });

    if (!result.ok) {
      console.error(`[avatar] no pude guardar la foto de ${args.contactId}:`, result.reason);
    }
  } catch (err) {
    console.error(
      `[avatar] error inesperado guardando la foto de ${args.contactId}:`,
      err instanceof Error ? err.message : "error desconocido",
    );
  }
}

/**
 * Descarga la foto de `sourceUrl`, la sube a `avatars/<ws>/contacts/<id>.jpg`
 * y actualiza al contacto. Nunca lanza: un fallo cualquiera deja al contacto
 * como estaba (con su inicial, si no tenia foto todavia).
 *
 * El `?v=<timestamp>` en la URL guardada rompe el cache del navegador: sin
 * eso, refrescar la foto a los 30 dias no se veria hasta limpiar cache, pese
 * a que el archivo en Storage ya cambio.
 */
export async function storeContactAvatar(args: {
  supabase: Db;
  workspaceId: string;
  contactId: string;
  sourceUrl: string;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<StoreContactAvatarResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const now = args.now ?? new Date();

  try {
    const res = await fetchImpl(args.sourceUrl);
    if (!res.ok) return { ok: false, reason: `No se pudo descargar la foto (${res.status})` };

    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0) return { ok: false, reason: "La foto llegó vacía" };
    if (buf.byteLength > MAX_AVATAR_BYTES) return { ok: false, reason: "La foto supera los 2 MB" };

    const mime = sniffAvatarMime(buf);
    if (!mime || !ALLOWED_AVATAR_MIME.has(mime)) {
      return { ok: false, reason: "El archivo no es una imagen jpeg, png o webp" };
    }

    const path = `${args.workspaceId}/contacts/${args.contactId}.jpg`;
    const { error: uploadError } = await args.supabase.storage
      .from(AVATAR_BUCKET)
      .upload(path, buf, { contentType: mime, upsert: true });
    if (uploadError) return { ok: false, reason: `No se pudo subir la foto: ${uploadError.message}` };

    const { data: pub } = args.supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
    const publicUrl = `${pub.publicUrl}?v=${now.getTime()}`;

    const { error: updateError } = await args.supabase
      .from("contacts")
      // No pisa una foto manual: defensa en profundidad, shouldRefreshAvatar
      // ya la filtra antes de llegar aca.
      .update({ avatar_url: publicUrl, avatar_source: "storage", avatar_updated_at: now.toISOString() })
      .eq("id", args.contactId)
      .neq("avatar_source", "manual");
    if (updateError) return { ok: false, reason: `No se pudo guardar la foto: ${updateError.message}` };

    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "error desconocido" };
  }
}
