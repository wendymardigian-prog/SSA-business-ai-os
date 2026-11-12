/**
 * El evento que se le manda a la API de Conversiones de Meta, armado con los datos de lo que pasó (una respuesta de
 * formulario, una reunión, un pago, o solo el contacto de un flujo). Puro: recibe los datos ya leídos de la base y
 * devuelve el evento, o el motivo por el que no se manda.
 *
 * Lo que decide acá, y no la persona que arma el paso:
 *   - El `event_id`: es lo que deja que Meta junte este envío con el del Pixel y no cuente dos veces. Un formulario de
 *     una web externa usa el `meta_event_id` que mandó la web (el mismo que usó su Pixel).
 *   - El `action_source`: `website` si la persona estaba en una web (con la URL y su navegador, que Meta exige para
 *     eso); si falta alguno de los dos, `system_generated`, que Meta acepta sin ellos.
 *   - La hora: la de lo que pasó, nunca la de cuando corre el flujo. Meta rechaza un evento de más de 7 días (y con él,
 *     el lote entero): se saltea con su motivo.
 */

import { buildUserData, fbcFromFbclid, hasMatchData, type MetaUserData, type UserDataInput } from "./normalize";
import { isCurrencyCode, type SkipReason } from "./events";

export { SKIP_REASON_LABELS, type SkipReason } from "./events";

export const CAPI_MAX_AGE_DAYS = 7;
/** Un poco menos de 7 días: el job puede tardar unos minutos en correr y Meta cuenta contra SU reloj. */
const MAX_AGE_MS = CAPI_MAX_AGE_DAYS * 24 * 60 * 60 * 1000 - 10 * 60 * 1000;

export type CapiSourceType = "form" | "booking" | "payment" | "contact";
export type ActionSource = "website" | "system_generated";

export interface MetaServerEvent {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: ActionSource;
  event_source_url?: string;
  user_data: MetaUserData;
  custom_data?: {
    value?: number;
    currency?: string;
    content_name?: string;
    order_id?: string;
  };
}

// ── Los ids ───────────────────────────────────────────────────────────────

const META_EVENT_ID_RE = /^[A-Za-z0-9._:-]{1,100}$/;

/** El código del evento según de dónde viene. Siempre el mismo para lo mismo: así un reintento no cuenta dos veces. */
export function capiEventId(
  source:
    | { type: "form"; submissionId: string; metaEventId?: string | null }
    | { type: "booking"; bookingId: string }
    | { type: "payment"; paymentId: string }
    | { type: "flow"; sessionId: string; nodeId: string },
): string {
  switch (source.type) {
    case "form": {
      const fromSite = (source.metaEventId ?? "").trim();
      return META_EVENT_ID_RE.test(fromSite) ? fromSite : `form.${source.submissionId}`;
    }
    case "booking":
      return `booking.${source.bookingId}`;
    case "payment":
      return `payment.${source.paymentId}`;
    case "flow":
      return `flow.${source.sessionId}.${source.nodeId}`;
  }
}

// ── Valores ───────────────────────────────────────────────────────────────

/**
 * Un monto escrito por una persona o que salió de una variable: «1500», «1.500,50», «$ 1,500.50», «USD 99».
 * `null` si no es un número positivo (o cero).
 */
export function parseMoney(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 100) / 100 : null;
  if (typeof raw !== "string") return null;
  let value = raw.replace(/[^\d.,-]/g, "");
  if (!value || value.startsWith("-")) return null;
  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // El último separador es el decimal; el otro, de miles.
    value = lastComma > lastDot ? value.replace(/\./g, "").replace(",", ".") : value.replace(/,/g, "");
  } else if (lastComma > -1) {
    // Solo comas: decimal si hay una y le siguen 1 o 2 dígitos («99,5»); si no, de miles («1,500»).
    const parts = value.split(",");
    value = parts.length === 2 && parts[1].length <= 2 ? `${parts[0]}.${parts[1]}` : parts.join("");
  } else if (lastDot > -1) {
    const parts = value.split(".");
    // Solo puntos: «1.500» y «1.500.000» son miles; «99.5» y «99.50» son decimales.
    value = parts.length > 2 || (parts.length === 2 && parts[1].length === 3) ? parts.join("") : value;
  }
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/** Una URL que Meta acepta como página del evento: http o https, hasta 1000. */
export function safeSourceUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const text = url.toString();
    return text.length <= 1000 ? text : null;
  } catch {
    return null;
  }
}

// ── El evento ─────────────────────────────────────────────────────────────

export interface CapiEventInput {
  eventName: string;
  eventId: string;
  /** Cuándo pasó (la respuesta, la reunión, el cobro). */
  occurredAt: Date;
  now: Date;
  /** Si hubo una persona en una web: una respuesta o una reunión pública. */
  fromWebsite: boolean;
  sourceUrl?: string | null;
  user: UserDataInput & { fbclid?: string | null };
  value?: number | null;
  currency?: string | null;
  contentName?: string | null;
  orderId?: string | null;
}

export type BuildResult = { ok: true; event: MetaServerEvent } | { ok: false; reason: SkipReason };

export function buildCapiEvent(input: CapiEventInput): BuildResult {
  const occurred = input.occurredAt.getTime();
  if (!Number.isFinite(occurred) || !input.eventName.trim() || !input.eventId.trim()) return { ok: false, reason: "invalid" };
  if (input.now.getTime() - occurred > MAX_AGE_MS) return { ok: false, reason: "too_old" };

  const user = buildUserData({
    ...input.user,
    // Sin la cookie `_fbc`, con el `fbclid` del link: Meta lo arma igual, con la hora en que se vio.
    fbc: input.user.fbc ?? fbcFromFbclid(input.user.fbclid, input.occurredAt),
  });
  if (!hasMatchData(user)) return { ok: false, reason: "no_match_data" };

  const url = safeSourceUrl(input.sourceUrl);
  // Meta exige la URL y el navegador para un evento de web. Sin los dos, se manda como generado por el sistema.
  const website = input.fromWebsite && !!url && !!user.client_user_agent;

  const event: MetaServerEvent = {
    event_name: input.eventName.trim(),
    // En SEGUNDOS: en milisegundos, Meta lo toma como una fecha del futuro y lo rechaza.
    event_time: Math.floor(Math.min(occurred, input.now.getTime()) / 1000),
    event_id: input.eventId.trim(),
    action_source: website ? "website" : "system_generated",
    user_data: user,
  };
  if (website && url) event.event_source_url = url;

  const custom: NonNullable<MetaServerEvent["custom_data"]> = {};
  if (typeof input.value === "number" && Number.isFinite(input.value) && input.value >= 0) {
    custom.value = input.value;
    custom.currency = isCurrencyCode(input.currency) ? input.currency : "USD";
  }
  const contentName = (input.contentName ?? "").trim();
  if (contentName) custom.content_name = contentName.slice(0, 200);
  const orderId = (input.orderId ?? "").trim();
  if (orderId) custom.order_id = orderId;
  if (Object.keys(custom).length > 0) event.custom_data = custom;

  return { ok: true, event };
}
