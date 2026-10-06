/**
 * El drawer de contenido vive en la URL (F95, F96).
 *
 * `?idea=<id>` abre la galeria de ideas y `?piece=<id>` abre la pieza. En la
 * URL y no en el estado de un componente por las mismas razones que la vista y
 * los filtros: se comparte con un link, "atras" cierra el drawer, y las rutas
 * viejas (`/dashboard/content/<id>/edit`) pueden redirigir aca (F99).
 *
 * Lo abre un link comun: asi una tarjeta se puede abrir en otra pestaña, y el
 * servidor trae los datos de esa pieza en el mismo viaje.
 */

export type DrawerTarget = { kind: "idea"; id: string } | { kind: "piece"; id: string } | null;

const BASE = "/dashboard/content";

/** Un uuid o algo con su forma: nada que pueda ser otra cosa que un id. */
const ID_SHAPE = /^[0-9a-f][0-9a-f-]{7,63}$/i;

/** Lee que drawer pide la URL. Un id con forma rara no abre nada. */
export function parseDrawer(
  params: URLSearchParams | Record<string, string | undefined>,
): DrawerTarget {
  const get = (key: string): string | null => {
    const value = params instanceof URLSearchParams ? params.get(key) : params[key];
    const trimmed = (value ?? "").trim();
    return ID_SHAPE.test(trimmed) ? trimmed : null;
  };

  // La pieza gana: es lo ultimo que se abre cuando se aprueba una idea y se
  // pide el copy (la URL puede traer todavia el ?idea= de antes).
  const piece = get("piece");
  if (piece) return { kind: "piece", id: piece };

  const idea = get("idea");
  if (idea) return { kind: "idea", id: idea };

  return null;
}

/** El link que abre ese drawer (o lo cierra, con null), conservando la vista y los filtros. */
export function drawerHref(current: URLSearchParams, target: DrawerTarget): string {
  const next = new URLSearchParams(current.toString());
  next.delete("idea");
  next.delete("piece");
  if (target) next.set(target.kind, target.id);

  const query = next.toString();
  return query ? `${BASE}?${query}` : BASE;
}

export function closeHref(current: URLSearchParams): string {
  return drawerHref(current, null);
}
