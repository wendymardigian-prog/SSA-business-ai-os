/**
 * Atribucion de un contacto (F10).
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

export interface Attribution {
  first_click?: AttributionClick;
  last_click?: AttributionClick;
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
 * Lee el jsonb de la base sin confiar en su forma: si viene null, un string o
 * cualquier cosa que no sea un objeto, devuelve una atribucion vacia en vez de
 * romper la ficha del contacto.
 */
export function readAttribution(value: unknown): Attribution {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const raw = value as Record<string, unknown>;
  const out: Attribution = {};

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
): Attribution {
  const attribution = readAttribution(current);
  if (!incoming || Object.keys(incoming).length === 0) return attribution;

  if (!attribution.first_click) {
    attribution.first_click = { ...incoming };
  }
  attribution.last_click = { ...incoming };

  return attribution;
}

/** True si no hay nada que mostrar, para el empty state de la ficha. */
export function isAttributionEmpty(attribution: Attribution): boolean {
  return !attribution.first_click && !attribution.last_click;
}
