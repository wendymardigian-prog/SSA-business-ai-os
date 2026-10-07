import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { logAudit } from "@/lib/audit";
import { WHATSAPP_MARKER } from "./tools/whatsapp-link";

/**
 * La sustitucion del marcador {{LINK_WHATSAPP}} y el registro del pase a
 * WhatsApp. Funciones puras (la sustitucion) y una escritura (el registro),
 * separadas del runner para poder testearlas solas.
 *
 * El marcador vive en el texto del modelo; el link real solo se conoce en el
 * turno (lo genero la herramienta). Se reemplaza DESPUES de partir en burbujas
 * y ANTES de persistir, asi el borrador guarda el link real (quien lo revisa lo clickea)
 * y el envio manda el link, nunca el marcador ni la url cruda del modelo.
 */

type Db = SupabaseClient<Database>;

const MARKER_RE = /\{\{LINK_WHATSAPP\}\}/g;

export type MarkerNote = "marker_without_tool" | "tool_without_marker" | null;

export interface MarkerResult {
  parts: string[];
  note: MarkerNote;
}

/** Deja la puntuacion prolija despues de sacar el marcador. */
function tidy(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    // "algo: ." o "algo :." -> "algo."
    .replace(/\s*:\s*\./g, ".")
    // espacio antes de signo de puntuacion
    .replace(/\s+([.,;:!?])/g, "$1")
    // parentesis vacio que quedo del marcador
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]*\n[ \t]*\n[ \t]*/g, "\n\n")
    .trim();
}

/**
 * Reemplaza el marcador por el link, o lo limpia si no hubo llamada.
 *   - link presente + marcador -> reemplaza todas las apariciones. note null.
 *   - marcador sin link -> saca el marcador, prolija la puntuacion. note marker_without_tool.
 *   - link sin marcador -> no agrega nada. note tool_without_marker.
 *   - ni marcador ni link -> sin cambios. note null.
 */
export function applyWhatsappMarker(parts: string[], link: string | null): MarkerResult {
  const hasMarker = parts.some((p) => MARKER_RE.test(p));
  MARKER_RE.lastIndex = 0;

  if (link) {
    if (!hasMarker) return { parts, note: "tool_without_marker" };
    return { parts: parts.map((p) => p.replace(MARKER_RE, link)), note: null };
  }
  if (hasMarker) {
    const cleaned = parts.map((p) => tidy(p.replace(MARKER_RE, ""))).filter((p) => p.length > 0);
    return { parts: cleaned.length > 0 ? cleaned : [""], note: "marker_without_tool" };
  }
  return { parts, note: null };
}

/** Si alguna parte enviada contiene el link, es un pase de verdad. */
export function sentTextHasLink(sentTexts: string[], link: string): boolean {
  return sentTexts.some((t) => t.includes(link));
}

export interface RecordHandoffInput {
  workspaceId: string;
  agentId: string;
  contactId: string;
  conversationId: string | null;
  channelId: string | null;
  runId: string | null;
  link: string;
  textoPreescrito: string;
  /** El texto que efectivamente salio (mensajes enviados o el borrador aprobado). */
  sentTexts: string[];
  /** El mensaje que lleva el link, si se conoce. */
  messageId?: string | null;
  origin: "tool" | "draft_approval";
  extraMeta?: Record<string, Json>;
}

/**
 * Escribe la entrada whatsapp_handoff en audit_log, SOLO si el texto que salio
 * contiene el link. El criterio es el texto enviado, no lo que el modelo quiso:
 * si una persona edito el borrador y saco el link, no se registra nada.
 */
export async function recordWhatsappHandoff(supabase: Db, input: RecordHandoffInput): Promise<string | null> {
  if (!sentTextHasLink(input.sentTexts, input.link)) return null;
  return logAudit({
    supabase,
    workspaceId: input.workspaceId,
    entityType: "contact",
    entityId: input.contactId,
    action: "whatsapp_handoff",
    performedByAgentId: input.agentId,
    metadata: {
      origin: input.origin,
      run_id: input.runId,
      conversation_id: input.conversationId,
      contact_id: input.contactId,
      channel_id: input.channelId,
      agent_id: input.agentId,
      message_id: input.messageId ?? null,
      link: input.link,
      texto_preescrito: input.textoPreescrito,
      // La pestana Acciones muestra metadata.reason como motivo.
      reason: input.textoPreescrito,
      ...(input.extraMeta ?? {}),
    },
  });
}
