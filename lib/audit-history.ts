/**
 * El historial de una entidad, en funciones puras (Llamadas, F1).
 *
 * Lo usan <Historial/> (components/historial/) y, mas adelante, la pantalla de
 * Actividad de Ventas. Nada de aca habla con la base: `buildHistoryQuery` solo
 * DESCRIBE la consulta y `runHistoryQuery` la aplica con el cliente que le
 * pasen. Con el cliente del usuario, la RLS decide que se ve.
 */

import { paymentStatusLabel, saleStatusLabel } from "@/lib/sales/labels";
import { applyAuditFilters, auditFilters } from "@/lib/audit-query";
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
  product_type: "Tipo",
  description: "Descripción",
  price: "Precio",
  change_notes: "Notas del cambio",
  setter_id: "Setter",
  vendedor_id: "Vendedor",
  discount_amount: "Descuento",
  final_amount: "Monto final",
  base_amount: "Monto base",
  discount_reason: "Motivo del descuento",
  sale_date: "Fecha de la venta",
  service_starts_at: "Inicio del servicio",
  notes: "Notas",
  attribution: "Atribución",
  due_date: "Vence",
  amount: "Monto",
  payment_method: "Método de pago",
  paid_on: "Cobrado el",
  reschedule_reason: "Motivo de la reprogramación",
  provider_fee_amount: "Comisión",
  title: "Título",
  role: "Rol",
  // Tareas
  priority: "Prioridad",
  start_date: "Inicio",
  owner_id: "Responsable",
  assigned_to: "Responsable",
  follower_ids: "Seguidores",
  project: "Proyecto",
  conversation_id: "Conversación",
  blocked_by: "Depende de",
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
export function describeChange(
  entityType: AuditEntityType | string,
  field: string,
  oldValue: unknown,
  newValue: unknown,
  names?: Record<string, string>,
): ChangeLine {
  const key = field.includes(".") ? field.split(".").pop()! : field;
  // El estado de una venta o de un pago se lee con su etiqueta («Pagada», «Moroso»), no con la clave interna.
  const named = (value: unknown): unknown => {
    if (typeof value !== "string") return value;
    if (key === "status") {
      if (entityType === "sale") return saleStatusLabel(value);
      if (entityType === "payment") return paymentStatusLabel(value);
      if (entityType === "task") return TASK_STATUS_NAMES[value] ?? value;
    }
    if (entityType === "task") {
      if (key === "priority") return TASK_PRIORITY_NAMES[value] ?? value;
      // Responsable y seguidores se guardan como ids: se leen como nombres (uno solo o varios separados por coma).
      if ((key === "owner_id" || key === "follower_ids") && names) {
        return value.split(",").map((id) => names[id.trim()] ?? id.trim()).join(", ");
      }
    }
    // El responsable de una publicacion (Extra I, F43) tambien se guarda como id.
    if (entityType === "social_post" && key === "assigned_to" && names) return names[value] ?? value;
    return value;
  };
  return {
    field,
    label: FIELD_LABELS[field] ?? FIELD_LABELS[key] ?? field.replace(/_/g, " "),
    before: readableValue(named(oldValue)),
    after: readableValue(named(newValue)),
  };
}

/** Todas las lineas de cambio de una fila (vacio si no tiene `changes`). */
export function describeChanges(entityType: string, changes: Json | null, names?: Record<string, string>): ChangeLine[] {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return [];
  return Object.entries(changes as Record<string, { old?: unknown; new?: unknown }>)
    .filter(([, v]) => v && typeof v === "object")
    .map(([field, v]) => describeChange(entityType, field, v.old, v.new, names));
}

const TASK_STATUS_NAMES: Record<string, string> = { pending: "Pendiente", in_progress: "En progreso", completed: "Completada" };
const TASK_PRIORITY_NAMES: Record<string, string> = { low: "Baja", normal: "Normal", high: "Alta", urgent: "Urgente" };

/** Etiquetas de las acciones de Tareas, para <Historial/>. */
export const TASK_ACTION_LABELS: Record<Extract<AuditAction, `task.${string}`>, string> = {
  "task.created": "creó la tarea",
  "task.updated": "editó la tarea",
  "task.reopened": "reabrió la tarea",
  "task.completed": "completó la tarea",
  "task.date_shifted": "movió la fecha de la tarea",
  "task.blockers_changed": "cambió de qué depende la tarea",
  "task.deleted": "borró la tarea",
};

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
  // Los filtros salen de la funcion compartida con la pantalla de Actividad (lib/audit-query.ts).
  const q = applyAuditFilters(
    supabase.from("audit_log").select(HISTORY_COLUMNS),
    auditFilters({ entityType: spec.entityType, entityId: spec.entityId, cursor: spec.cursor }),
  )
    .order("performed_at", { ascending: false })
    .limit(spec.limit);
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

/** Etiquetas de las acciones de Formularios, para <Historial/> y la ficha del contacto. */
export const FORM_ACTION_LABELS: Record<
  Extract<AuditAction, `form.${string}` | `submission.${string}` | `contract.${string}` | `contact.${string}` | `eod.${string}` | `attribution.${string}` | `social_post.${string}`>,
  string
> = {
  "eod.edited": "corrigió el reporte de fin de día",
  "form.created": "creó el formulario",
  "form.updated": "editó el formulario",
  "form.published": "publicó el formulario",
  "form.paused": "pausó el formulario",
  "form.resumed": "reanudó el formulario",
  "form.archived": "archivó el formulario",
  "form.restored": "restauró el formulario",
  "form.duplicated": "duplicó el formulario",
  "form.slug_changed": "cambió el link del formulario",
  "form.contact_config_changed": "cambió cómo se arma el contacto",
  "form.flow_created": "creó una automatización del formulario",
  "form.flow_toggled": "encendió o apagó una automatización del formulario",
  "form.flow_updated": "editó una automatización del formulario",
  "submission.linked": "vinculó la respuesta con un contacto",
  "submission.spam": "marcó la respuesta como spam",
  "submission.unspam": "sacó la respuesta de spam",
  "contact.created": "creó el contacto desde un formulario",
  "contact.linked": "vinculó el contacto desde un formulario",
  "contact.updated": "actualizó el contacto",
  "attribution.meta_linked": "vinculó un toque con un anuncio de Meta",
  "attribution.meta_ignored": "ignoró un toque para el vínculo con Meta",
  "attribution.meta_unlinked": "quitó el vínculo manual de un toque con Meta",
  // Extra I (F31): la configuración de Ajustes > General > Atribución (entidad workspace).
  "attribution.settings_updated": "cambió la configuración de atribución",
  // Extra I (F43): el responsable de una publicación sin pieza.
  "social_post.assignee_changed": "cambió el responsable de la publicación",
  "contract.email_resent": "reenvió la copia del contrato",
  "contract.pdf_regenerated": "regeneró el PDF del contrato",
};

/** Etiquetas de las acciones de Finanzas (gastos, recurrentes, proveedores y su configuracion), para <Historial/>. */
export const FINANCE_ACTION_LABELS: Record<Extract<AuditAction, `expense.${string}` | `recurring.${string}` | `vendor.${string}` | `finance.${string}`>, string> = {
  "expense.created": "cargó el gasto",
  "expense.updated": "editó el gasto",
  "expense.paid": "marcó el gasto como pagado",
  "expense.payment_reverted": "revirtió el pago del gasto",
  "expense.voided": "anuló el gasto",
  "expense.receipt_uploaded": "subió el comprobante",
  "expense.receipt_removed": "quitó el comprobante",
  "expense.overdue": "venció el gasto",
  "expense.auto_created": "generó el gasto automático",
  "expense.auto_updated": "recalculó el gasto automático",
  "expense.auto_voided_zero": "anuló el gasto automático: quedó en cero",
  "expense.auto_reactivated": "reactivó el gasto automático",
  "expense.auto_closed": "cerró el gasto automático como pagado",
  "expense.drift_detected": "detectó que el monto cambió después de pagado",
  "expense.drift_ignored": "ignoró la diferencia del gasto",
  "expense.adjustment_created": "creó un ajuste",
  "recurring.created": "creó la plantilla recurrente",
  "recurring.updated": "editó la plantilla recurrente",
  "recurring.paused": "pausó la plantilla recurrente",
  "recurring.reactivated": "reactivó la plantilla recurrente",
  "recurring.expense_generated": "generó un gasto desde la plantilla",
  "recurring.backfilled": "generó los gastos que faltaban",
  "vendor.created": "creó el proveedor",
  "vendor.updated": "editó el proveedor",
  "vendor.archived": "archivó el proveedor",
  "vendor.restored": "restauró el proveedor",
  "finance.categories_updated": "cambió las categorías de gasto",
  "finance.settings_updated": "cambió la configuración de Finanzas",
};

/** Etiquetas de las acciones de Comisiones (la comision, sus reglas y sus roles), para <Historial/>. */
export const COMMISSION_ACTION_LABELS: Record<Extract<AuditAction, `commission.${string}` | `commission_rule.${string}`>, string> = {
  "commission.generated": "generó la comisión",
  "commission.voided": "anuló la comisión",
  "commission.payout_released": "soltó la comisión del gasto anulado",
  "commission.payout_assigned": "pasó la comisión a un gasto",
  "commission.person_assigned": "asignó la persona de la comisión",
  "commission.adjustment_created": "cargó un ajuste de comisión",
  "commission.roles_updated": "cambió los roles de comisión",
  "commission_rule.created": "creó la regla de comisión",
  "commission_rule.updated": "editó la regla de comisión",
  "commission_rule.paused": "pausó la regla de comisión",
  "commission_rule.resumed": "reactivó la regla de comisión",
  "commission_rule.archived": "archivó la regla de comisión",
  "commission_rule.reordered": "reordenó las reglas de comisión",
};

/** Etiquetas de las acciones de Ventas (catalogo, venta y pago), para <Historial/>. */
export const SALE_ACTION_LABELS: Record<
  Extract<
    AuditAction,
    | `product.${string}`
    | `variant.${string}`
    | `version.${string}`
    | `assignment_rule.${string}`
    | `assignment.${string}`
    | `sale.${string}`
    | `payment.${string}`
  >,
  string
> = {
  "product.created": "creó el producto",
  "product.updated": "editó el producto",
  "product.status_changed": "cambió el estado del producto",
  "product.deleted": "borró el producto (un alta que falló)",
  "variant.created": "creó la variante",
  "variant.updated": "editó la variante",
  "variant.price_changed": "cambió el precio de la variante",
  "variant.archived": "archivó la variante",
  "variant.restored": "restauró la variante",
  "variant.deleted": "borró la variante (un alta que falló)",
  "variant.duplicated": "duplicó la variante",
  "version.draft_created": "creó un borrador de versión",
  "version.draft_updated": "editó el borrador de versión",
  "version.draft_deleted": "borró el borrador de versión",
  "version.published": "publicó la versión",
  "assignment_rule.updated": "cambió la regla de asignación",
  "assignment.automatic": "asignó automáticamente",
  "sale.created": "cargó la venta",
  "sale.updated": "editó la venta",
  "sale.attribution_changed": "cambió la atribución de la venta",
  "sale.repriced": "cambió el producto o el precio de la venta",
  "sale.cancelled": "canceló la venta",
  "sale.subscription_cancelled": "canceló la suscripción",
  "sale.refunded": "reembolsó la venta",
  "sale.contract_sent": "envió el contrato",
  "payment.created": "agregó un pago",
  "payment.paid": "cobró el pago",
  "payment.reverted": "revirtió el cobro",
  "payment.rescheduled": "reprogramó el pago",
  "payment.uncollectible": "marcó el pago como incobrable",
  "payment.restored": "volvió a poner el pago en cobro",
  "payment.cancelled": "anuló el pago",
  "payment.overdue": "marcó el pago como moroso",
  "payment.refund": "registró un reembolso",
  "payment.receipt_uploaded": "subió el comprobante del pago",
  "payment.fee_corrected": "corrigió la comisión del procesador del pago",
};
