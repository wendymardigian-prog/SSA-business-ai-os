import type { OutputGuardrails } from "./schemas";
import { findPhrase, normalizeText } from "./text";

/**
 * Guardarrailes sobre la salida del agente (lo que se le va a mandar al lead o
 * a guardar como borrador). A diferencia de lib/agent/guardrails.ts, que mira
 * el mensaje ENTRANTE antes del modelo, esto mira el texto SALIENTE despues del
 * modelo. Funcion pura: recibe el texto y la config, junta todos los hallazgos.
 *
 * Cuatro reglas, cada una con su switch en agents.guardrails:
 *   - links fuera de la lista blanca (solo corre si la lista no esta vacia)
 *   - palabras prohibidas (default: ScaleOS)
 *   - escasez inventada (cupos, quedan N, ...)
 *   - cifras con $ que no esten en una lista blanca
 *
 * La deteccion de links se comparte con la herramienta generar_link_whatsapp
 * (stripLinks): una sola definicion de "esto parece un link".
 */

// TLDs comunes, para no confundir "Ok.Gracias" con un dominio. Multi-parte
// primero (co.uk) para que gane sobre uk.
const TLDS = [
  "com.ar", "com.mx", "com.br", "co.uk", "com.co",
  "com", "net", "org", "me", "io", "co", "cr", "ar", "mx", "es", "app", "dev",
  "ai", "link", "info", "biz", "us", "uk", "pe", "cl", "gg", "to", "sh",
];

const TLD_ALT = TLDS.map((t) => t.replace(/\./g, "\\.")).join("|");

/**
 * Encuentra links en un texto: con protocolo, con www., o dominios pelados con
 * un TLD conocido, con o sin camino. Case-insensitive. Global.
 */
const LINK_RE = new RegExp(
  String.raw`(?:https?:\/\/|www\.)[^\s<>"']+` +
    String.raw`|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:${TLD_ALT})(?:\/[^\s<>"']*)?`,
  "giu",
);

export function extractLinks(text: string): string[] {
  const matches = text.match(LINK_RE) ?? [];
  // Sacar puntuacion de cierre pegada al final (por ejemplo "wa.me/x." o ")").
  return matches.map((m) => m.replace(/[.,;:!?)"'\]]+$/g, ""));
}

/**
 * Saca del texto cualquier cosa que parezca un link o dominio. Lo usa el
 * contexto del lead antes de armar el mensaje de WhatsApp: no queremos la URL
 * de un lead adentro de nuestro link.
 */
export function stripLinks(text: string): string {
  return text.replace(LINK_RE, " ");
}

/** host + camino normalizados: sin protocolo, sin www., sin query ni fragmento. */
export function normalizeLink(url: string): { host: string; path: string } {
  let s = url.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  s = s.split(/[?#]/)[0];
  const slash = s.indexOf("/");
  const host = (slash === -1 ? s : s.slice(0, slash)).toLowerCase().replace(/\.+$/, "");
  let path = slash === -1 ? "" : s.slice(slash);
  path = path.replace(/\/+$/, "").replace(/[.,;:!?)"'\]]+$/g, "");
  return { host, path };
}

/**
 * Un link esta permitido si su host y su camino coinciden con una entrada de la
 * lista. Una entrada sin camino permite todo el host. Una entrada con camino
 * exige ese camino o un subcamino por segmento: "wa.me/5491100000000" NO permite
 * "wa.me/54911000000000" (otro numero), pero "sitio.com/a" permite "sitio.com/a/b".
 */
export function linkAllowed(url: string, list: string[]): boolean {
  const link = normalizeLink(url);
  return list.some((raw) => {
    const entry = normalizeLink(raw);
    if (entry.host !== link.host) return false;
    if (entry.path === "") return true;
    if (link.path === entry.path) return true;
    return link.path.startsWith(entry.path + "/");
  });
}

export type OutputGuardrailHit = {
  rule: "link" | "palabra_prohibida" | "escasez" | "cifra";
  text: string;
};

export type OutputGuardrailResult = { ok: true } | { ok: false; hits: OutputGuardrailHit[] };

// Una cifra con signo de peso/dolar: "$497", "497 $", "US$ 1.200".
const MONEY_RE = /(?:\$|US\$|USD)\s?\d[\d.,]*|\d[\d.,]*\s?(?:\$|US\$|USD)/giu;

/** Solo los digitos y separadores de una cifra, para comparar con la lista blanca. */
function moneyDigits(match: string): string {
  return match.replace(/[^\d.,]/g, "");
}

/**
 * Una frase de escasez donde "N" representa "un numero cualquiera": "quedan N"
 * matchea "quedan 3". El resto de las frases son palabras completas.
 */
function scarcityHit(text: string, phrases: string[]): string | null {
  const haystack = normalizeText(text);
  for (const phrase of phrases) {
    if (/\bN\b/.test(phrase)) {
      const norm = normalizeText(phrase).replace(/\bn\b/g, String.raw`\d[\d.,]*`);
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${norm}($|[^\\p{L}\\p{N}])`, "u");
      if (re.test(haystack)) return phrase;
    } else if (findPhrase(text, [phrase])) {
      return phrase;
    }
  }
  return null;
}

export function checkOutputGuardrails(
  text: string,
  guardrails: OutputGuardrails,
  options: { allowedLinks?: string[] } = {},
): OutputGuardrailResult {
  const hits: OutputGuardrailHit[] = [];

  // Links: la lista efectiva es lo configurado mas el link que genero la
  // herramienta en este turno (sale del numero del negocio, no del modelo).
  const configured = guardrails.linksPermitidos ?? [];
  if (configured.length > 0) {
    const allow = [...configured, ...(options.allowedLinks ?? [])];
    for (const link of extractLinks(text)) {
      if (!linkAllowed(link, allow)) hits.push({ rule: "link", text: link });
    }
  }

  if (guardrails.palabrasProhibidas.enabled) {
    const hit = findPhrase(text, guardrails.palabrasProhibidas.phrases);
    if (hit) hits.push({ rule: "palabra_prohibida", text: hit });
  }

  if (guardrails.escasezInventada.enabled) {
    const hit = scarcityHit(text, guardrails.escasezInventada.phrases);
    if (hit) hits.push({ rule: "escasez", text: hit });
  }

  if (guardrails.cifras.enabled) {
    const permitidas = new Set(guardrails.cifras.permitidas.map(moneyDigits));
    for (const match of text.match(MONEY_RE) ?? []) {
      if (!permitidas.has(moneyDigits(match))) hits.push({ rule: "cifra", text: match.trim() });
    }
  }

  return hits.length > 0 ? { ok: false, hits } : { ok: true };
}

/** Etiqueta corta de una regla, para mensajes y el detalle del run. */
export function outputRuleLabel(rule: OutputGuardrailHit["rule"]): string {
  switch (rule) {
    case "link":
      return "un link fuera de la lista permitida";
    case "palabra_prohibida":
      return "una palabra prohibida";
    case "escasez":
      return "escasez inventada";
    case "cifra":
      return "una cifra de dinero";
  }
}
