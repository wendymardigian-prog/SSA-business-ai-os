/**
 * La atribución de una venta (plano F10).
 *
 * La venta guarda una COPIA CONGELADA de un toque del contacto: los reportes
 * no se mueven solos cuando el contacto recibe toques nuevos. Se lee SIEMPRE
 * de `contact_touches` o de `readAttribution` (la forma canónica), nunca de
 * columnas `utm_*` planas.
 *
 * Tres tipos (`sales.attribution_type`):
 *   last_touch  el toque más reciente del contacto (por defecto)
 *   manual      otro toque del historial, o cargado a mano (taxonomía cerrada)
 *   none        el contacto no tiene toques: "Sin atribución", sin bloquear
 *
 * Módulo PURO. `create_sale` (00162) arma en SQL la misma forma para el modo
 * `last_touch`; `verify-sales.mjs` comprueba la paridad.
 */
import { z } from "zod";
import { readAttribution, type AttributionTouch } from "@/lib/contacts/attribution";
import { MEDIUMS, SOURCES, mediumLabel, sourceLabel } from "@/lib/contacts/taxonomy";
import { daysBetween, localDate } from "@/lib/shared/dates";

/** Las claves de `contact_touches.raw` que no tienen columna y que se conservan (v1.1, §0.0.4). */
export const EXTRAS_KEYS = [
  "utm_id",
  "gbraid",
  "wbraid",
  "msclkid",
  "twclid",
  "sccid",
  "epik",
  "rdt_cid",
  "placement",
  "fbp",
  "fbc",
  "ga_client_id",
  "page_url",
] as const;

export type AttributionKind = "last_touch" | "manual" | "none";

/** La copia congelada, tal como se guarda en `sales.attribution`. Campos ausentes = omitidos. */
export interface SaleAttribution {
  touch_id?: string;
  occurred_at?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  fbclid?: string;
  gclid?: string;
  ttclid?: string;
  li_fat_id?: string;
  ctwa_clid?: string;
  referrer_url?: string;
  landing_page?: string;
  extras?: Record<string, string>;
}

/** Una fila de `contact_touches` con lo que hace falta para copiarla. */
export interface TouchRow {
  id: string;
  occurred_at: string;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content_label: string | null;
  term: string | null;
  ad_id: string | null;
  adset_id: string | null;
  campaign_id: string | null;
  fbclid: string | null;
  gclid: string | null;
  ttclid: string | null;
  li_fat_id: string | null;
  ctwa_clid: string | null;
  referrer_url: string | null;
  landing_page: string | null;
  raw?: unknown;
  /** Lo que suma el Extra I (F46): el canal, la pieza, la publicacion, el origen y el vinculo con el catalogo de Meta. */
  channel?: string | null;
  content_post_id?: string | null;
  social_post_id?: string | null;
  origin?: string | null;
  meta_campaign_id?: string | null;
  meta_adset_id?: string | null;
  meta_ad_id?: string | null;
}

/** Cuántos toques se piden por página en el selector de atribución. */
export const TOUCHES_PAGE_SIZE = 20;

/** Las columnas que se piden de `contact_touches` (nunca `select("*")`). */
export const TOUCH_COLUMNS =
  "id, occurred_at, source, medium, campaign, content_label, term, ad_id, adset_id, campaign_id, fbclid, gclid, ttclid, li_fat_id, ctwa_clid, referrer_url, landing_page, raw, channel, content_post_id, social_post_id, origin, meta_campaign_id, meta_adset_id, meta_ad_id";

const text = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

function put(target: Record<string, unknown>, key: string, value: unknown) {
  const v = text(value);
  if (v !== undefined) target[key] = v;
}

/** Arma `SaleAttribution` desde una fila de `contact_touches` (con su `id` como `touch_id`). */
export function attributionFromTouch(touch: TouchRow): SaleAttribution {
  const out: Record<string, unknown> = {};
  put(out, "touch_id", touch.id);
  put(out, "occurred_at", touch.occurred_at);
  put(out, "source", touch.source);
  put(out, "medium", touch.medium);
  put(out, "campaign", touch.campaign);
  put(out, "content", touch.content_label);
  put(out, "term", touch.term);
  for (const key of ["ad_id", "adset_id", "campaign_id", "fbclid", "gclid", "ttclid", "li_fat_id", "ctwa_clid", "referrer_url", "landing_page"] as const) {
    put(out, key, touch[key]);
  }

  const raw = touch.raw && typeof touch.raw === "object" && !Array.isArray(touch.raw) ? (touch.raw as Record<string, unknown>) : {};
  const extras: Record<string, string> = {};
  for (const key of EXTRAS_KEYS) {
    const v = text(raw[key]);
    if (v !== undefined) extras[key] = v;
  }
  if (Object.keys(extras).length > 0) out.extras = extras;

  return out as SaleAttribution;
}

/** Un toque canónico (`readAttribution`) dicho como `SaleAttribution`, sin `touch_id` ni extras. */
function attributionFromCanonical(touch: AttributionTouch): SaleAttribution {
  const out: Record<string, unknown> = {};
  put(out, "occurred_at", touch.occurred_at);
  put(out, "source", touch.source);
  put(out, "medium", touch.medium);
  put(out, "campaign", touch.campaign);
  put(out, "content", touch.content);
  put(out, "term", touch.term);
  for (const key of ["ad_id", "adset_id", "campaign_id", "fbclid", "gclid", "ttclid", "li_fat_id", "ctwa_clid", "referrer_url", "landing_page"] as const) {
    put(out, key, touch[key]);
  }
  return out as SaleAttribution;
}

/**
 * Si no hay una fila de toque, el último toque de `contacts.attribution` (forma
 * canónica; entiende las formas viejas). Un contacto que solo tiene su primer
 * toque (la forma de clicks con `first_click` solamente) tiene ese como último:
 * es el único que se conoce. Null si no tiene ninguno.
 */
export function attributionFromContact(contact: { attribution: unknown }): SaleAttribution | null {
  const attribution = readAttribution(contact.attribution);
  const last = attribution.last_touch ?? attribution.first_touch;
  if (!last) return null;
  const out = attributionFromCanonical(last);
  return Object.keys(out).length > 0 ? out : null;
}

const free = z.string().trim().max(200, "Máximo 200 caracteres");

/** La carga a mano: `source` (y `medium`) de la taxonomía cerrada; el resto, libre. */
export const manualAttributionSchema = z.object({
  source: z.enum(SOURCES, { error: "Elegí una fuente de la lista" }),
  medium: z.union([z.enum(MEDIUMS), z.literal(""), z.null(), z.undefined()]).optional(),
  campaign: free.optional().nullable(),
  content: free.optional().nullable(),
  term: free.optional().nullable(),
  /** Si se partió de un toque del historial y después se editó, se conserva de cuál. */
  touch_id: z.string().optional().nullable(),
});

export type ManualAttributionInput = z.input<typeof manualAttributionSchema>;

export type ManualParse = { ok: true; attribution: SaleAttribution } | { ok: false; error: string };

export function manualAttribution(input: unknown): ManualParse {
  const parsed = manualAttributionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "La atribución no es válida" };
  const v = parsed.data;
  const out: Record<string, unknown> = { source: v.source };
  put(out, "medium", v.medium);
  put(out, "campaign", v.campaign);
  put(out, "content", v.content);
  put(out, "term", v.term);
  put(out, "touch_id", v.touch_id);
  return { ok: true, attribution: out as SaleAttribution };
}

export type AttributionRequest =
  | { mode: "last_touch" }
  | { mode: "touch"; touchId: string }
  | { mode: "manual"; manual: unknown };

export type ResolvedAttribution =
  | { ok: true; attribution: SaleAttribution | null; attribution_touch_id: string | null; attribution_type: AttributionKind }
  | { ok: false; code: "invalid_touch" | "invalid_manual"; error: string };

/** El más reciente: por `occurred_at` y, si empatan, por `id`. */
export function latestTouch<T extends { id: string; occurred_at: string }>(touches: readonly T[]): T | null {
  let best: T | null = null;
  for (const t of touches) {
    if (!best) best = t;
    else {
      const a = Date.parse(t.occurred_at);
      const b = Date.parse(best.occurred_at);
      if (a > b || (a === b && t.id > best.id)) best = t;
    }
  }
  return best;
}

/**
 * Qué atribución guarda una venta (lo mismo que hace `create_sale` en SQL).
 *  - `last_touch`: el toque más reciente; sin filas, el último de `contacts.attribution`; sin nada, `none`.
 *  - `touch`: ese toque del historial (tiene que ser de ESTE contacto) → `manual`.
 *  - `manual`: lo que cargó la persona, validado → `manual`.
 */
export function resolveSaleAttribution(
  request: AttributionRequest,
  contact: { attribution: unknown },
  touches: readonly TouchRow[],
): ResolvedAttribution {
  if (request.mode === "manual") {
    const manual = manualAttribution(request.manual);
    if (!manual.ok) return { ok: false, code: "invalid_manual", error: manual.error };
    return { ok: true, attribution: manual.attribution, attribution_touch_id: manual.attribution.touch_id ?? null, attribution_type: "manual" };
  }

  if (request.mode === "touch") {
    const picked = touches.find((t) => t.id === request.touchId);
    if (!picked) return { ok: false, code: "invalid_touch", error: "Ese toque no es de este contacto" };
    return { ok: true, attribution: attributionFromTouch(picked), attribution_touch_id: picked.id, attribution_type: "manual" };
  }

  const latest = latestTouch(touches);
  if (latest) return { ok: true, attribution: attributionFromTouch(latest), attribution_touch_id: latest.id, attribution_type: "last_touch" };

  const fromContact = attributionFromContact(contact);
  if (fromContact) return { ok: true, attribution: fromContact, attribution_touch_id: null, attribution_type: "last_touch" };

  return { ok: true, attribution: null, attribution_touch_id: null, attribution_type: "none" };
}

/** "hoy", "ayer", "hace 3 días", "hace 2 meses": días de calendario en la zona del workspace. */
export function relativeDays(occurredAt: string, now: Date, timeZone: string): string {
  const days = daysBetween(localDate(occurredAt, timeZone), localDate(now, timeZone));
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 60) return `hace ${days} días`;
  const months = Math.floor(days / 30);
  return months < 12 ? `hace ${months} meses` : `hace ${Math.floor(months / 12)} ${Math.floor(months / 12) === 1 ? "año" : "años"}`;
}

/** La línea legible: "Instagram / anuncio / campaña octubre / anuncio 123 (hace 3 días)". */
export function describeAttribution(a: SaleAttribution | null | undefined, now: Date, timeZone: string): string {
  if (!a || (!a.source && !a.medium && !a.campaign)) return "Sin atribución";
  const parts: string[] = [];
  if (a.source) parts.push(sourceLabel(a.source));
  if (a.medium) parts.push(mediumLabel(a.medium));
  if (a.campaign) parts.push(`campaña ${a.campaign}`);
  if (a.content) parts.push(a.content);
  else if (a.ad_id) parts.push(`anuncio ${a.ad_id}`);
  const line = parts.join(" / ");
  return a.occurred_at ? `${line} (${relativeDays(a.occurred_at, now, timeZone)})` : line;
}

export const ATTRIBUTION_TYPE_LINE: Record<AttributionKind, string> = {
  last_touch: "último toque",
  manual: "elegida a mano",
  none: "sin atribución",
};
