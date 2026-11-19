/**
 * Propuestas de los agentes. Sin dependencias de servidor: lo importan la bandeja de aprobación y el núcleo.
 *
 * Una propuesta es una acción que un agente quiso hacer y NO hizo: queda pendiente, con sus parámetros, hasta que una
 * persona la aprueba (tal cual o editada) o la rechaza con un motivo de la lista cerrada. Nada se ejecuta solo.
 *
 * Dos orígenes, dos ejecutores:
 *  - `agent_tool`: una herramienta del agente (etiquetar, temperatura, crear tarea…) en un turno en modo «proponer».
 *  - `person_tool`: una escritura que alguien le pidió al asistente por la capa de herramientas; se ejecuta
 *    con la identidad de quien aprueba.
 */

export type ProposalExecutor = "agent_tool" | "person_tool";

export const PROPOSAL_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  approving: "Aplicándose",
  approved: "Aprobada",
  approved_edited: "Aprobada con edición",
  rejected: "Rechazada",
  failed: "No se pudo aplicar",
  expired: "Vencida",
};

/** Un campo editable de los parámetros (lo arma la pantalla sin saber qué herramienta es). */
export interface ProposalField {
  key: string;
  label: string;
  kind: "text" | "textarea" | "list" | "select" | "date";
  options?: Array<{ value: string; label: string }>;
}

export interface ProposalScreenRow {
  id: string;
  agentName: string | null;
  label: string;
  summary: string | null;
  toolKey: string;
  executor: ProposalExecutor;
  status: string;
  params: Record<string, unknown>;
  paramsFinal: Record<string, unknown> | null;
  fields: ProposalField[];
  rejectReason: string | null;
  rejectNote: string | null;
  error: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedByName: string | null;
  requestedByName: string | null;
  conversationId: string | null;
  /** Lo que hace falta para aprobarla (el permiso de la acción). */
  permission: string;
  /** Quien mira puede decidirla (tiene ese permiso). */
  canDecide: boolean;
}

/** JSON con claves ordenadas: para saber si una persona editó algo. Puro. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function paramsWereEdited(proposed: unknown, final: unknown): boolean {
  return stableJson(proposed) !== stableJson(final);
}
