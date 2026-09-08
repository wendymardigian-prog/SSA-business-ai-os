/**
 * Lectura de parametros de la URL en Server Components.
 *
 * Los filtros de las pantallas viven en la URL (para que una vista filtrada se
 * pueda compartir o guardar en favoritos), y eso significa que su contenido lo
 * escribe cualquiera: hay que tratarlo como entrada no confiable.
 *
 * Tres cosas que resuelven estos helpers y que antes estaban sueltas en cada
 * pantalla:
 *
 * 1. Next entrega `string | string[] | undefined` porque un parametro puede
 *    venir repetido (`?tag=a&tag=b`). Casi siempre queremos uno solo; a veces
 *    queremos la lista.
 * 2. Un valor de enum inventado tiene que ignorarse, no romper la consulta.
 * 3. Un uuid que viene de la URL no alcanza con que tenga forma de uuid: tiene
 *    que ser uno de los que el servidor ya sabe que existen en el workspace.
 *    Sin eso, cualquiera prueba ids ajenos contra un `.in()`.
 *
 * Modulo puro: no importa nada de `next/*`, asi que tambien se puede usar
 * desde un Client Component y desde los tests.
 */

export type SearchParamValue = string | string[] | undefined;
export type SearchParams = Record<string, SearchParamValue>;

/** Tope de valores de una lista. Evita una URL con 5000 tags en un `.in()`. */
const MAX_LIST = 50;

/** Un parametro repetido se resuelve al primero. */
export function firstParam(value: SearchParamValue): string {
  if (Array.isArray(value)) return (value[0] ?? "").trim();
  return (value ?? "").trim();
}

/**
 * Un parametro repetido como lista, sin vacios ni duplicados y con tope.
 * Acepta tambien el caso de un solo valor, que es como llega el primero.
 */
export function listParam(value: SearchParamValue, max: number = MAX_LIST): string[] {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const seen = new Set<string>();

  for (const item of raw) {
    const trimmed = (item ?? "").trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    if (seen.size >= max) break;
  }

  return [...seen];
}

/**
 * Valida un valor contra la lista de los aceptados. Si no esta, devuelve el
 * fallback (por defecto cadena vacia, que las pantallas leen como "sin filtro").
 */
export function pickEnum<T extends string, F = "">(
  value: SearchParamValue,
  allowed: readonly T[],
  fallback: F = "" as unknown as F,
): T | F {
  const candidate = firstParam(value);
  return (allowed as readonly string[]).includes(candidate) ? (candidate as T) : fallback;
}

/**
 * Ids que ademas de tener forma de uuid pertenecen a un conjunto que el
 * servidor ya trajo (los tags del workspace, los miembros del equipo). Es la
 * barrera que impide que la URL meta ids arbitrarios en la consulta.
 */
export function pickIds(
  value: SearchParamValue,
  allowed: Iterable<string>,
  max: number = MAX_LIST,
): string[] {
  const valid = allowed instanceof Set ? allowed : new Set(allowed);
  return listParam(value, max).filter((id) => valid.has(id));
}

/** Numero de pagina: entero >= 1, con tope para que no se pida la pagina 10^9. */
export function pickPage(value: SearchParamValue, max = 100_000): number {
  const parsed = Number.parseInt(firstParam(value) || "1", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, max);
}

/**
 * Texto de busqueda listo para el filtro `or` de PostgREST.
 *
 * Los caracteres que se sacan rompen la sintaxis del `or` (la coma separa
 * condiciones, el parentesis las agrupa) o son comodines de `ilike` que
 * dejarian que la busqueda escanee toda la tabla.
 */
export function sanitizeSearch(raw: string, maxLength = 100): string {
  return raw.replace(/[,()*%\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

/**
 * Para el cliente: prende o apaga un valor de un parametro multi-valor.
 * Devuelve una copia; no toca el original.
 */
export function toggleListParam(
  params: URLSearchParams,
  key: string,
  value: string,
): URLSearchParams {
  const next = new URLSearchParams(params.toString());
  const current = next.getAll(key);
  next.delete(key);

  const kept = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];

  for (const v of kept) next.append(key, v);
  return next;
}
