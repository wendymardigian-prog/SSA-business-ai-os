import type { AgentDraftStatus } from "@/lib/types/database";

/**
 * Tipos del modo borrador (Bloque 2c). Sin dependencias de servidor: los usan
 * la cola y la bandeja.
 */

/**
 * Una accion que el agente SUGIRIO y no ejecuto, porque en modo borrador las
 * que cambian el control de la conversacion (derivar, pausarse) las decide la
 * persona que aprueba. Guarda todo lo necesario para aplicarla despues.
 */
export type SuggestedAction =
  | { type: "escalate"; reason: string; summary: string | null; reopen: boolean }
  | { type: "pause"; minutes: number; reason: string; maxMinutes: number; autoResume: boolean };

/** Una accion que el agente YA aplico en el turno (etiquetar, temperatura...). */
export interface AppliedAction {
  tool: string;
  label: string;
  detail: unknown;
  auditLogId: string | null;
}

/** Los estados en los que un borrador esta "vivo": uno solo por conversacion (indice unico). */
export const LIVE_DRAFT_STATUSES: AgentDraftStatus[] = ["pending", "sending", "failed"];

/** Los estados sobre los que una persona puede decidir (enviar, descartar, regenerar). */
export const DECIDABLE_DRAFT_STATUSES: AgentDraftStatus[] = ["pending", "failed"];

/**
 * Motivos de descarte automatico: una salida real por otro lado. Llevan el
 * prefijo auto: para que las metricas no los cuenten como una decision.
 */
export const AUTO_DISCARD = {
  manualReply: "auto:manual_reply",
  answeredElsewhere: "auto:answered_elsewhere",
  conversationClosed: "auto:conversation_closed",
} as const;

export function isAutoDiscard(reason: string | null | undefined): boolean {
  return Boolean(reason && reason.startsWith("auto:"));
}

/** Lectura tolerante del jsonb de sugerencias. */
export function parseSuggestedActions(raw: unknown): SuggestedAction[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((a): a is SuggestedAction => {
    if (!a || typeof a !== "object") return false;
    const type = (a as { type?: unknown }).type;
    return type === "escalate" || type === "pause";
  });
}

/** Lectura tolerante del jsonb de acciones aplicadas. */
export function parseAppliedActions(raw: unknown): AppliedAction[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((a): a is AppliedAction => Boolean(a && typeof a === "object" && typeof (a as { tool?: unknown }).tool === "string"));
}

/** El motivo de un borrador sin texto, en lenguaje llano. */
export function noReplyReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "Sin respuesta propuesta";
  if (reason === "escalate") return "El agente sugiere que responda una persona";
  if (reason === "purged") return "El texto se borro por la politica de retencion";
  const [kind, detail] = reason.split(":");
  if (kind === "guardrail") {
    const labels: Record<string, string> = {
      blocked_topic: "Tema vedado: lo tiene que responder una persona",
      frustration: "El lead parece enojado",
      urgency: "El lead marco urgencia",
      reply_cap: "Se alcanzo el tope de respuestas del agente",
      unresolved_turns: "Varios turnos seguidos sin resolver",
      spend: "Se alcanzo el tope de gasto de IA",
    };
    return labels[detail ?? ""] ?? "Lo freno un guardarrail";
  }
  if (kind === "error") {
    if (detail === "model_timeout") return "El modelo no respondio a tiempo";
    if (detail === "provider_unavailable") return "Fallaron el modelo principal y el de respaldo";
    if (detail?.startsWith("output_")) return "La respuesta del agente no paso la validacion";
    return "El agente no pudo redactar una respuesta";
  }
  return "Sin respuesta propuesta";
}
