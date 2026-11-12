/**
 * La Actividad de una reunión (Servicios A4, F145). PURA.
 *
 * Intercala por fecha los comentarios (el `CommentThread`) con lo que pasó, leído de `audit_log`: el vínculo con el
 * servicio, las propuestas aprobadas, editadas (con qué cambió), descartadas o fallidas, y la carga a mano. Acá se
 * traduce cada acción a una frase; los componentes solo la dibujan.
 */

export type CallAuditRow = {
  id: string;
  action: string;
  performed_at: string;
  performed_by: string | null;
  actor_type?: string | null;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
};

export type ActivityEntry = { id: string; at: string; text: string };

export const ACTIVITY_ACTIONS = [
  "call.service_linked",
  "call.proposal_approved",
  "call.proposal_edited",
  "call.proposal_discarded",
  "call.proposal_failed",
  "call.manual_summary",
] as const;

const TYPE_LABEL: Record<string, string> = { tarea: "una tarea", mensaje: "un mensaje para el cliente", paso: "completar un paso", aviso: "un aviso al equipo" };

const FIELD_LABEL: Record<string, string> = { titulo: "el título", detalle: "el detalle", vence_en_dias: "el vencimiento", responsable: "el responsable", texto: "el texto", para: "el destinatario" };

function who(row: CallAuditRow, names: Record<string, string>): string {
  if (row.performed_by) return names[row.performed_by] ?? "Alguien del equipo";
  return "El sistema";
}

/** Una frase por entrada del historial, o null si no es de la Actividad. */
export function activityText(row: CallAuditRow, names: Record<string, string>, serviceLabels: Record<string, string> = {}): string | null {
  const actor = who(row, names);
  const m = row.metadata ?? {};
  const typeLabel = TYPE_LABEL[String(m.type ?? "")] ?? "una propuesta";
  switch (row.action) {
    case "call.service_linked": {
      const change = (row.changes?.service_id ?? null) as { new?: string | null } | null;
      const link = ((row.changes?.service_link ?? null) as { new?: string | null } | null)?.new ?? null;
      if (link === "review") return `${actor} la dejó «Por revisar»: el cliente tiene más de un servicio posible.`;
      const id = change?.new ?? null;
      if (!id) return `${actor} la desvinculó del servicio.`;
      return `${actor} la vinculó a ${serviceLabels[id] ?? "un servicio"}.`;
    }
    case "call.proposal_approved":
      return `${actor} aprobó ${typeLabel}.`;
    case "call.proposal_edited": {
      const fields = Object.keys(row.changes ?? {}).map((k) => FIELD_LABEL[k] ?? k);
      return `${actor} editó y aprobó ${typeLabel}${fields.length ? ` (cambió ${fields.join(", ")})` : ""}.`;
    }
    case "call.proposal_discarded":
      return `${actor} descartó ${typeLabel}.`;
    case "call.proposal_failed":
      return `No se pudo hacer ${typeLabel}${typeof m.reason === "string" && m.reason ? `: ${m.reason}` : "."}`;
    case "call.manual_summary":
      return `${actor} cargó la reunión a mano.`;
    default:
      return null;
  }
}

export function activityEntries(rows: readonly CallAuditRow[], names: Record<string, string>, serviceLabels: Record<string, string> = {}): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  for (const r of rows) {
    const text = activityText(r, names, serviceLabels);
    if (text) out.push({ id: r.id, at: r.performed_at, text });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

export const EMPTY_ACTIVITY = "Todavía no hay actividad.";

/** El número del menú: «9+» desde 10 (se piden como mucho 10 filas). */
export function badgeLabel(count: number): string | null {
  if (count <= 0) return null;
  return count >= 10 ? "9+" : String(count);
}
