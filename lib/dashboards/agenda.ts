/**
 * Las cuentas del dashboard de Agenda: reuniones, quien agenda y de donde viene.
 *
 * Puro y sin dependencias de la base: la pantalla pide las filas
 * (`agenda-load.ts`) y de aca salen todos los numeros. Las reglas son las de
 * siempre de los dashboards:
 *
 * - **Nada se pierde.** Una agenda sin valor en la dimension elegida (sin UTM,
 *   sin categoria, sin responsable) va a "Sin asignar", asi que la suma de las
 *   filas es siempre el total de agendas.
 * - **Nunca se inventa un cero.** Sin agendas en el periodo no hay filas ni
 *   tarjetas con valor: la pantalla muestra su estado vacio.
 * - **Agendas y contactos no son lo mismo.** Una persona puede agendar dos
 *   veces: la columna "Contactos" cuenta personas distintas DENTRO de cada
 *   fila, y por eso no suma al total (el total de contactos se cuenta aparte,
 *   una sola vez sobre todas las filas).
 * - La categoria sale de `category_snapshot`, la copia congelada al agendar:
 *   renombrar un area despues no cambia lo que dicen los informes viejos.
 */

import { BOOKING_STATUS_KEYS, statusLabel } from "@/lib/scheduling/booking-status";
import type { BookingStatus } from "@/lib/scheduling/types";

/** Lo que el dashboard necesita de una agenda. */
export interface AgendaBooking {
  id: string;
  contactId: string;
  status: string;
  statusGroup: string;
  hostUserId: string | null;
  origin: string | null;
  /** `category_snapshot` tal como esta guardado. */
  categorySnapshot: unknown;
  /** `bookings.utm` tal como esta guardado. */
  utm: unknown;
}

export const UNASSIGNED_KEY = "none";
export const UNASSIGNED_LABEL = "Sin asignar";

export type AgendaDimension = "status" | "category" | "host" | "origin" | "utm_source" | "utm_medium" | "utm_campaign";

export const AGENDA_DIMENSIONS: Array<{ value: AgendaDimension; label: string }> = [
  { value: "status", label: "Estado" },
  { value: "category", label: "Categoría" },
  { value: "host", label: "Responsable" },
  { value: "origin", label: "Origen" },
  { value: "utm_source", label: "UTM fuente" },
  { value: "utm_medium", label: "UTM medio" },
  { value: "utm_campaign", label: "UTM campaña" },
];

export const DEFAULT_DIMENSION: AgendaDimension = "status";

export function isAgendaDimension(value: unknown): value is AgendaDimension {
  return AGENDA_DIMENSIONS.some((d) => d.value === value);
}

/** Con que fecha de la agenda se cuenta el periodo. */
export type AgendaAxis = "created" | "start";

export const DEFAULT_AXIS: AgendaAxis = "created";

export const AGENDA_AXES: Array<{ value: AgendaAxis; label: string; hint: string }> = [
  { value: "created", label: "Cuándo agendó", hint: "Cuenta cada agenda por el día en que el contacto la pidió: lo que sirve para medir de dónde vienen." },
  { value: "start", label: "Fecha de la reunión", hint: "Cuenta cada agenda por el día en que es la reunión." },
];

export function parseAxis(value: unknown): AgendaAxis {
  return value === "start" ? "start" : DEFAULT_AXIS;
}

export const ORIGIN_LABELS: Record<string, string> = {
  public_page: "Página pública",
  embed: "Formulario embebido",
  manual: "A mano",
  agent: "Agente",
  api: "API",
};

// ── Tarjetas ──────────────────────────────────────────────────────────────

export interface AgendaCards {
  /** Agendas. */
  bookings: number;
  /** Personas distintas que agendaron. */
  contacts: number;
  cancelled: number;
  noShow: number;
  /** Con resultado cargado (venta, seguimiento o no califica). */
  outcome: number;
  sales: number;
}

export function computeCards(rows: AgendaBooking[]): AgendaCards {
  const contacts = new Set<string>();
  const cards: AgendaCards = { bookings: rows.length, contacts: 0, cancelled: 0, noShow: 0, outcome: 0, sales: 0 };
  for (const r of rows) {
    contacts.add(r.contactId);
    if (r.statusGroup === "cancelled") cards.cancelled += 1;
    if (r.statusGroup === "no_show") cards.noShow += 1;
    if (r.statusGroup === "outcome") cards.outcome += 1;
    if (r.status === "sale") cards.sales += 1;
  }
  cards.contacts = contacts.size;
  return cards;
}

// ── Desglose ──────────────────────────────────────────────────────────────

export interface AgendaGroupRow {
  key: string;
  label: string;
  bookings: number;
  /** Personas distintas EN ESTA FILA: no suma al total. */
  contacts: number;
  cancelled: number;
  noShow: number;
  outcome: number;
  sales: number;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** "Ventas · Triaje", "Ventas", o null si la agenda no tenia categoria. */
export function categoryLabel(snapshot: unknown): string | null {
  const snap = record(snapshot);
  const area = text(snap.area_name);
  const type = text(snap.type_name);
  if (area && type) return `${area} · ${type}`;
  return area ?? type;
}

/** La clave y la etiqueta de la fila a la que va una agenda, o null = "Sin asignar". */
function bucketOf(
  row: AgendaBooking,
  dimension: AgendaDimension,
  hostNames: Map<string, string>,
): { key: string; label: string } | null {
  switch (dimension) {
    case "status": {
      const known = (BOOKING_STATUS_KEYS as string[]).includes(row.status);
      return { key: row.status, label: known ? statusLabel(row.status as BookingStatus) : row.status };
    }
    case "category": {
      const label = categoryLabel(row.categorySnapshot);
      return label ? { key: label, label } : null;
    }
    case "host": {
      if (!row.hostUserId) return null;
      return { key: row.hostUserId, label: hostNames.get(row.hostUserId) ?? "Sin nombre" };
    }
    case "origin": {
      if (!row.origin) return null;
      return { key: row.origin, label: ORIGIN_LABELS[row.origin] ?? row.origin };
    }
    case "utm_source":
    case "utm_medium":
    case "utm_campaign": {
      const value = text(record(row.utm)[dimension]);
      return value ? { key: value, label: value } : null;
    }
  }
}

/**
 * Las filas de una dimension, de mas a menos agendas, con "Sin asignar" al
 * final. Cada agenda cae en exactamente una fila.
 */
export function groupBookings(
  rows: AgendaBooking[],
  dimension: AgendaDimension,
  hostNames: Map<string, string> = new Map(),
): AgendaGroupRow[] {
  const acc = new Map<string, AgendaGroupRow & { people: Set<string> }>();

  for (const r of rows) {
    const bucket = bucketOf(r, dimension, hostNames) ?? { key: UNASSIGNED_KEY, label: UNASSIGNED_LABEL };
    let row = acc.get(bucket.key);
    if (!row) {
      row = { key: bucket.key, label: bucket.label, bookings: 0, contacts: 0, cancelled: 0, noShow: 0, outcome: 0, sales: 0, people: new Set() };
      acc.set(bucket.key, row);
    }
    row.bookings += 1;
    row.people.add(r.contactId);
    if (r.statusGroup === "cancelled") row.cancelled += 1;
    if (r.statusGroup === "no_show") row.noShow += 1;
    if (r.statusGroup === "outcome") row.outcome += 1;
    if (r.status === "sale") row.sales += 1;
  }

  const out = [...acc.values()].map(({ people, ...row }) => ({ ...row, contacts: people.size }));
  out.sort((a, b) => {
    // "Sin asignar" siempre al final, aunque sea la fila mas grande.
    if (a.key === UNASSIGNED_KEY && b.key !== UNASSIGNED_KEY) return 1;
    if (b.key === UNASSIGNED_KEY && a.key !== UNASSIGNED_KEY) return -1;
    return b.bookings - a.bookings || a.label.localeCompare(b.label, "es");
  });
  return out;
}

/** La suma de las agendas de las filas: tiene que dar el total de las tarjetas. */
export function sumBookings(rows: AgendaGroupRow[]): number {
  return rows.reduce((total, r) => total + r.bookings, 0);
}
