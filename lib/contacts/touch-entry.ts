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

/** Lo que el archivo puede decir sobre el origen de una persona (todo opcional). */
export interface ImportTouchAttribution {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  /** AAAA-MM-DD: el día en que esa persona llegó de verdad, si la planilla lo sabe. */
  firstTouchDate?: string | null;
}

/**
 * El toque de un contacto que entró en una importación de CSV.
 *
 * El ORIGEN es siempre "import": eso no cambia aunque la planilla traiga UTM.
 * Si trae fuente, medio o campaña, el toque las lleva y el canal se calcula con
 * ellas (un medio `cpc` es pauta); si no, la fuente es "csv" y el medio
 * "import", como siempre. Con fecha del primer contacto, el toque queda en ese
 * día (al mediodía UTC, para que ninguna zona horaria lo pase al día de al lado);
 * sin fecha, en el momento de la importación.
 */
export function importTouch(importId: string, contactId: string, attribution?: ImportTouchAttribution | null): TouchInput {
  const date = attribution?.firstTouchDate && /^\d{4}-\d{2}-\d{2}$/.test(attribution.firstTouchDate) ? attribution.firstTouchDate : null;
  return {
    source: normalizeSource(attribution?.source) ?? "csv",
    medium: attribution?.medium?.trim() || "import",
    ...(attribution?.campaign?.trim() ? { campaign: attribution.campaign.trim() } : {}),
    ...(date ? { occurredAt: `${date}T12:00:00.000Z` } : {}),
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
  params: {
    workspaceId: string;
    importId: string;
    contactIds: string[];
    /** La atribución que trajo cada fila, por contacto (si no trajo nada, no está). */
    attribution?: Record<string, ImportTouchAttribution>;
  },
): Promise<void> {
  for (let i = 0; i < params.contactIds.length; i += IMPORT_CONCURRENCY) {
    const chunk = params.contactIds.slice(i, i + IMPORT_CONCURRENCY);
    await Promise.all(
      chunk.map((contactId) =>
        recordTouch(supabase, {
          workspaceId: params.workspaceId,
          contactId,
          touch: importTouch(params.importId, contactId, params.attribution?.[contactId] ?? null),
        }),
      ),
    );
  }
}

// ── Las respuestas que traen atribucion (F17, F33) ───────────────────────────────────────────────────

/** Los datos de atribución que NO tienen columna propia en `contact_touches`: van a `raw`. */
const FORM_RAW_EXTRA_KEYS = [
  "utm_id", "gbraid", "wbraid", "msclkid", "twclid", "sccid", "epik", "rdt_cid", "placement",
  "fbp", "fbc", "ga_client_id", "page_url",
] as const;

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

/**
 * El toque de un envío de formulario: UNO por envío.
 *
 * - `medium` es SIEMPRE "form" (como la Agenda fuerza "booking"); el `utm_medium`
 *   original queda en `raw.utm`.
 * - `content` es el `utm_content` si vino; si no, NADA: ya no se inventa con el nombre del
 *   formulario (extra L, F18). El formulario es `raw.source_id`.
 * - NO lleva `occurredAt`: la base pone `now()` del servidor. Una fecha mandada por
 *   el navegador podría volver un envío nuevo el "primer toque".
 * - La atribución es la EFECTIVA de la visita (la de la URL o, si no trajo nada, la
 *   última guardada). Los ids de clic y de anuncio con columna propia van a ella;
 *   el resto, a `raw` (que `sanitizeRaw` recorta a su lista blanca).
 *
 * La regla del primer y último toque es de `record_contact_touch`: un contacto
 * nuevo tiene este toque como primero y último; uno existente lo pasa a último y
 * su primero no cambia.
 */
export function formTouch(input: {
  submissionId: string;
  formId: string;
  formName: string;
  attribution: Record<string, unknown>;
}): TouchInput {
  const a = input.attribution;
  const utm: Record<string, string> = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    const value = str(a[key]);
    if (value) utm[key] = value;
  }

  const extras: Record<string, string> = {};
  for (const key of FORM_RAW_EXTRA_KEYS) {
    const value = str(a[key]);
    if (value) extras[key] = value;
  }

  return {
    source: normalizeSource(str(a.utm_source)) ?? "web",
    medium: "form",
    campaign: str(a.utm_campaign),
    term: str(a.utm_term),
    // Solo el `utm_content` real. El nombre del formulario NO es contenido (era un dato inventado): la
    // ficha lo muestra desde `raw.source_id` (extra L, F18).
    content: str(a.utm_content),
    adId: str(a.ad_id),
    adsetId: str(a.adset_id),
    campaignId: str(a.campaign_id),
    fbclid: str(a.fbclid),
    gclid: str(a.gclid),
    ttclid: str(a.ttclid),
    liFatId: str(a.li_fat_id),
    referrerUrl: str(a.referrer_url),
    landingPage: str(a.landing_page),
    // La URL de entrada completa (plano formularios-ui, F18): un dato aparte de `landing_page`, que sigue filtrada.
    entryUrl: str(a.entry_url),
    origin: "form",
    dedupeKey: `form:${input.submissionId}`,
    raw: { utm, source_type: "form", source_id: input.formId, ...extras },
  };
}

/** Anota el toque de un envío. `supabase` es el cliente de servicio. Nunca lanza. */
export async function recordFormTouch(
  supabase: Db,
  params: { workspaceId: string; contactId: string; submissionId: string; formId: string; formName: string; attribution: Record<string, unknown> },
): Promise<void> {
  await recordTouch(supabase, {
    workspaceId: params.workspaceId,
    contactId: params.contactId,
    touch: formTouch({ submissionId: params.submissionId, formId: params.formId, formName: params.formName, attribution: params.attribution }),
  });
}
