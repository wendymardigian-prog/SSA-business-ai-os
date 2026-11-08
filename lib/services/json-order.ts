// @plantilla-quitar(servicios)
/**
 * Las claves de un objeto en el orden en que las recorre Postgres en un `jsonb`
 * (`jsonb_object_keys`): primero las mas cortas y, a igual largo, por sus bytes.
 *
 * Las validaciones gemelas (TS y SQL) recorren las claves en este orden para que los mensajes salgan
 * en el mismo orden en las dos. Las claves de la configuracion son ASCII: comparar por codigo alcanza.
 */
export function jsonbKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
}

/** Las claves que no estan permitidas, en el orden de Postgres, como mensajes. */
export function unknownKeyProblems(obj: Record<string, unknown>, allowed: readonly string[]): string[] {
  return jsonbKeys(obj)
    .filter((k) => !allowed.includes(k))
    .map((k) => `clave desconocida: ${k}`);
}
