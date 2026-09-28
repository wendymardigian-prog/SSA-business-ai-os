/**
 * Encabezados de seguridad por ruta (Etapa 4, §15).
 *
 * Hasta la Etapa 4 la app no mandaba ninguno. Ahora:
 *   - /calendario/* y /embed/*: se pueden embeber en cualquier sitio
 *     (`frame-ancestors *`). Es la pagina publica de reserva y el script del
 *     embed, que viven adentro de un iframe en la web de la persona.
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

export const EMBEDDABLE_PREFIXES = ["/calendario", "/embed"] as const;

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
    { source: "/((?!calendario|embed).*)", headers: securityHeadersFor("/dashboard") },
  ];
}
