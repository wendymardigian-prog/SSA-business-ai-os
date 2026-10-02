/**
 * El buscador de Broadcasts, Sequences y Growth (Bloque I, I4).
 *
 * Las tres pantallas cargan su lista entera (no paginan), asi que buscar es
 * filtrar en el cliente lo que ya llego. Sin mayusculas ni tildes: "promocion"
 * encuentra "Promoción". Modulo puro.
 *
 * La Bandeja NO usa esto: su busqueda la resuelve el servidor por
 * `contacts.display_name` y no cambia en este bloque.
 */

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Alguno de los textos contiene la busqueda. Sin busqueda, todo coincide. */
export function matchesSearch(query: string, ...texts: (string | null | undefined)[]): boolean {
  const needle = normalize(query);
  if (!needle) return true;
  return texts.some((text) => !!text && normalize(text).includes(needle));
}
