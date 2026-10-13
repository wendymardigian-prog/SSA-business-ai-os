/**
 * El armado de consultas sobre `audit_log` (Ventas F36): UNA sola función para el historial de una
 * entidad (`<Historial>`) y para la pantalla global de Actividad. Puro: devuelve filtros de columna que
 * quien llama aplica a su consulta (con el cliente del usuario la RLS filtra). El comportamiento del
 * historial de una entidad NO cambió: `runHistoryQuery` ahora arma sus filtros acá y son los mismos de
 * antes (entidad, id y el cursor por fecha).
 */
import type { AuditActorType } from "@/lib/types/database";

export type AuditFilter = { column: string; op: "eq" | "lt" | "gte" | "lte" | "ilike"; value: string };

export interface AuditQueryInput {
  entityType?: string | null;
  entityId?: string | null;
  /** Una acción exacta (`sale.created`) o parte de ella (`sale.`). */
  action?: string | null;
  actorType?: AuditActorType | null;
  /** La persona (`performed_by`). */
  performedBy?: string | null;
  /** Desde (incluido) y hasta (excluido), como instantes ISO: quien llama convierte los días a la zona de quien mira. */
  fromIso?: string | null;
  toIso?: string | null;
  /** Texto en la etiqueta del actor («Job de mora», el nombre de un flujo). */
  actorLabel?: string | null;
  /** performed_at de la última fila vista: trae las anteriores (el historial por entidad). */
  cursor?: string | null;
}

export const ACTOR_TYPES: readonly AuditActorType[] = ["user", "agent", "system", "webhook"];

const escapeLike = (text: string) => text.replace(/[%_\\,()]/g, " ").trim().slice(0, 80);

/** Los filtros de columna de una consulta de auditoría. */
export function auditFilters(input: AuditQueryInput): AuditFilter[] {
  const out: AuditFilter[] = [];
  if (input.entityType) out.push({ column: "entity_type", op: "eq", value: input.entityType });
  if (input.entityId) out.push({ column: "entity_id", op: "eq", value: input.entityId });
  if (input.action) {
    const action = escapeLike(input.action);
    if (action) out.push(action.includes(".") && !action.endsWith(".") ? { column: "action", op: "eq", value: action } : { column: "action", op: "ilike", value: `${action}%` });
  }
  if (input.actorType && (ACTOR_TYPES as readonly string[]).includes(input.actorType)) out.push({ column: "actor_type", op: "eq", value: input.actorType });
  if (input.performedBy) out.push({ column: "performed_by", op: "eq", value: input.performedBy });
  if (input.fromIso) out.push({ column: "performed_at", op: "gte", value: input.fromIso });
  if (input.toIso) out.push({ column: "performed_at", op: "lt", value: input.toIso });
  if (input.actorLabel) {
    const label = escapeLike(input.actorLabel);
    if (label) out.push({ column: "actor_label", op: "ilike", value: `%${label}%` });
  }
  if (input.cursor) out.push({ column: "performed_at", op: "lt", value: input.cursor });
  return out;
}

/** Aplica los filtros a una consulta de Supabase (cualquier constructor que tenga eq, lt, gte, lte e ilike). */
export function applyAuditFilters<Q>(query: Q, filters: readonly AuditFilter[]): Q {
  let q = query as unknown as Record<string, (column: string, value: string) => unknown>;
  for (const f of filters) q = q[f.op](f.column, f.value) as typeof q;
  return q as unknown as Q;
}

/** A dónde lleva la fila de Actividad, o null si esa entidad no tiene pantalla propia. */
export function entityHref(entityType: string, entityId: string, metadata?: unknown): string | null {
  const saleId = typeof (metadata as { sale_id?: unknown } | null)?.sale_id === "string" ? (metadata as { sale_id: string }).sale_id : null;
  switch (entityType) {
    case "contact": return `/dashboard/contacts/${entityId}`;
    case "sale": return `/dashboard/ventas/${entityId}`;
    case "payment": return saleId ? `/dashboard/ventas/${saleId}` : null;
    case "product": return `/dashboard/settings/productos/${entityId}`;
    case "booking": return `/dashboard/agenda?agenda=${entityId}`;
    case "call": return `/dashboard/llamadas/${entityId}`;
    case "form": return `/dashboard/formularios/${entityId}`;
    case "task": return `/dashboard/tareas?task=${entityId}`;
    case "eod_report": {
      const formId = typeof (metadata as { form_id?: unknown } | null)?.form_id === "string" ? (metadata as { form_id: string }).form_id : null;
      return formId ? `/dashboard/formularios/${formId}/reportes/${entityId}` : null;
    }
    case "conversation": return `/dashboard/inbox?c=${entityId}`;
    case "agent": return `/dashboard/agents/${entityId}`;
    default: return null;
  }
}

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  contact: "Contacto",
  conversation: "Conversación",
  channel: "Canal",
  workspace: "Workspace",
  workspace_member: "Miembro del equipo",
  sequence: "Secuencia",
  agent: "Agente de IA",
  ai_task: "Tarea de IA",
  tag: "Etiqueta",
  event_type: "Tipo de evento",
  booking: "Agenda",
  response_asset: "Recurso",
  call: "Llamada",
  form: "Formulario",
  form_submission: "Respuesta de formulario",
  contract_signature: "Firma de contrato",
  eod_report: "Reporte de fin de día",
  task: "Tarea",
  product: "Producto",
  product_variant: "Variante",
  assignment_rule: "Regla de asignación",
  sale: "Venta",
  payment: "Pago",
};

export const ACTOR_TYPE_LABELS: Record<AuditActorType, string> = {
  user: "Una persona",
  agent: "Un agente de IA",
  system: "El sistema",
  webhook: "Un proveedor externo",
};

export const ACTIVITY_PAGE_SIZE = 50;
