/**
 * Encabezados de seguridad por ruta (Etapa 4, §15):
 *   - las rutas de `EMBEDDABLE_PREFIXES` se pueden embeber en cualquier sitio
 *     (`frame-ancestors *`): la pagina publica de reserva, el script del embed
 *     y lo demas que vive adentro de un iframe en la web de la persona.
 *   - el resto: no se embebe en ningun lado (`frame-ancestors 'none'` y
 *     `X-Frame-Options: DENY`), que es lo que cierra el clickjacking en las
 *     pantallas internas.
 *
 * Puro y con test: next.config lo convierte a su formato.
 */

export interface SecurityHeader {
  key: string;
  value: string;
}

export const EMBEDDABLE_PREFIXES = ["/calendario", "/embed", "/f"] as const; // @plantilla-quitar(formularios)
// @plantilla-sin(formularios): export const EMBEDDABLE_PREFIXES = ["/calendario", "/embed"] as const;

export function isEmbeddablePath(path: string): boolean {
  return EMBEDDABLE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function securityHeadersFor(path: string): SecurityHeader[] {
  const common: SecurityHeader[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  ];
  if (isEmbeddablePath(path)) {
    return [{ key: "Content-Security-Policy", value: "frame-ancestors *" }, ...common];
  }
  return [
    { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    { key: "X-Frame-Options", value: "DENY" },
    ...common,
  ];
}

/** Lo que next.config.ts devuelve en `headers()`: primero las embebibles, despues el resto. */
export function nextHeadersConfig(): Array<{ source: string; headers: SecurityHeader[] }> {
  return [
    { source: "/calendario/:path*", headers: securityHeadersFor("/calendario/x") },
    { source: "/embed/:path*", headers: securityHeadersFor("/embed/x") },
    { source: "/f/:path*", headers: securityHeadersFor("/f/x") }, // @plantilla-quitar(formularios)
    // `f/` con la barra: excluye solo /f/..., no a /favicon.ico ni a /formulario.  @plantilla-quitar(formularios)
    { source: "/((?!calendario|embed|f/).*)", headers: securityHeadersFor("/dashboard") }, // @plantilla-quitar(formularios)
    // @plantilla-sin(formularios): { source: "/((?!calendario|embed).*)", headers: securityHeadersFor("/dashboard") },
  ];
}
