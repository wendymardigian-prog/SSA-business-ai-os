/**
 * Cómo se muestra la atribución de un contacto (F88).
 *
 * Las decisiones de pantalla viven acá, puras y con test; los componentes solo
 * las componen. Qué se muestra:
 *
 *   - EL PRIMER TOQUE y EL ÚLTIMO, en una frase que se lee sola:
 *     "Instagram · comentario · Reel «cómo cobrar en dólares» · 12 sep".
 *   - Si hay un solo toque, el primero y el último son el mismo y se muestra UNA
 *     vez: dos tarjetas iguales parecen dos eventos.
 *   - Debajo, el CAMINO COMPLETO, en orden, plegado por defecto.
 *   - Cuando el toque trae una pieza, su nombre es un link a esa pieza.
 *
 * Sin dato no se inventa nada: ni ceros ni guiones, un estado vacío.
 */

import { readAttribution, type AttributionTouch } from "./attribution";
import { mediumLabel, sourceLabel } from "./taxonomy";

/** Un toque guardado en la tabla `contact_touches`, en lo que la pantalla usa. */
export interface TouchRow {
  id: string;
  occurred_at: string;
  source: string;
  medium: string | null;
  content_label: string | null;
  content_post_id: string | null;
  origin: string;
}

export interface TouchView {
  /** La frase completa, lista para mostrar. */
  text: string;
  /** Solo la parte del origen ("Instagram · comentario"), sin pieza ni fecha. */
  origin: string;
  /** El nombre de la pieza, si el toque la trae. */
  piece: string | null;
  /** A dónde lleva el nombre de la pieza. Null si no se conoce la pieza. */
  href: string | null;
  /** "12 sep", o vacío si el toque no tiene fecha. */
  when: string;
  /** El medio no era de la lista: se guardó tal cual vino. */
  rawMedium: boolean;
}

export interface AttributionView {
  /** No hay nada que mostrar. */
  empty: boolean;
  first: TouchView | null;
  /** Null cuando es el mismo toque que `first`: se muestra una sola vez. */
  last: TouchView | null;
  /** Todos los toques, del más viejo al más nuevo. Vacío si no hay tabla que leer. */
  path: TouchView[];
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "12 sep" en la zona del negocio: la fecha que ve quien mira, no la de UTC. */
export function shortDate(iso: string | null | undefined, timeZone = "America/Costa_Rica"): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, month: "2-digit", day: "2-digit" }).formatToParts(date);
    const month = Number(parts.find((p) => p.type === "month")?.value);
    const day = Number(parts.find((p) => p.type === "day")?.value);
    return `${day} ${MONTHS[month - 1]}`;
  } catch {
    // Una zona inválida no puede romper la ficha: se cae a UTC.
    return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
  }
}

/** A dónde lleva una pieza. La ruta vieja redirige al drawer (F99). */
export const pieceHref = (contentPostId: string) => `/dashboard/content/${contentPostId}`;

/** Un toque, dicho en palabras. Funciona con el de la copia derivada y con una fila. */
export function describeTouch(
  touch: Pick<AttributionTouch, "source" | "medium" | "medium_raw" | "content" | "content_post_id" | "occurred_at">,
  timeZone?: string,
): TouchView {
  const source = sourceLabel(touch.source);
  const medium = mediumLabel(touch.medium);
  const origin = [source, medium].filter(Boolean).join(" · ");
  const piece = touch.content?.trim() || null;
  const when = shortDate(touch.occurred_at, timeZone);

  const text = [origin, piece ? `«${piece}»` : null, when || null].filter(Boolean).join(" · ");

  return {
    text,
    origin,
    piece,
    href: touch.content_post_id ? pieceHref(touch.content_post_id) : null,
    when,
    rawMedium: touch.medium_raw === true,
  };
}

const fromRow = (row: TouchRow): AttributionTouch => ({
  occurred_at: row.occurred_at,
  source: row.source,
  medium: row.medium ?? undefined,
  content: row.content_label ?? undefined,
  content_post_id: row.content_post_id ?? undefined,
});

/** Dos toques son el mismo si dicen lo mismo. */
const sameTouch = (a: AttributionTouch, b: AttributionTouch) => JSON.stringify(a) === JSON.stringify(b);

/**
 * El modelo de la sección de atribución.
 *
 * `rows` es opcional: la ficha lee la tabla de toques para mostrar el camino, y
 * el panel de la bandeja, que no, usa solo la copia de `contacts.attribution`.
 */
export function buildAttributionView(params: {
  attribution: unknown;
  rows?: TouchRow[];
  timeZone?: string;
}): AttributionView {
  const { first_touch, last_touch } = readAttribution(params.attribution);
  const rows = params.rows ?? [];
  const path = [...rows]
    .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime())
    .map((row) => describeTouch(fromRow(row), params.timeZone));

  // Sin copia derivada pero con toques en la tabla (un contacto al que todavía no
  // se le calculó): el primero y el último salen de la propia tabla.
  const first = first_touch ?? (rows.length > 0 ? fromRow(sortedRows(rows)[0]) : undefined);
  const last = last_touch ?? (rows.length > 0 ? fromRow(sortedRows(rows)[rows.length - 1]) : undefined);

  if (!first && !last) return { empty: true, first: null, last: null, path: [] };

  const firstTouch = first ?? last!;
  const lastTouch = last ?? first!;
  const single = rows.length === 1 || sameTouch(firstTouch, lastTouch);

  return {
    empty: false,
    first: describeTouch(firstTouch, params.timeZone),
    last: single ? null : describeTouch(lastTouch, params.timeZone),
    path,
  };
}

function sortedRows(rows: TouchRow[]): TouchRow[] {
  return [...rows].sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
}
