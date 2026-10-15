/**
 * El código de atribución de una pieza y cómo se usa en un link (Extra I, F38).
 *
 * El código (`c8k2f`) lo completa la base al crear la pieza (`content_posts.attribution_code`). Para atribuir una visita a la
 * pieza basta con ponerlo en `utm_content`. Modulo PURO.
 */

export interface AttributionCodeHint {
  code: string;
  /** El parámetro listo para pegar al final de un link: `?utm_content=c8k2f`. */
  param: string;
}

/** El código limpio y el parámetro de ejemplo. Sin código (pieza vieja, dato roto) devuelve null: no se muestra nada. */
export function attributionCodeHint(code: string | null | undefined): AttributionCodeHint | null {
  const clean = typeof code === "string" ? code.trim() : "";
  if (!clean) return null;
  return { code: clean, param: `?utm_content=${encodeURIComponent(clean)}` };
}
