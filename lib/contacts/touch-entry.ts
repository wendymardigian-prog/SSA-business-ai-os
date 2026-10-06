/**
 * Los toques de las otras vías de entrada de un contacto (F87).
 *
 * Además de los mensajes y los comentarios, un contacto puede entrar porque
 * alguien lo cargó a mano o porque vino en una planilla importada. (La reserva
 * se anota en SQL, dentro de `create_booking`; el email entrante, con el mismo
 * módulo que los DMs.) Cada una es un toque más, con su origen.
 *
 * Los armadores son puros; los que escriben nunca lanzan.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { AttributionClick } from "./attribution";
import { normalizeSource } from "./taxonomy";
import { recordTouch, type TouchInput } from "./touch";

type Db = SupabaseClient<Database>;

/**
 * El toque de un alta manual. Si quien lo cargó trajo UTM (algo que hoy la
 * pantalla no pide pero la acción sí acepta), mandan; si no, la fuente es "alta
 * manual", que es en sí misma el dato de dónde salió ese contacto.
 */
export function manualTouch(contactId: string, tracking: AttributionClick | null): TouchInput {
  return {
    source: normalizeSource(tracking?.utm_source) ?? "manual",
    medium: tracking?.utm_medium ?? null,
    campaign: tracking?.utm_campaign ?? null,
    content: tracking?.utm_content ?? null,
    term: tracking?.utm_term ?? null,
    adId: tracking?.ad_id ?? null,
    adsetId: tracking?.adset_id ?? null,
    campaignId: tracking?.campaign_id ?? null,
    fbclid: tracking?.fbclid ?? null,
    gclid: tracking?.gclid ?? null,
    referrerUrl: tracking?.referrer_url ?? null,
    landingPage: tracking?.landing_page ?? null,
    origin: "manual",
    dedupeKey: `manual:${contactId}`,
  };
}

/** El toque de un contacto que entró en una importación de CSV. */
export function importTouch(importId: string, contactId: string): TouchInput {
  return {
    source: "csv",
    medium: "import",
    origin: "import",
    // La clave lleva la importación: el mismo contacto en dos planillas
    // distintas son dos entradas, y reintentar una tanda no duplica.
    dedupeKey: `import:${importId}:${contactId}`,
  };
}

/** Anota el alta manual. `supabase` es el cliente de servicio. Nunca lanza. */
export async function recordManualTouch(
  supabase: Db,
  params: { workspaceId: string; contactId: string; tracking: AttributionClick | null },
): Promise<void> {
  await recordTouch(supabase, {
    workspaceId: params.workspaceId,
    contactId: params.contactId,
    touch: manualTouch(params.contactId, params.tracking),
  });
}

/** Cuántos toques se anotan a la vez en una importación grande. */
const IMPORT_CONCURRENCY = 10;

/**
 * Anota los contactos NUEVOS de una tanda de importación. De a diez a la vez: una
 * tanda son hasta 200 filas y de a una serían 200 viajes seguidos. Nunca lanza.
 */
export async function recordImportTouches(
  supabase: Db,
  params: { workspaceId: string; importId: string; contactIds: string[] },
): Promise<void> {
  for (let i = 0; i < params.contactIds.length; i += IMPORT_CONCURRENCY) {
    const chunk = params.contactIds.slice(i, i + IMPORT_CONCURRENCY);
    await Promise.all(
      chunk.map((contactId) =>
        recordTouch(supabase, {
          workspaceId: params.workspaceId,
          contactId,
          touch: importTouch(params.importId, contactId),
        }),
      ),
    );
  }
}
