/**
 * Rutas con puntos sobre un payload ("data.user.email", "items.0.price").
 *
 * Una sola implementacion para el id del envio (idempotencia), el mapeo del paso
 * de contacto y el arbol de variables: tres lugares que lean rutas distinto
 * terminarian eligiendo campos distintos. Puro, sin dependencias, y NUNCA lanza.
 */

/** Un valor que se puede tratar como "dato escalar" de un payload. */
export type Scalar = string | number | boolean;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Las partes de una ruta; vacia si la ruta no sirve. */
export function splitPath(path: unknown): string[] {
  if (typeof path !== "string") return [];
  const parts = path.trim().split(".").map((p) => p.trim());
  return parts.length > 0 && parts.every((p) => p !== "") ? parts : [];
}

/**
 * El valor en esa ruta, o undefined. Las claves "__proto__", "constructor" y
 * "prototype" nunca se siguen: el payload es dato de afuera.
 */
export function getByPath(root: unknown, path: unknown): unknown {
  const parts = splitPath(path);
  if (parts.length === 0) return undefined;
  let current: unknown = root;
  for (const part of parts) {
    if (part === "__proto__" || part === "constructor" || part === "prototype") return undefined;
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(part)) return undefined;
      current = current[Number(part)];
    } else if (isObject(current)) {
      if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined;
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
}

/** Un texto o numero como texto recortado; el resto (objeto, vacio, null) es null. */
export function scalarText(value: unknown, maxLength = 500): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed.slice(0, maxLength);
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return null;
}
