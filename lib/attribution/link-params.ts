/**
 * Parametros de atribucion en los links que manda un flujo (Extra I, F39).
 *
 * Con "Agregar parametros de atribucion" encendido, cada link de un mensaje sale con cuatro UTM:
 *
 *   utm_source    la plataforma del canal (`instagram`, `whatsapp`, `facebook`, `tiktok`, `email`)
 *   utm_medium    `dm`
 *   utm_campaign  el nombre del flujo, como slug (sin tildes, hasta 60 caracteres)
 *   utm_content   el codigo de la pieza si el flujo arranco desde una (`c8k2f`); si no, `f-` + los primeros 8
 *                 caracteres del id del flujo
 *
 * Reglas que no se negocian:
 *   - NUNCA se pisa un parametro que la URL ya trae (`utm_source=bio` se queda en `bio`);
 *   - el `#hash` se conserva donde estaba;
 *   - lo que no es `http(s)` no se toca;
 *   - los links de CHAT (`wa.me`, `m.me`, `instagram.com/…`, `ig.me`…) no se tocan: no son un destino sino una
 *     conversacion, y agregarles parametros no atribuye nada;
 *   - la URL se arma por texto (no se re-serializa con `URL`), asi lo que ya estaba en el link sale byte a byte igual.
 *
 * Modulo PURO. Nunca lanza: ante una URL que no se puede leer, la devuelve igual que llego.
 */
import { slugify } from "@/lib/scheduling/slug";

/** Quien manda el link y desde donde. */
export interface LinkAttributionContext {
  /** La plataforma del canal por el que sale el mensaje: instagram, whatsapp, facebook, tiktok, email. */
  platform: string | null | undefined;
  /** El nombre del flujo (se convierte en `utm_campaign`). */
  flowName: string | null | undefined;
  /** El id del flujo (de ahi salen los 8 caracteres de `utm_content` cuando no hay pieza). */
  flowId: string | null | undefined;
  /** El codigo de atribucion de la pieza (`content.code`), si el flujo arranco desde una. */
  contentCode?: string | null;
}

export const MAX_CAMPAIGN_LENGTH = 60;
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content"] as const;
type UtmKey = (typeof UTM_KEYS)[number];

/** Dominios de chat: se comparan como el dominio exacto o un subdominio suyo. */
const CHAT_HOSTS = ["wa.me", "wa.link", "api.whatsapp.com", "m.me", "ig.me", "instagram.com"];

/** ¿Es un link de chat (no se le agregan parametros)? Una URL que no se puede leer cuenta como "no tocar". */
export function isChatLink(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return CHAT_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return true;
  }
}

/** El slug del nombre del flujo para `utm_campaign`: ASCII, guiones, hasta 60 caracteres, sin guion final. */
export function campaignSlug(flowName: string | null | undefined): string {
  return slugify(flowName ?? "").slice(0, MAX_CAMPAIGN_LENGTH).replace(/-+$/, "");
}

/** `f-` + los primeros 8 caracteres del id del flujo (sin guiones, en minusculas). Vacio si no hay id. */
export function flowCode(flowId: string | null | undefined): string {
  const compact = (flowId ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  return compact ? `f-${compact}` : "";
}

/**
 * Los parametros que se agregarian, en orden. Un parametro sin valor posible (sin plataforma, por ejemplo) no
 * esta en la lista: no se agrega `utm_source=` vacio.
 */
export function attributionParams(ctx: LinkAttributionContext): Array<{ key: UtmKey; value: string }> {
  const platform = (ctx.platform ?? "").trim().toLowerCase();
  const slug = campaignSlug(ctx.flowName);
  const code = (ctx.contentCode ?? "").trim();
  const campaign = slug || flowCode(ctx.flowId);
  const content = code || flowCode(ctx.flowId);

  const out: Array<{ key: UtmKey; value: string }> = [];
  if (platform) out.push({ key: "utm_source", value: platform });
  out.push({ key: "utm_medium", value: "dm" });
  if (campaign) out.push({ key: "utm_campaign", value: campaign });
  if (content) out.push({ key: "utm_content", value: content });
  return out;
}

/** Las claves de consulta que la URL ya trae, en minusculas (`UTM_Source` cuenta como `utm_source`). */
function existingKeys(query: string): Set<string> {
  const keys = new Set<string>();
  for (const part of query.split("&")) {
    if (!part) continue;
    const raw = part.split("=")[0];
    let key = raw;
    try {
      key = decodeURIComponent(raw.replace(/\+/g, " "));
    } catch {
      // Una clave mal codificada se compara tal cual.
    }
    keys.add(key.toLowerCase());
  }
  return keys;
}

/**
 * La URL con los parametros de atribucion. Si no corresponde tocarla (no es http(s), es un link de chat, no se
 * puede leer o ya trae los cuatro), se devuelve EXACTAMENTE igual.
 */
export function buildAttributedUrl(url: string, ctx: LinkAttributionContext): string {
  try {
    if (typeof url !== "string") return url;
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) return url;
    if (isChatLink(trimmed)) return url;

    const hashAt = trimmed.indexOf("#");
    const beforeHash = hashAt === -1 ? trimmed : trimmed.slice(0, hashAt);
    const hash = hashAt === -1 ? "" : trimmed.slice(hashAt);

    const queryAt = beforeHash.indexOf("?");
    const query = queryAt === -1 ? "" : beforeHash.slice(queryAt + 1);
    const present = existingKeys(query);

    const additions = attributionParams(ctx)
      .filter((p) => !present.has(p.key))
      .map((p) => `${p.key}=${encodeURIComponent(p.value)}`);
    if (additions.length === 0) return url;

    // `?` solo, o una consulta que ya termina en `&`, no necesitan otro separador.
    let separator = "&";
    if (queryAt === -1) separator = "?";
    else if (query === "" || query.endsWith("&")) separator = "";

    return `${beforeHash}${separator}${additions.join("&")}${hash}`;
  } catch {
    return url;
  }
}

/** Una URL `http(s)://…` dentro de un texto: conservadora, termina en espacio o en un caracter que no puede ir en un link. */
const URL_IN_TEXT = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}»”’]+$/;

/**
 * Reemplaza cada URL `http(s)` de un texto por lo que devuelva `fn`. La puntuacion final ("…mira https://a.com.")
 * queda fuera del link y vuelve a su lugar; un `)` final se considera parte del link solo si la URL abre un `(`.
 */
export function mapUrlsInText(text: string, fn: (url: string) => string): string {
  if (typeof text !== "string" || text === "") return text;
  return text.replace(URL_IN_TEXT, (match) => {
    let url = match;
    let tail = "";
    const stripped = url.match(TRAILING_PUNCTUATION);
    if (stripped) {
      let cut = stripped[0];
      // `https://es.wikipedia.org/wiki/Foo_(bar)`: el ")" es del link.
      if (cut.startsWith(")") && url.includes("(") && (url.match(/\(/g) ?? []).length > (url.slice(0, url.length - cut.length).match(/\)/g) ?? []).length) {
        cut = cut.slice(1);
      }
      tail = cut;
      url = url.slice(0, url.length - cut.length);
    }
    if (!url) return match;
    try {
      return fn(url) + tail;
    } catch {
      return match;
    }
  });
}

/** Un texto con los parametros de atribucion en cada link que trae. */
export function attributeText(text: string, ctx: LinkAttributionContext): string {
  return mapUrlsInText(text, (url) => buildAttributedUrl(url, ctx));
}

export interface AttributionExampleInput {
  ctx: LinkAttributionContext;
  /** El link de ejemplo (si no, uno de muestra). */
  exampleUrl?: string;
  /** El titulo de la pieza del ejemplo ("Reel: 3 errores al vender"), si el disparador es de contenido. */
  pieceTitle?: string | null;
  /** Que paso, en palabras: "un comentario" (por defecto), "una respuesta a tu historia"… */
  triggerLabel?: string;
}

export interface AttributionExample {
  /** El link de ejemplo, como lo escribe la persona. */
  before: string;
  /** Como sale con los parametros. */
  after: string;
  /** Los parametros que se agregan (los del panel). */
  params: Array<{ key: UtmKey; value: string }>;
  /** Solo si el flujo no arranca desde una pieza: por que `utm_content` es el codigo del flujo. */
  contentNote: string | null;
  /** El texto completo del panel. */
  text: string;
}

const SAMPLE_URL = "https://tu-sitio.com/programa";

/** El ejemplo armado del panel ("Con un comentario en «Reel…», el link … sale como …"). */
export function describeAttributionExample(input: AttributionExampleInput): AttributionExample {
  const before = input.exampleUrl?.trim() || SAMPLE_URL;
  const after = buildAttributedUrl(before, input.ctx);
  const params = attributionParams(input.ctx);

  const hasPiece = Boolean((input.ctx.contentCode ?? "").trim());
  const trigger = input.triggerLabel?.trim() || "un comentario";
  const title = input.pieceTitle?.trim();

  const lead = hasPiece && title ? `Con ${trigger} en «${title}»` : hasPiece ? `Con ${trigger} en una pieza` : `Con ${trigger}`;
  const sentence = `${lead}, el link \`${before}\` sale como \`${after}\`.`;

  const code = flowCode(input.ctx.flowId);
  const contentNote = hasPiece
    ? null
    : `utm_content = el código del flujo${code ? ` (\`${code}\`)` : ""} porque este flujo no arranca desde una pieza.`;

  return { before, after, params, contentNote, text: contentNote ? `${sentence} ${contentNote}` : sentence };
}
