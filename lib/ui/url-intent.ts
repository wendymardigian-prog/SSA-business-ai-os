/**
 * El link que manda una orden a una pantalla (`?nuevo=modulo`): lo arma el servidor para un boton de la barra superior
 * y lo ejecuta el componente con `useUrlIntent` (Servicios A2, F130.0). Vive aca y no junto al hook porque un archivo
 * `"use client"` no se puede llamar desde el servidor: la pagina del programa se caia entera.
 */
export function intentHref(base: string, param: string, value: string): string {
  return `${base}${base.includes("?") ? "&" : "?"}${encodeURIComponent(param)}=${encodeURIComponent(value)}`;
}
