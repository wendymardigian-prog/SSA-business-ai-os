/**
 * La atribución que viaja entre páginas (F29). PURA y sin dependencias de servidor:
 * la usan el seguimiento de las páginas del sitio (cookie `ssa_attr`), el script de
 * embed (`localStorage` de la web que lo contiene) y el servidor al volver a leerla.
 *
 * Qué se guarda: la PRIMERA visita con datos de anuncio y la ÚLTIMA. Una visita sin
 * UTM, id de clic ni id de anuncio no es un toque: no cambia nada (la persona que
 * vuelve por el menú no pisa la campaña que la trajo). `first` nunca se pisa.
 *
 * Todo lo que se lee se vuelve a limpiar: solo claves de atribución conocidas, solo
 * texto de hasta 200 caracteres, nada de más de 90 días, nada de más de 3,5 KB.
 *
 * La URL de entrada (`entry_url`, plano formularios-ui F18) es la unica que puede tener hasta 2000
 * caracteres: tiene su propio saneo (`entryUrlFrom`) y es lo PRIMERO que se suelta si no entra.
 */
import { ATTRIBUTION_KEYS, MAX_VALUE_LENGTH, TOUCH_KEYS, VISIT_META_KEYS } from "./keys";
import { hasTouchKeys } from "./collect";
import { ENTRY_URL_KEY, entryUrlFrom } from "./entry-url";
import type { Attribution, StoredAttribution, Visit } from "./types";

/** El nombre de la cookie (sitio) y de la clave de `localStorage` (web externa). */
export const STORE_KEY = "ssa_attr";
export const MAX_STORED_BYTES = 3500;
export const MAX_AGE_DAYS = 90;
const DAY_MS = 86_400_000;
export const MAX_AGE_MS = MAX_AGE_DAYS * DAY_MS;

/** Lo que se guarda de una visita: las claves de toque más la página de llegada y el referrer. */
const VISIT_KEYS: readonly string[] = [...TOUCH_KEYS, "landing_page", "referrer_url"];

const EMPTY: StoredAttribution = { v: 1 };

function bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_VALUE_LENGTH);
  return cleaned === "" ? null : cleaned;
}

/** Una visita guardada, ya saneada. `null` si no sirve (sin sello de tiempo, vencida, sin ninguna clave de toque). */
function cleanVisit(raw: unknown, now: number): Visit | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const ts = input.ts;
  if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
  if (now - ts > MAX_AGE_MS || ts - now > DAY_MS) return null;

  const visit: Visit = { ts };
  let touch = false;
  for (const key of VISIT_KEYS) {
    const value = cleanText(input[key]);
    if (!value) continue;
    visit[key] = value;
    if (TOUCH_KEYS.includes(key)) touch = true;
  }
  const entry = entryUrlFrom(input[ENTRY_URL_KEY]);
  if (entry) visit[ENTRY_URL_KEY] = entry;
  return touch ? visit : null;
}

/** Lo guardado, o vacío si el texto está roto, es de otra versión o pesa de más. Nunca lanza. */
export function parseStored(raw: string | null | undefined, now: number = Date.now()): StoredAttribution {
  if (!raw || typeof raw !== "string" || bytes(raw) > MAX_STORED_BYTES) return { ...EMPTY };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...EMPTY };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ...EMPTY };
  const input = parsed as Record<string, unknown>;
  if (input.v !== 1) return { ...EMPTY };

  const first = cleanVisit(input.first, now);
  const last = cleanVisit(input.last, now);
  const out: StoredAttribution = { v: 1 };
  if (first) out.first = first;
  if (last) out.last = last;
  return out;
}

/** La visita actual como lo que se guarda (sin cookies ni datos de la persona). */
function toVisit(current: Attribution, now: number): Visit {
  const visit: Visit = { ts: now };
  for (const key of VISIT_KEYS) {
    const value = cleanText(current[key]);
    if (value) visit[key] = value;
  }
  const entry = entryUrlFrom(current[ENTRY_URL_KEY]);
  if (entry) visit[ENTRY_URL_KEY] = entry;
  return visit;
}

/**
 * Suma una visita. Con UTM, id de clic o de anuncio es un toque nuevo: pasa a ser la
 * última y, si no había primera, también la primera. Sin nada de eso devuelve LO MISMO
 * (el mismo objeto), y la primera no se pisa nunca.
 */
export function recordVisit(stored: StoredAttribution | null | undefined, current: Attribution, now: number = Date.now()): StoredAttribution {
  const base: StoredAttribution = stored && stored.v === 1 ? stored : { ...EMPTY };
  if (!hasTouchKeys(current)) return base;
  const visit = toVisit(current, now);
  return { v: 1, first: base.first ?? visit, last: visit };
}

/**
 * El texto para guardar, de hasta 3,5 KB (o `maxBytes`). Si no entra, se sueltan
 * primero la URL de entrada (la de la primera visita, despues la de la ultima) y
 * recien despues el referrer y la pagina de llegada: las UTM nunca se pierden.
 */
export function serializeStored(stored: StoredAttribution, maxBytes: number = MAX_STORED_BYTES): string {
  const trimmed = (visit: Visit | undefined, drop: readonly string[]): Visit | undefined => {
    if (!visit) return undefined;
    const copy: Visit = { ts: visit.ts };
    for (const [key, value] of Object.entries(visit)) {
      if (key === "ts" || drop.includes(key)) continue;
      // La URL de entrada se sanea con su propia regla (hasta 2000), el resto se recorta a 200.
      const text = key === ENTRY_URL_KEY ? entryUrlFrom(value) : cleanText(value);
      if (text) copy[key] = text;
    }
    return copy;
  };
  const build = (dropFirst: readonly string[], dropLast: readonly string[]): string => {
    const out: StoredAttribution = { v: 1 };
    const first = trimmed(stored.first, dropFirst);
    const last = trimmed(stored.last, dropLast);
    if (first) out.first = first;
    if (last) out.last = last;
    return JSON.stringify(out);
  };

  const pages = ["referrer_url", "landing_page"] as const;
  const attempts: Array<[readonly string[], readonly string[]]> = [
    [[], []],
    [[ENTRY_URL_KEY], []],
    [[ENTRY_URL_KEY], [ENTRY_URL_KEY]],
    [[ENTRY_URL_KEY, "referrer_url"], [ENTRY_URL_KEY, "referrer_url"]],
    [[ENTRY_URL_KEY, ...pages], [ENTRY_URL_KEY, ...pages]],
  ];
  for (const [dropFirst, dropLast] of attempts) {
    const text = build(dropFirst, dropLast);
    if (bytes(text) <= maxBytes) return text;
  }
  // Último recurso: solo la última visita, sin páginas.
  const text = JSON.stringify({ v: 1, last: trimmed(stored.last, [ENTRY_URL_KEY, ...pages]) });
  return bytes(text) <= maxBytes ? text : JSON.stringify({ v: 1 });
}

/** Las claves que una visita guardada puede tener (para tests y documentación). */
export const STORED_VISIT_KEYS = VISIT_KEYS;
export { ATTRIBUTION_KEYS, VISIT_META_KEYS };
