/**
 * El historial del contacto: todo lo que le paso, de todas las fuentes, en un
 * solo orden.
 *
 * Antes eran solo las ultimas 20 filas de `audit_log` del contacto. Una
 * automatizacion aparecia como "disparo una automatizacion" a secas, y los
 * emails que mandaba, las secuencias en las que lo inscribia o lo que hacia el
 * flow no dejaban rastro en la ficha. Ahora se juntan:
 *
 *  - `audit`: lo de siempre (ediciones, asignaciones, tags, agenda...).
 *  - `flow`: una automatizacion empezo o termino (analytics_events), con su
 *    NOMBRE.
 *  - `sequence`: se inscribio o completo una secuencia.
 *  - `email`: un email AUTOMATICO que salio (o no pudo salir) para este contacto
 *    (email_log.contact_id, 00135).
 *
 * Los MENSAJES de chat no van: ya estan en Conversaciones. Un email manual
 * respondido desde la bandeja tampoco (es un mensaje de la conversacion de
 * email); aca solo entra el que mando una automatizacion.
 *
 * Una automatizacion deja dos huellas (el `automation_triggered` del audit y el
 * `flow_started` del motor): se muestra una sola.
 *
 * Puro: sin base ni React.
 */

import type { AuditAction, Json } from "@/lib/types/database";

export interface AuditHistoryItem {
  source: "audit";
  id: string;
  at: string;
  action: AuditAction;
  changes: Json | null;
  metadata: Json | null;
  actorLabel: string;
  /** El nombre de la automatizacion, si la entrada es un `automation_triggered`. */
  flowName: string | null;
}

export interface FlowHistoryItem {
  source: "flow";
  id: string;
  at: string;
  phase: "started" | "completed";
  flowName: string | null;
}

export interface SequenceHistoryItem {
  source: "sequence";
  id: string;
  at: string;
  phase: "enrolled" | "completed";
  sequenceName: string | null;
}

export interface EmailHistoryItem {
  source: "email";
  id: string;
  at: string;
  to: string;
  subject: string;
  status: "sent" | "failed" | "skipped_not_configured";
  /** El flow que lo mando, si se sabe. */
  flowName: string | null;
}

export type HistoryItem = AuditHistoryItem | FlowHistoryItem | SequenceHistoryItem | EmailHistoryItem;

/** Dos huellas de la MISMA automatizacion: el audit y el motor la anotan con segundos de diferencia. */
const SAME_RUN_WINDOW_MS = 5 * 60 * 1000;

export interface BuildHistoryInput {
  audit: Array<{
    id: string;
    action: AuditAction;
    changes: Json | null;
    metadata: Json | null;
    performedAt: string;
    actorLabel: string;
  }>;
  /** Eventos del motor de flows de este contacto (`flow_started`, `flow_completed`). */
  flowEvents: Array<{ id: string; eventType: string; flowId: string | null; createdAt: string }>;
  enrollments: Array<{ id: string; sequenceName: string | null; enrolledAt: string; completedAt: string | null }>;
  emails: Array<{
    id: string;
    toEmail: string;
    subject: string;
    status: string;
    relatedEntityType: string | null;
    relatedEntityId: string | null;
    createdAt: string;
  }>;
  /** id del flow -> nombre. */
  flowNames: Map<string, string>;
  /** Cuantas entradas como maximo. */
  limit?: number;
}

function flowIdOf(metadata: Json | null): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const id = (metadata as Record<string, unknown>).flow_id;
  return typeof id === "string" && id ? id : null;
}

function isEmailStatus(value: string): value is EmailHistoryItem["status"] {
  return value === "sent" || value === "failed" || value === "skipped_not_configured";
}

export function buildContactHistory(input: BuildHistoryInput): HistoryItem[] {
  const items: HistoryItem[] = [];
  const nameOf = (flowId: string | null) => (flowId ? (input.flowNames.get(flowId) ?? null) : null);

  // Los eventos del motor que cuentan: empezo y termino una automatizacion.
  const started: Array<{ flowId: string; at: number }> = [];
  for (const event of input.flowEvents) {
    if (event.eventType !== "flow_started" && event.eventType !== "flow_completed") continue;
    const phase = event.eventType === "flow_started" ? "started" : "completed";
    items.push({ source: "flow", id: `flow:${event.id}`, at: event.createdAt, phase, flowName: nameOf(event.flowId) });
    if (phase === "started" && event.flowId) started.push({ flowId: event.flowId, at: new Date(event.createdAt).getTime() });
  }

  for (const entry of input.audit) {
    const flowId = entry.action === "automation_triggered" ? flowIdOf(entry.metadata) : null;

    // Ya esta contada por el motor (`flow_started`): la del audit no se repite.
    if (flowId) {
      const at = new Date(entry.performedAt).getTime();
      if (started.some((s) => s.flowId === flowId && Math.abs(s.at - at) <= SAME_RUN_WINDOW_MS)) continue;
    }

    items.push({
      source: "audit",
      id: `audit:${entry.id}`,
      at: entry.performedAt,
      action: entry.action,
      changes: entry.changes,
      metadata: entry.metadata,
      actorLabel: entry.actorLabel,
      flowName: nameOf(flowId),
    });
  }

  for (const enrollment of input.enrollments) {
    items.push({
      source: "sequence",
      id: `enroll:${enrollment.id}`,
      at: enrollment.enrolledAt,
      phase: "enrolled",
      sequenceName: enrollment.sequenceName,
    });
    if (enrollment.completedAt) {
      items.push({
        source: "sequence",
        id: `enroll-done:${enrollment.id}`,
        at: enrollment.completedAt,
        phase: "completed",
        sequenceName: enrollment.sequenceName,
      });
    }
  }

  for (const email of input.emails) {
    // Solo los AUTOMATICOS: el email de un flow. Los transaccionales del sistema
    // (invitaciones, avisos de canal) no son de un contacto y no traen `contact_id`.
    items.push({
      source: "email",
      id: `email:${email.id}`,
      at: email.createdAt,
      to: email.toEmail,
      subject: email.subject,
      status: isEmailStatus(email.status) ? email.status : "failed",
      flowName: email.relatedEntityType === "flow" ? nameOf(email.relatedEntityId) : null,
    });
  }

  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return input.limit ? items.slice(0, input.limit) : items;
}

const quoted = (name: string | null, fallback: string) => (name ? `«${name}»` : fallback);

/**
 * La linea de una entrada que NO es del audit, en castellano. (Las del audit
 * las dice `ACTION_LABELS` en la pantalla, con su autor.)
 */
export function describeHistoryItem(item: Exclude<HistoryItem, AuditHistoryItem>): { actor: string; text: string } {
  switch (item.source) {
    case "flow":
      return item.phase === "started"
        ? { actor: "El sistema", text: `ejecutó la automatización ${quoted(item.flowName, "(borrada)")}` }
        : { actor: "El sistema", text: `terminó la automatización ${quoted(item.flowName, "(borrada)")}` };
    case "sequence":
      return item.phase === "enrolled"
        ? { actor: "El sistema", text: `lo inscribió en la secuencia ${quoted(item.sequenceName, "(borrada)")}` }
        : { actor: "El sistema", text: `completó la secuencia ${quoted(item.sequenceName, "(borrada)")}` };
    case "email": {
      const via = item.flowName ? ` (automatización ${quoted(item.flowName, "")})` : "";
      if (item.status === "sent") return { actor: "El sistema", text: `mandó el email «${item.subject}» a ${item.to}${via}` };
      if (item.status === "skipped_not_configured") {
        return { actor: "El sistema", text: `no mandó el email «${item.subject}» a ${item.to}: el correo no está conectado${via}` };
      }
      return { actor: "El sistema", text: `no pudo mandar el email «${item.subject}» a ${item.to}${via}` };
    }
  }
}
