/**
 * Retencion de las fotos de perfil copiadas a Storage (F16).
 *
 * El motivo no es el espacio -- una foto pesa unos 30 KB y mil contactos son
 * 30 MB sobre 100 GB de plan -- sino no guardar indefinidamente la cara de
 * gente con la que ya no se habla. Se cuelga del mismo cron diario que ya
 * limpia la media del chat y las piezas publicadas (`content-media-cleanup`):
 * mismo criterio que F5, sin sumar una ruta de cron nueva.
 *
 * Solo se borran fotos `avatar_source = 'storage'`: una `manual` nunca se
 * toca, y una `external` no tiene archivo nuestro que borrar.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { AVATAR_BUCKET } from "./avatar";

type Db = SupabaseClient<Database>;

/** Seis meses. Fijo: no es una configuracion del workspace, a diferencia de chat_media_retention_days. */
export const AVATAR_RETENTION_DAYS = 180;

const BATCH = 200;

export interface ContactToCleanAvatar {
  id: string;
  last_interaction_at: string | null;
}

export interface AvatarCleanupPlan {
  contactId: string;
  path: string;
}

/**
 * Que fotos borrar: las de contactos `storage` sin interaccion en
 * `retentionDays`. Se mira `last_interaction_at`, que ya existe y lo
 * mantiene `find_or_link_contact` en cada mensaje -- consultarlo es mucho mas
 * barato que recorrer `messages` por contacto.
 *
 * Sin `last_interaction_at` (no deberia pasar: todo contacto con avatar
 * `storage` tuvo al menos un mensaje) se trata como elegible: no hay
 * evidencia de actividad reciente.
 */
export function planContactAvatarCleanup(args: {
  workspaceId: string;
  contacts: ContactToCleanAvatar[];
  retentionDays: number;
  now: Date;
}): AvatarCleanupPlan[] {
  if (args.retentionDays <= 0) return [];
  const cutoff = args.now.getTime() - args.retentionDays * 24 * 60 * 60 * 1000;

  const plans: AvatarCleanupPlan[] = [];
  for (const contact of args.contacts) {
    const last = contact.last_interaction_at ? new Date(contact.last_interaction_at).getTime() : null;
    if (last !== null && Number.isFinite(last) && last >= cutoff) continue;
    plans.push({ contactId: contact.id, path: `${args.workspaceId}/contacts/${contact.id}.jpg` });
  }
  return plans;
}

export async function cleanupContactAvatars(
  supabase: Db,
  now: Date = new Date(),
): Promise<{ cleanedContacts: number }> {
  let cleanedContacts = 0;

  const { data: workspaces, error } = await supabase.from("workspaces").select("id");
  if (error) {
    console.error("[avatar-cleanup] no pude leer los workspaces:", error.message);
    return { cleanedContacts };
  }

  const cutoff = new Date(now.getTime() - AVATAR_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  for (const workspace of workspaces ?? []) {
    const { data: contacts, error: readError } = await supabase
      .from("contacts")
      .select("id, last_interaction_at")
      .eq("workspace_id", workspace.id)
      .eq("avatar_source", "storage")
      .or(`last_interaction_at.lt.${cutoff},last_interaction_at.is.null`)
      .limit(BATCH);

    if (readError) {
      console.error("[avatar-cleanup] no pude leer los contactos:", readError.message);
      continue;
    }

    const plans = planContactAvatarCleanup({
      workspaceId: workspace.id,
      contacts: contacts ?? [],
      retentionDays: AVATAR_RETENTION_DAYS,
      now,
    });

    for (const plan of plans) {
      const { error: storageError } = await supabase.storage.from(AVATAR_BUCKET).remove([plan.path]);

      if (storageError) {
        // Si no se pudo borrar, NO se marca: al dia siguiente se reintenta.
        console.error(`[avatar-cleanup] ${plan.contactId}:`, storageError.message);
        continue;
      }

      // avatar_source queda en 'storage': si la persona vuelve a escribir,
      // shouldRefreshAvatar ya da true porque avatar_url es null, y la foto
      // se vuelve a copiar sin que haga falta resetear el estado.
      const { error: updateError } = await supabase
        .from("contacts")
        .update({ avatar_url: null, avatar_updated_at: now.toISOString() })
        .eq("id", plan.contactId)
        .eq("avatar_source", "storage");

      if (updateError) {
        console.error(`[avatar-cleanup] ${plan.contactId}:`, updateError.message);
        continue;
      }

      cleanedContacts++;
    }
  }

  return { cleanedContacts };
}
