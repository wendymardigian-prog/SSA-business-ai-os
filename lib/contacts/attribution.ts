/**
 * Atribucion de un contacto (F10, y F84 de Contenido v3).
 *
 * **Hay tres formas guardadas en `contacts.attribution` y conviven:**
 *
 *   canonica  `{ version: 2, first_touch, last_touch }`. La que escribe
 *             `record_contact_touch` (00114): una copia derivada de la tabla
 *             `contact_touches`. Es la unica que se escribe de ahora en mas.
 *   clicks    `{ first_click, last_click }` con utm_*. La que escribia el alta
 *             manual (F10). Solo se LEE.
 *   plana     `{ utm_*, source: 'scheduling', referrer }`. La que escribia el
 *             agendamiento (00099). Solo se lee; antes `readAttribution`
 *             devolvia vacio para ella y la atribucion de las reservas era
 *             invisible en la ficha.
 *
 * `readAttribution` entiende las tres y devuelve SIEMPRE la canonica, asi nadie
 * mas tiene que saber que existieron tres. Cuando hay toques (`version: 2`) esos
 * mandan; las formas viejas se leen solo si no los hay.
 *
 * `readClickAttribution`, `mergeAttribution` y `parseTrackingParams` son del
 * formato de clicks y se conservan: `parseTrackingParams` sigue sacando las UTM
 * de lo que carga una persona.
 *
 * De donde vino el lead: UTMs, click ids de Meta y Google, el aviso concreto y
 * la pagina donde aterrizo. Se guarda como jsonb en `contacts.attribution` en
 * vez de una tabla aparte porque es 1:1 con el contacto — una tabla solo
 * agregaria un JOIN a cada consulta.
 *
 * La regla del negocio son dos fotos:
 *
 *   first_click  la primera interaccion atribuible. Se escribe UNA vez y no se
 *                toca nunca mas: es el credito de quien trajo al lead.
 *   last_click   la ultima. Se pisa en cada interaccion nueva con parametros.
 *
 * En la Fase 1 nada llena esto solo todavia: no hay landing ni formulario
 * propio que capture los parametros. La estructura y el merge estan listos
 * para cuando los haya, y mientras tanto se puede cargar a mano desde la
 * ficha del contacto.
 */

/** Los parametros que se guardan. Cualquier otro se descarta. */
import { normalizeMedium, normalizeSource } from "./taxonomy";

export const TRACKING_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "ad_id",
  "campaign_id",
  "adset_id",
  "referrer_url",
  "landing_page",
] as const;

export type TrackingKey = (typeof TRACKING_KEYS)[number];

export type AttributionClick = Partial<Record<TrackingKey, string>> & {
  /** ISO 8601. Cuando se capturo esta foto. */
  captured_at?: string;
};

/** La forma de clicks (F10). Solo para leer y para el alta manual. */
export interface ClickAttribution {
  first_click?: AttributionClick;
  last_click?: AttributionClick;
}

/**
 * Un toque, tal como queda en `contacts.attribution` (lo arma `contact_touch_json`
 * en la 00114). Todo opcional: lo que la fuente no dio no esta.
 */
export interface AttributionTouch {
  /** ISO 8601. */
  occurred_at?: string;
  source?: string;
  medium?: string;
  /** El medio no es de la lista cerrada: se guardo crudo. */
  medium_raw?: boolean;
  campaign?: string;
  /** La pieza, en palabras. */
  content?: string;
  term?: string;
  social_post_id?: string;
  content_post_id?: string;
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
  origin?: string;
}

/** La forma canonica: lo que devuelve `readAttribution`. */
export interface Attribution {
  first_touch?: AttributionTouch;
  last_touch?: AttributionTouch;
}

/** Un valor largo no aporta nada y solo engorda la fila. */
const MAX_VALUE_LENGTH = 500;

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_VALUE_LENGTH);
}

/**
 * Saca de una query string (o de un objeto plano) los parametros de tracking.
 * Devuelve null si no vino ninguno: sin datos no hay interaccion atribuible y
 * no hay que tocar el last_click.
 */
export function parseTrackingParams(
  source: URLSearchParams | Record<string, unknown> | null | undefined,
  capturedAt: string = new Date().toISOString(),
): AttributionClick | null {
  if (!source) return null;

  const read = (key: string): unknown =>
    source instanceof URLSearchParams ? source.get(key) : source[key];

  const click: AttributionClick = {};
  for (const key of TRACKING_KEYS) {
    const value = clean(read(key));
    if (value) click[key] = value;
  }

  if (Object.keys(click).length === 0) return null;

  click.captured_at = capturedAt;
  return click;
}

/**
 * Lee la forma de CLICKS del jsonb sin confiar en su forma: si viene null, un
 * string o cualquier cosa que no sea un objeto, devuelve una atribucion vacia en
 * vez de romper la ficha del contacto. Ignora la forma canonica y la plana.
 */
export function readClickAttribution(value: unknown): ClickAttribution {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const raw = value as Record<string, unknown>;
  const out: ClickAttribution = {};

  for (const slot of ["first_click", "last_click"] as const) {
    const candidate = raw[slot];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;

    const source = candidate as Record<string, unknown>;
    const click: AttributionClick = {};
    for (const key of TRACKING_KEYS) {
      const v = clean(source[key]);
      if (v) click[key] = v;
    }
    const capturedAt = clean(source.captured_at);
    if (capturedAt) click.captured_at = capturedAt;

    if (Object.keys(click).length > 0) out[slot] = click;
  }

  return out;
}

/**
 * Aplica una interaccion nueva sobre la atribucion que ya tenia el contacto.
 * first_click solo se escribe si estaba vacio; last_click siempre se pisa.
 */
export function mergeAttribution(
  current: unknown,
  incoming: AttributionClick | null,
): ClickAttribution {
  const attribution = readClickAttribution(current);
  if (!incoming || Object.keys(incoming).length === 0) return attribution;

  if (!attribution.first_click) {
    attribution.first_click = { ...incoming };
  }
  attribution.last_click = { ...incoming };

  return attribution;
}

/** True si no hay nada que mostrar, para el empty state de la ficha. */
export function isAttributionEmpty(attribution: Attribution): boolean {
  return !attribution.first_touch && !attribution.last_touch;
}

// ── La lectura canonica (F84) ────────────────────────────────────────────────

const TOUCH_TEXT_KEYS = [
  "occurred_at", "source", "medium", "campaign", "content", "term",
  "social_post_id", "content_post_id", "ad_id", "adset_id", "campaign_id",
  "fbclid", "gclid", "ttclid", "li_fat_id", "ctwa_clid", "referrer_url",
  "landing_page", "origin",
] as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Un toque canonico leido sin confiar en su forma: solo claves conocidas. */
function readTouch(value: unknown): AttributionTouch | undefined {
  if (!isObject(value)) return undefined;

  const touch: AttributionTouch = {};
  for (const key of TOUCH_TEXT_KEYS) {
    const v = clean(value[key]);
    if (v) touch[key] = v;
  }
  if (value.medium_raw === true) touch.medium_raw = true;

  return Object.keys(touch).length > 0 ? touch : undefined;
}

/** Un click de la forma vieja, dicho como un toque. */
function touchFromClick(click: AttributionClick): AttributionTouch {
  const medium = normalizeMedium(click.utm_medium);
  const touch: AttributionTouch = {};

  const source = normalizeSource(click.utm_source);
  if (source) touch.source = source;
  if (medium.medium) touch.medium = medium.medium;
  if (medium.raw) touch.medium_raw = true;
  if (click.utm_campaign) touch.campaign = click.utm_campaign;
  if (click.utm_content) touch.content = click.utm_content;
  if (click.utm_term) touch.term = click.utm_term;
  for (const key of ["fbclid", "gclid", "ad_id", "adset_id", "campaign_id", "referrer_url", "landing_page"] as const) {
    if (click[key]) touch[key] = click[key];
  }
  if (click.captured_at) touch.occurred_at = click.captured_at;

  return touch;
}

/**
 * La forma plana del agendamiento. Se reconoce porque `create_booking` (00099)
 * le pone `source: 'scheduling'`: sin esa marca, un objeto con un `source`
 * suelto podria ser cualquier cosa.
 */
function readFlatBooking(raw: Record<string, unknown>): AttributionTouch | undefined {
  if (clean(raw.source) !== "scheduling") return undefined;

  const touch: AttributionTouch = { source: "scheduling", medium: "booking", origin: "booking" };
  const utm = {
    campaign: clean(raw.utm_campaign),
    content: clean(raw.utm_content),
    term: clean(raw.utm_term),
    fbclid: clean(raw.fbclid),
    gclid: clean(raw.gclid),
    referrer_url: clean(raw.referrer),
  };
  for (const [key, v] of Object.entries(utm)) {
    if (v) (touch as Record<string, string>)[key] = v;
  }
  return touch;
}

/**
 * Lee `contacts.attribution` y devuelve siempre la forma canonica.
 *
 * Entiende las tres formas guardadas (ver la cabecera). Con toques (`first_touch`
 * o `last_touch`) manda esa forma; las viejas se leen solo cuando no hay toques.
 * Cualquier otra cosa, o un valor roto, da una atribucion vacia en vez de romper
 * la ficha del contacto.
 */
export function readAttribution(value: unknown): Attribution {
  if (!isObject(value)) return {};

  const first = readTouch(value.first_touch);
  const last = readTouch(value.last_touch);
  if (first || last) {
    return { ...(first ? { first_touch: first } : {}), ...(last ? { last_touch: last } : {}) };
  }

  const clicks = readClickAttribution(value);
  if (clicks.first_click || clicks.last_click) {
    return {
      ...(clicks.first_click ? { first_touch: touchFromClick(clicks.first_click) } : {}),
      ...(clicks.last_click ? { last_touch: touchFromClick(clicks.last_click) } : {}),
    };
  }

  const flat = readFlatBooking(value);
  if (flat) return { first_touch: flat, last_touch: { ...flat } };

  return {};
}
