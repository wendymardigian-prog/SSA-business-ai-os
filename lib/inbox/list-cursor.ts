/**
 * La lista de la bandeja se pide de a tandas con un CURSOR, no con un numero de
 * pagina (scroll infinito, 27/11/2026).
 *
 * Con OFFSET ("salteá las primeras 300") la base lee y descarta esas 300 en cada
 * pedido, y un chat nuevo arriba corre todo una posicion: al pedir la siguiente
 * pagina se repetia el ultimo chat. Con cursor se pide "las que vienen despues
 * de esta": cuesta lo mismo en la tanda 1 que en la 40, y lo que entra arriba no
 * mueve nada de abajo.
 *
 * El orden es el de siempre mas el id como desempate final:
 *   last_message_at DESC NULLS LAST, created_at DESC, id DESC
 * Sin el id, dos chats con la misma hora podian repetirse o perderse entre tandas.
 *
 * Modulo PURO: lo usan el servidor (para armar el filtro) y el navegador (para
 * ordenar lo que llega en vivo con la misma regla).
 */

export interface ListCursor {
  lastMessageAt: string | null;
  createdAt: string;
  id: string;
}

export interface CursorRow {
  id: string;
  last_message_at: string | null;
  created_at: string;
}

/** El cursor que deja una fila: la proxima tanda empieza despues de ella. */
export function cursorOf(row: CursorRow): ListCursor {
  return { lastMessageAt: row.last_message_at, createdAt: row.created_at, id: row.id };
}

/**
 * En microsegundos, como la base: `Date` solo llega a milisegundos y dos chats
 * separados por microsegundos quedarian empatados (y en otro orden que el de la
 * base). Acepta las dos formas que llegan: la de PostgREST ("T", "+00:00") y la
 * de Realtime (" ", "+00").
 */
function time(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const normalized = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const fraction = /\.(\d+)/.exec(normalized)?.[1] ?? "";
  const seconds = new Date(normalized.replace(/\.\d+/, "")).getTime();
  if (Number.isNaN(seconds)) return Number.NEGATIVE_INFINITY;
  return seconds * 1000 + Number((fraction + "000000").slice(0, 6));
}

/**
 * Compara dos claves en el orden de la lista: negativo si `a` va ANTES (mas
 * nueva), positivo si va despues. Un `last_message_at` vacio va al final.
 */
export function compareKeys(a: ListCursor, b: ListCursor): number {
  const aNull = a.lastMessageAt === null;
  const bNull = b.lastMessageAt === null;
  if (aNull !== bNull) return aNull ? 1 : -1;
  // Dos vacios: -Infinity menos -Infinity da NaN, asi que se saltean.
  if (!aNull) {
    const byMessage = time(b.lastMessageAt) - time(a.lastMessageAt);
    if (byMessage !== 0) return byMessage;
  }
  const byCreated = time(b.createdAt) - time(a.createdAt);
  if (byCreated !== 0 && !Number.isNaN(byCreated)) return byCreated;
  // Los uuid se comparan como texto, igual que la base (id DESC).
  return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
}

/** Ordena filas con la misma regla que la base. */
export function compareRows(a: CursorRow, b: CursorRow): number {
  return compareKeys(cursorOf(a), cursorOf(b));
}

/** Si la fila va DESPUES del cursor (es decir, todavia no se cargo). */
export function isAfterCursor(row: CursorRow, cursor: ListCursor): boolean {
  return compareKeys(cursorOf(row), cursor) > 0;
}

const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lee un cursor que viene del navegador. Uno con otra forma no se usa: lo que va
 * adentro del filtro de PostgREST tiene que ser una fecha o un uuid, nunca texto
 * libre (podria colar otra condicion).
 */
export function parseCursor(input: unknown): ListCursor | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const last = raw.lastMessageAt;
  if (last !== null && (typeof last !== "string" || !ISO.test(last))) return null;
  if (typeof raw.createdAt !== "string" || !ISO.test(raw.createdAt)) return null;
  if (typeof raw.id !== "string" || !UUID.test(raw.id)) return null;
  return { lastMessageAt: last as string | null, createdAt: raw.createdAt, id: raw.id };
}

/** Un valor dentro de un filtro `or` de PostgREST: entre comillas por los `:` y `+` de la fecha. */
function quoted(value: string): string {
  return `"${value}"`;
}

/**
 * El filtro "las filas que van despues de este cursor", para `.or()`.
 *
 * Con fecha de mensaje:
 *   last_message_at < L
 *   o (last_message_at = L y created_at < C)
 *   o (last_message_at = L y created_at = C y id < I)
 *   o last_message_at vacio (van todas al final)
 * Sin fecha de mensaje (ya estamos en el final):
 *   last_message_at vacio y (created_at < C o (created_at = C y id < I))
 */
export function keysetFilter(cursor: ListCursor): string {
  const c = quoted(cursor.createdAt);
  const i = cursor.id;
  if (cursor.lastMessageAt === null) {
    return `and(last_message_at.is.null,created_at.lt.${c}),and(last_message_at.is.null,created_at.eq.${c},id.lt.${i})`;
  }
  const l = quoted(cursor.lastMessageAt);
  return [
    `last_message_at.lt.${l}`,
    `and(last_message_at.eq.${l},created_at.lt.${c})`,
    `and(last_message_at.eq.${l},created_at.eq.${c},id.lt.${i})`,
    "last_message_at.is.null",
  ].join(",");
}
