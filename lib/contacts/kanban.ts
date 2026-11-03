/**
 * El Kanban de contactos: una columna por estado del rol elegido.
 *
 * Puro: la página arma las columnas con esto, el tablero valida cada
 * movimiento con esto antes de pedirlo al servidor, y la tarjeta se mueve en
 * pantalla con `moveCard` mientras el servidor confirma.
 *
 * Mover una tarjeta cambia el estado con `setContactStatus`
 * (`lib/actions/contact-status.ts`), el mismo camino que la ficha: pide
 * `contacts.edit`, que la persona vea el contacto, y deja el historial.
 *
 * Agrupar por más campos (temperatura, producto…) es sumar una entrada a
 * `KANBAN_GROUPINGS` y su columna: la pantalla no cambia.
 */

import { firstParam, type SearchParamValue } from "@/lib/url-params";
import { NONE, type ListClause } from "./list-query";
import { STATUS_ROLE_LABELS, type ContactStatus, type StatusRole } from "./statuses";

export const CONTACT_VIEWS = ["tabla", "kanban"] as const;
export type ContactView = (typeof CONTACT_VIEWS)[number];

/** `?vista=kanban`; la tabla es la de siempre y no va en la URL. */
export function parseContactView(value: SearchParamValue): ContactView {
  return firstParam(value) === "kanban" ? "kanban" : "tabla";
}

export const KANBAN_GROUPINGS = [
  { key: "setter", role: "setter", label: `Estado ${STATUS_ROLE_LABELS.setter.toLowerCase()}` },
  { key: "vendedor", role: "closer", label: `Estado ${STATUS_ROLE_LABELS.closer.toLowerCase()}` },
] as const satisfies ReadonlyArray<{ key: string; role: StatusRole; label: string }>;

export type KanbanGrouping = (typeof KANBAN_GROUPINGS)[number]["key"];
export const DEFAULT_KANBAN_GROUPING: KanbanGrouping = "setter";

/** Dónde se recuerda la última elección de cada persona. */
export const KANBAN_GROUPING_STORAGE_KEY = "contacts-kanban-grouping";

/** `?agrupar=vendedor`; lo inventado vuelve al de setter. */
export function parseKanbanGrouping(value: SearchParamValue): KanbanGrouping {
  const raw = firstParam(value);
  return KANBAN_GROUPINGS.some((g) => g.key === raw) ? (raw as KanbanGrouping) : DEFAULT_KANBAN_GROUPING;
}

export function groupingRole(grouping: KanbanGrouping): StatusRole {
  return KANBAN_GROUPINGS.find((g) => g.key === grouping)?.role ?? "setter";
}

export const statusColumn = (role: StatusRole) => (role === "setter" ? "setter_status" : "closer_status");

/** Cuántas tarjetas trae cada columna por vez. */
export const KANBAN_PAGE_SIZE = 25;

export interface KanbanColumnDef {
  /** La clave del estado, o "ninguno" para la columna "Sin estado". */
  key: string;
  name: string;
  color: string | null;
  archived: boolean;
}

/**
 * Las columnas posibles, en orden: "Sin estado" primero (los que nadie
 * clasificó todavía), después los estados en el orden de la lista y al final
 * los archivados. Si se está filtrando por estados de ESTE rol, solo esos.
 */
export function kanbanColumnDefs(list: readonly ContactStatus[], filteredKeys: readonly string[] = []): KanbanColumnDef[] {
  const all: KanbanColumnDef[] = [
    { key: NONE, name: "Sin estado", color: null, archived: false },
    ...list.filter((s) => !s.archived_at).map((s) => ({ key: s.key, name: s.name, color: s.color, archived: false })),
    ...list.filter((s) => s.archived_at).map((s) => ({ key: s.key, name: `${s.name} (archivado)`, color: s.color, archived: true })),
  ];
  if (filteredKeys.length === 0) return all;
  const keep = new Set(filteredKeys);
  return all.filter((c) => keep.has(c.key));
}

/** Un estado archivado solo aparece si todavía tiene contactos. */
export function visibleKanbanColumns<T extends { archived: boolean; total: number }>(columns: readonly T[]): T[] {
  return columns.filter((c) => !c.archived || c.total > 0);
}

/** La condición que deja en una columna solo sus contactos. */
export function kanbanColumnClause(role: StatusRole, key: string): ListClause {
  const column = statusColumn(role);
  return key === NONE ? { op: "is_null", column } : { op: "eq", column, value: key };
}

export type DropVerdict = { kind: "move" } | { kind: "noop" } | { kind: "blocked"; reason: string };

/** Si una tarjeta se puede soltar en una columna, y si no, por qué (en palabras). */
export function evaluateContactDrop(from: string, to: KanbanColumnDef, canEdit: boolean): DropVerdict {
  if (from === to.key) return { kind: "noop" };
  if (!canEdit) return { kind: "blocked", reason: "No tenés permiso para cambiar el estado de los contactos." };
  if (to.archived) return { kind: "blocked", reason: `«${to.name}» está archivado: no se le pueden sumar contactos.` };
  return { kind: "move" };
}

export interface KanbanCard {
  id: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  temperature: "cold" | "warm" | "hot" | null;
  doNotContact: boolean;
  isKnown: boolean;
  isCustomer: boolean;
  setterId: string | null;
  vendedorId: string | null;
  interestProductId: string | null;
  interestVariantId: string | null;
  lastInteractionAt: string | null;
}

/** Lo que pide cada tarjeta (más los joins de los filtros). */
export const KANBAN_CARD_SELECT =
  "id, display_name, email, phone, lead_temperature, do_not_contact, is_known, is_customer, setter_id, vendedor_id, interest_product_id, interest_variant_id, last_interaction_at";

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export function toKanbanCard(row: Record<string, unknown>): KanbanCard {
  const t = row.lead_temperature;
  return {
    id: String(row.id),
    displayName: str(row.display_name),
    email: str(row.email),
    phone: str(row.phone),
    temperature: t === "cold" || t === "warm" || t === "hot" ? t : null,
    doNotContact: Boolean(row.do_not_contact),
    isKnown: Boolean(row.is_known),
    isCustomer: Boolean(row.is_customer),
    setterId: str(row.setter_id),
    vendedorId: str(row.vendedor_id),
    interestProductId: str(row.interest_product_id),
    interestVariantId: str(row.interest_variant_id),
    lastInteractionAt: str(row.last_interaction_at),
  };
}

export interface KanbanColumn extends KanbanColumnDef {
  cards: KanbanCard[];
  /** Cuántos contactos hay en la columna con los filtros puestos (no solo los cargados). */
  total: number;
}

/**
 * Mueve una tarjeta en pantalla: sale de su columna y entra arriba de la otra,
 * y los totales se corrigen. Devuelve columnas nuevas; no toca las de entrada.
 */
export function moveCard(columns: readonly KanbanColumn[], cardId: string, toKey: string): KanbanColumn[] {
  const source = columns.find((c) => c.cards.some((card) => card.id === cardId));
  if (!source || source.key === toKey || !columns.some((c) => c.key === toKey)) return [...columns];
  const card = source.cards.find((c) => c.id === cardId)!;
  return columns.map((c) => {
    if (c.key === source.key) return { ...c, cards: c.cards.filter((x) => x.id !== cardId), total: Math.max(0, c.total - 1) };
    if (c.key === toKey) return { ...c, cards: [card, ...c.cards], total: c.total + 1 };
    return c;
  });
}

/** Suma las tarjetas de "Cargar más" sin repetir las que ya estaban. */
export function appendCards(columns: readonly KanbanColumn[], key: string, more: readonly KanbanCard[]): KanbanColumn[] {
  return columns.map((c) => {
    if (c.key !== key) return c;
    const seen = new Set(c.cards.map((x) => x.id));
    return { ...c, cards: [...c.cards, ...more.filter((x) => !seen.has(x.id))] };
  });
}

/** En qué columna está una tarjeta ahora. */
export function columnOf(columns: readonly KanbanColumn[], cardId: string): string | null {
  return columns.find((c) => c.cards.some((card) => card.id === cardId))?.key ?? null;
}
