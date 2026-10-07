/**
 * Los textos de botón que salen de la base, para la condición
 * `inbound.is_known_button` (F8, F19).
 *
 * La fuente real es `message_texts.is_button`, que cada negocio edita en
 * Ajustes → Tareas según su propia campaña, y esta función es la que
 * convierte esas filas en lo que la condición espera. `lib/agent/runner.ts`
 * consulta `BUTTON_TEXTS_QUERY` y pasa el resultado como `knownButtonExtra`.
 *
 * Las dos fuentes se suman, no se reemplazan: `isKnownButtonText` compara
 * contra `KNOWN_BUTTON_TEXTS` (vacía por defecto) Y contra este extra.
 */

/** Una fila de `message_texts` con lo poco que hace falta. */
export interface ButtonTextRow {
  normalized_text: string | null;
  is_button?: boolean | null;
}

/**
 * Los textos de botón de la base, listos para `knownButtonExtra`.
 *
 * Devuelve los normalizados: la comparación ya normaliza los dos lados, así que
 * pasar el texto original sería hacer el trabajo dos veces. Sin filas útiles
 * devuelve una lista vacía, y la condición sigue funcionando con la constante.
 */
export function buttonTextsFromRows(rows: ButtonTextRow[] | null | undefined): string[] {
  if (!Array.isArray(rows)) return [];
  const out = new Set<string>();
  for (const row of rows) {
    // `is_button` ausente se toma como que sí: quien consultó ya filtró por eso.
    if (row?.is_button === false) continue;
    const text = row?.normalized_text?.trim();
    if (text) out.add(text);
  }
  return [...out];
}

/** La consulta que hay que hacer para alimentarla, en un solo lugar. */
export const BUTTON_TEXTS_QUERY = {
  table: "message_texts",
  columns: "normalized_text, is_button",
  /** Solo entrantes: un botón lo toca el lead, nunca sale del sistema. */
  direction: "inbound",
} as const;
