/**
 * Crear una pieza desde el drawer.
 *
 * "Nuevo post" ya no abre un modal con un formulario aparte: crea el borrador
 * en el momento y abre el drawer de esa pieza, donde se escribe todo (formato,
 * redes, guion, archivos) con el guardado automatico de siempre.
 *
 * Para eso la pieza necesita un titulo desde el primer segundo (la base lo
 * exige): arranca con este, y el drawer lo deja seleccionado para escribir
 * encima sin borrar nada. Arranca SIN redes: antes el modal dejaba marcada la
 * primera conectada, que era una red cualquiera y obligaba a sacarla. Ahora se
 * agregan, con su boton, las que la pieza realmente usa.
 */

export const NEW_POST_TITLE = "Sin título";

/** Si el titulo todavia es el que puso el sistema (nadie lo escribio). */
export function isPlaceholderTitle(title: string): boolean {
  return title.trim() === NEW_POST_TITLE;
}
