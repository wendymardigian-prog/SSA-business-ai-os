/**
 * El toque de una respuesta o una reunión. No hay columna que los una: la clave es `dedupe_key`
 * (`form:<respuesta>`, `booking:<reunión>`).
 *
 * Con el cliente de SERVICIO, y solo con ids de filas que la persona ya pudo leer con su sesión: quien atiende una
 * reunión puede no ver el contacto, y entonces la RLS de `contact_touches` no le devolvería nada. Las columnas son
 * solo las del vínculo. Un error deja el mapa vacío: nunca tumba una pantalla.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchTouchRow as MatchTouch } from "./meta-link";

const COLUMNS =
  "id, contact_id, occurred_at, dedupe_key, meta_campaign_id, meta_adset_id, meta_ad_id, meta_match_status, meta_match_method, meta_match_reason";
/** PostgREST manda el `in` en la URL: de a tandas. */
const PER_QUERY = 100;

export const formTouchKey = (submissionId: string) => `form:${submissionId}`;
export const bookingTouchKey = (bookingId: string) => `booking:${bookingId}`;

const hasLink = (t: Pick<MatchTouch, "meta_campaign_id" | "meta_adset_id" | "meta_ad_id">) => Boolean(t.meta_campaign_id || t.meta_adset_id || t.meta_ad_id);

export async function loadTouchesByKey(service: SupabaseClient, workspaceId: string, keys: readonly string[]): Promise<Map<string, MatchTouch>> {
  const out = new Map<string, MatchTouch>();
  const unique = [...new Set(keys)];
  for (let i = 0; i < unique.length; i += PER_QUERY) {
    const { data, error } = await service
      .from("contact_touches")
      .select(COLUMNS)
      .eq("workspace_id", workspaceId)
      .in("dedupe_key", unique.slice(i, i + PER_QUERY));
    if (error) {
      console.error("[atribucion] no pude leer los toques, code=", error.code);
      return out;
    }
    for (const row of (data ?? []) as unknown as MatchTouch[]) if (row.dedupe_key) out.set(row.dedupe_key, row);
  }
  return out;
}

export interface BookingMatch {
  /** El toque que se muestra: el de la reunión o, si no tiene vínculo, uno anterior del contacto. */
  touch: MatchTouch | null;
  ownTouchId: string | null;
  inherited: boolean;
}

/**
 * Qué toque se muestra en una reunión. Si su toque tiene vínculo, ese. Si no (agendada a mano, por el agente o sin datos
 * de Meta), el último del contacto con vínculo anterior a la reunión: el mismo criterio de la tabla Meta vs CRM
 * (`ads_crm_items`). `previous` viene ordenado del más nuevo al más viejo. Puro.
 */
export function pickBookingTouch(own: MatchTouch | null, previous: readonly MatchTouch[], bookingCreatedAt: string): BookingMatch {
  if (own && (hasLink(own) || own.meta_match_status === "ignored")) return { touch: own, ownTouchId: own.id, inherited: false };
  const at = new Date(bookingCreatedAt).getTime();
  const earlier = previous.find((t) => hasLink(t) && t.id !== own?.id && new Date(t.occurred_at).getTime() <= at);
  if (earlier) return { touch: earlier, ownTouchId: own?.id ?? null, inherited: true };
  return { touch: own, ownTouchId: own?.id ?? null, inherited: false };
}

export async function loadBookingMatches(
  service: SupabaseClient,
  workspaceId: string,
  bookings: ReadonlyArray<{ id: string; contactId: string; createdAt: string }>,
): Promise<Map<string, BookingMatch>> {
  const own = await loadTouchesByKey(service, workspaceId, bookings.map((b) => bookingTouchKey(b.id)));
  const needPrevious = bookings.filter((b) => {
    const touch = own.get(bookingTouchKey(b.id));
    return !touch || !hasLink(touch);
  });
  const byContact = new Map<string, MatchTouch[]>();
  const contactIds = [...new Set(needPrevious.map((b) => b.contactId))];
  for (let i = 0; i < contactIds.length; i += PER_QUERY) {
    const { data, error } = await service
      .from("contact_touches")
      .select(COLUMNS)
      .eq("workspace_id", workspaceId)
      .in("contact_id", contactIds.slice(i, i + PER_QUERY))
      .or("meta_campaign_id.not.is.null,meta_adset_id.not.is.null,meta_ad_id.not.is.null")
      .order("occurred_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (error) {
      console.error("[atribucion] no pude leer los toques del contacto, code=", error.code);
      break;
    }
    for (const row of (data ?? []) as unknown as MatchTouch[]) {
      const list = byContact.get(row.contact_id) ?? [];
      list.push(row);
      byContact.set(row.contact_id, list);
    }
  }
  return new Map(
    bookings.map((b) => [b.id, pickBookingTouch(own.get(bookingTouchKey(b.id)) ?? null, byContact.get(b.contactId) ?? [], b.createdAt)]),
  );
}
