import { normalizeForGrouping } from "@/lib/text/normalize";

/**
 * Textos de botón conocidos, escritos a mano (§10.6).
 *
 * Los usa la condición `inbound.is_known_button` (F8). La fuente real es
 * `message_texts.is_button` (F19, `lib/agent/rules/button-texts.ts`, conectada
 * en `lib/agent/runner.ts`): cada negocio tiene sus propios textos de botón,
 * según su propia campaña, y se marcan desde Ajustes → Tareas. Esta lista es
 * un respaldo que se suma a esa fuente, no la reemplaza — vacía por defecto
 * para no sembrar la campaña de ningún cliente en particular.
 */
export const KNOWN_BUTTON_TEXTS: string[] = [];

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
