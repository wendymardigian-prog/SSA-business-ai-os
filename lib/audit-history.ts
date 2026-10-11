/**
 * El historial de una entidad, en funciones puras (Llamadas, F1).
 *
 * Lo usan <Historial/> (components/historial/) y, mas adelante, la pantalla de
 * Actividad de Ventas. Nada de aca habla con la base: `buildHistoryQuery` solo
 * DESCRIBE la consulta y `runHistoryQuery` la aplica con el cliente que le
 * pasen. Con el cliente del usuario, la RLS decide que se ve.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditActorType, AuditAction, AuditEntityType, Json } from "@/lib/types/database";

/** Una fila de audit_log como la lee el historial. */
export interface HistoryRow {
  id: string;
  action: string;
  changes: Json | null;
  metadata: Json | null;
  performed_by: string | null;
  performed_by_agent_id: string | null;
  performed_at: string;
  actor_type?: AuditActorType | null;
  actor_label?: string | null;
}

export const HISTORY_COLUMNS =
  "id, action, changes, metadata, performed_by, performed_by_agent_id, performed_at, actor_type, actor_label";

export const HISTORY_PAGE_SIZE = 20;

/**
 * Quien hizo la accion, aunque la fila sea anterior a la 00144 (que no tiene
 * actor real): agente si hay agente, sistema si no hay persona, y si no, lo
 * guardado.
 */
export function effectiveActorType(row: Pick<HistoryRow, "performed_by" | "performed_by_agent_id" | "actor_type">): AuditActorType {
  if (row.performed_by_agent_id) return "agent";
  if (!row.performed_by && (row.actor_type ?? "user") === "user") return "system";
  return row.actor_type ?? "user";
}

/** Quien figura en la linea: la persona, el agente o la etiqueta del actor. */
export function actorName(
  row: Pick<HistoryRow, "performed_by" | "performed_by_agent_id" | "actor_type" | "actor_label">,
  names: { users?: Record<string, string>; agents?: Record<string, string> } = {},
): string {
  const type = effectiveActorType(row);
  if (row.actor_label) return row.actor_label;
  if (type === "agent") return (row.performed_by_agent_id && names.agents?.[row.performed_by_agent_id]) || "Agente de IA";
  if (type === "system") return "Sistema";
  if (type === "webhook") return "Proveedor externo";
  return (row.performed_by && names.users?.[row.performed_by]) || "Alguien del equipo";
}

// ── El diff legible ───────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  contact_id: "Contacto",
  booking_id: "Agenda",
  call_type: "Tipo de llamada",
  recorded_by_user_id: "Closer",
  is_closer: "Es closer",
  closer_emails: "Correos alternos",
  closer_score: "Puntaje del closer",
  lead_score: "Puntaje del lead",
  analysis: "Análisis",
  status: "Estado",
  name: "Nombre",
  title: "Título",
  role: "Rol",
};

const MAX_VALUE_CHARS = 200;

export interface ChangeLine {
  field: string;
  label: string;
  before: string;
  after: string;
}

function shorten(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > MAX_VALUE_CHARS ? `${clean.slice(0, MAX_VALUE_CHARS - 1)}…` : clean;
}

/** Un valor del diff como texto de una persona: nunca un JSON crudo de mas de 200 caracteres. */
export function readableValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return shorten(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    if (value.every((v) => typeof v === "string" || typeof v === "number")) return shorten(value.join(", "));
    return `${value.length} elementos`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 0) return "—";
    const json = JSON.stringify(value);
    return json.length <= MAX_VALUE_CHARS ? json : `Objeto con ${keys.length} campos`;
  }
  return shorten(String(value));
}

/** El cambio de un campo, con etiqueta, antes y despues legibles. */
export function describeChange(entityType: AuditEntityType | string, field: string, oldValue: unknown, newValue: unknown): ChangeLine {
  void entityType; // reservado: hoy el campo se explica igual en todas las entidades
  const key = field.includes(".") ? field.split(".").pop()! : field;
  return {
    field,
    label: FIELD_LABELS[field] ?? FIELD_LABELS[key] ?? field.replace(/_/g, " "),
    before: readableValue(oldValue),
    after: readableValue(newValue),
  };
}

/** Todas las lineas de cambio de una fila (vacio si no tiene `changes`). */
export function describeChanges(entityType: string, changes: Json | null): ChangeLine[] {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return [];
  return Object.entries(changes as Record<string, { old?: unknown; new?: unknown }>)
    .filter(([, v]) => v && typeof v === "object")
    .map(([field, v]) => describeChange(entityType, field, v.old, v.new));
}

// ── La consulta ───────────────────────────────────────────────────────────

export interface HistoryQuerySpec {
  entityType: string;
  entityId: string;
  /** performed_at de la ultima fila vista; trae las anteriores. */
  cursor: string | null;
  /** Se piden pageSize + 1 para saber si hay mas. */
  limit: number;
  pageSize: number;
}

/** La UNICA funcion que arma la consulta del historial de una entidad. */
export function buildHistoryQuery(input: {
  entityType: AuditEntityType | string;
  entityId: string;
  cursor?: string | null;
  pageSize?: number;
}): HistoryQuerySpec {
  const pageSize = Math.min(Math.max(input.pageSize ?? HISTORY_PAGE_SIZE, 1), 100);
  return {
    entityType: input.entityType,
    entityId: input.entityId,
    cursor: input.cursor ?? null,
    limit: pageSize + 1,
    pageSize,
  };
}

export interface HistoryPage {
  rows: HistoryRow[];
  nextCursor: string | null;
}

/** Aplica la consulta con el cliente dado. Con el del usuario, la RLS filtra. */
export async function runHistoryQuery(
  supabase: SupabaseClient,
  spec: HistoryQuerySpec,
): Promise<{ ok: true; page: HistoryPage } | { ok: false; error: string }> {
  let q = supabase
    .from("audit_log")
    .select(HISTORY_COLUMNS)
    .eq("entity_type", spec.entityType)
    .eq("entity_id", spec.entityId)
    .order("performed_at", { ascending: false })
    .limit(spec.limit);
  if (spec.cursor) q = q.lt("performed_at", spec.cursor);
  const { data, error } = await q;
  if (error) return { ok: false, error: "No pude leer el historial" };
  const all = (data ?? []) as unknown as HistoryRow[];
  const rows = all.slice(0, spec.pageSize);
  const more = all.length > spec.pageSize;
  return { ok: true, page: { rows, nextCursor: more ? rows[rows.length - 1].performed_at : null } };
}

/** Etiquetas de las acciones de llamadas, para <Historial/> y la ficha del contacto. */
export const CALL_ACTION_LABELS: Record<Extract<AuditAction, `call.${string}`>, string> = {
  "call.ingested": "entró la llamada desde Fathom",
  "call.imported": "importó la llamada a mano",
  "call.linked": "vinculó la llamada",
  "call.unlinked": "desvinculó la llamada",
  "call.type_changed": "cambió el tipo de la llamada",
  "call.analyzed": "analizó la llamada",
  "call.section_edited": "corrigió una sección del análisis",
  "call.regenerated": "regeneró el análisis",
  "call.objection": "objetó una sección del análisis",
  "call.objection_resolved": "resolvió una objeción",
  "call.archived": "archivó la llamada",
};
