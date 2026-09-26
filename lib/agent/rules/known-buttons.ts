import { normalizeForGrouping } from "@/lib/text/normalize";

/**
 * Textos de botón conocidos para sembrar (§10.6, datos reales al 25/09/2026,
 * verificados contra la base: los 12 coinciden exactamente).
 *
 * Los usa la condición `inbound.is_known_button` (F8). En el Bloque 4 la fuente
 * pasa a ser `message_texts.is_button`; esta lista es la que la siembra (F19) y
 * la que se usa mientras la tabla no exista.
 */
export const KNOWN_BUTTON_TEXTS: string[] = [
  "si enviamelo",
  "quiero aprender",
  "tengo un negocio",
  "tengo una base",
  "si quiero a clase",
  "si quiero la clase",
  "generar contenido",
  "empiezo de 0",
  "automatizar todo",
  "equipo ventas ia",
  "agentes",
  "responder mensajes",
];

const NORMALIZED = new Set(KNOWN_BUTTON_TEXTS.map((t) => normalizeForGrouping(t)));

/** ¿El texto normalizado del mensaje es un botón conocido? */
export function isKnownButtonText(text: string | null | undefined, extra?: Iterable<string>): boolean {
  const n = normalizeForGrouping(text);
  if (!n) return false;
  if (NORMALIZED.has(n)) return true;
  if (extra) {
    for (const e of extra) {
      if (normalizeForGrouping(e) === n) return true;
    }
  }
  return false;
}
