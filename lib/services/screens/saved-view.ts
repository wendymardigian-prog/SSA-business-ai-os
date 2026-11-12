// @plantilla-quitar(servicios)
/**
 * "Guardar vista" de las listas de Clientes (Servicios A2, F130.1): cada persona guarda como quiere ver cada pestaña
 * (tabla o tablero, filtro rapido y agrupar) y al volver sin nada en la URL se abre asi. Se guarda en el navegador,
 * por persona y por pestaña (ver PENDIENTE: las vistas compartidas de #220 piden pasar estas tablas a la tabla comun).
 * Puro.
 */

/** Los parametros que forman una vista (la busqueda y la pagina no). */
export const VIEW_PARAMS = ["modo", "f", "agrupar"] as const;

export function savedViewKey(table: "servicios" | "clientes", userId: string): string {
  return `ssa:clientes-vista:${table}:${userId}`;
}

/** Lo que se guarda: solo los parametros de la vista, en orden. */
export function viewFromParams(params: URLSearchParams | string): string {
  const src = new URLSearchParams(typeof params === "string" ? params : params.toString());
  const out = new URLSearchParams();
  for (const k of VIEW_PARAMS) {
    const v = src.get(k);
    if (v) out.set(k, v);
  }
  return out.toString();
}

/**
 * La URL a la que hay que ir para aplicar la vista guardada, o null si no hay que moverse: solo cuando la URL no trae
 * ningun parametro de vista (un link con filtros, o una ficha abierta, manda) y lo guardado tiene algo.
 */
export function applySavedView(pathname: string, current: URLSearchParams | string, saved: string | null): string | null {
  if (!saved) return null;
  const cur = new URLSearchParams(typeof current === "string" ? current : current.toString());
  if (VIEW_PARAMS.some((k) => cur.has(k)) || cur.has("vista") || cur.has("servicio") || cur.has("cliente")) return null;
  const view = viewFromParams(saved);
  if (!view) return null;
  for (const [k, v] of new URLSearchParams(view)) cur.set(k, v);
  return `${pathname}?${cur}`;
}
