import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { ContactContext, HistoryMessage } from "./prompt";

/**
 * Lo que el turno lee de la base: la conversacion, el historial, la rafaga, el
 * contacto y los conteos de los guardarrailes.
 *
 * Todo sale de `messages` persistidos (Bloque 1). La rafaga no viaja en el
 * payload del job: se lee aca, al ejecutar, asi un mensaje que llego entre el
 * agendado y la ejecucion entra igual.
 *
 * Nada de lo que devuelve este modulo se loguea.
 */

type Db = SupabaseClient<Database>;

export const HISTORY_LIMIT = 20;

export interface TurnConversation {
  id: string;
  workspace_id: string;
  channel_id: string;
  contact_id: string;
  /** null = hereda del canal; true = forzado prendido; false = forzado apagado (00066). */
  agent_enabled: boolean | null;
  agent_paused_until: string | null;
  is_automation_paused: boolean;
  assigned_to: string | null;
  status: string;
  late_conversation_id: string | null;
  deleted_at: string | null;
}

export interface StoredMessage {
  id: string;
  direction: "inbound" | "outbound";
  text: string | null;
  created_at: string;
  sent_by_user_id: string | null;
  sent_by_flow_id: string | null;
  sent_by_agent_id: string | null;
  agent_run_id: string | null;
}

export async function loadTurnConversation(supabase: Db, conversationId: string): Promise<TurnConversation | null> {
  const { data, error } = await supabase
    .from("conversations")
    .select(
      "id, workspace_id, channel_id, contact_id, agent_enabled, agent_paused_until, is_automation_paused, assigned_to, status, late_conversation_id, deleted_at",
    )
    .eq("id", conversationId)
    .maybeSingle();
  if (error) {
    console.error("[agent-context] no pude leer la conversacion:", error.message);
    return null;
  }
  return (data as TurnConversation | null) ?? null;
}

/** Los ultimos N mensajes, del mas viejo al mas nuevo. */
export async function loadRecentMessages(
  supabase: Db,
  conversationId: string,
  limit = HISTORY_LIMIT,
): Promise<StoredMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, direction, text, created_at, sent_by_user_id, sent_by_flow_id, sent_by_agent_id, agent_run_id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[agent-context] no pude leer los mensajes:", error.message);
    return [];
  }
  return ((data ?? []) as StoredMessage[]).reverse();
}

/**
 * La rafaga: los entrantes posteriores a la ultima salida (del agente, de un
 * flow o de una persona). Es lo que este turno tiene que responder.
 *
 * Con `maxAgeMs` se descartan ademas los entrantes mas viejos que eso,
 * contados desde `now` (el instante del turno, no el del mensaje mas nuevo).
 * Motivo: hay conversaciones sin una sola respuesta, donde "lo posterior a la
 * ultima salida" es todo el historial; sin este corte, el primer turno del
 * agente contestaria junto una pregunta de hace tres semanas. Lo viejo sigue
 * entrando al prompt por el historial: esto decide QUE se responde, no que se
 * lee.
 */
export function extractBurst(
  messages: StoredMessage[],
  opts: { maxAgeMs?: number; now?: Date } = {},
): StoredMessage[] {
  let lastOutbound = -1;
  messages.forEach((m, i) => {
    if (m.direction === "outbound") lastOutbound = i;
  });
  const pending = messages.slice(lastOutbound + 1).filter((m) => m.direction === "inbound");
  if (!opts.maxAgeMs) return pending;
  const cutoff = (opts.now ?? new Date()).getTime() - opts.maxAgeMs;
  return pending.filter((m) => new Date(m.created_at).getTime() >= cutoff);
}

export function toHistory(messages: StoredMessage[]): HistoryMessage[] {
  return messages
    .filter((m) => m.text)
    .map((m) => ({ direction: m.direction, text: m.text as string }));
}

/**
 * Donde empieza el intercambio actual: el primer mensaje despues del ultimo
 * silencio de mas de `gapMinutes`. Pura.
 */
export function exchangeStart(messages: StoredMessage[], gapMinutes: number): string | null {
  if (messages.length === 0) return null;
  const gapMs = gapMinutes * 60_000;
  let start = messages[0].created_at;
  for (let i = 1; i < messages.length; i++) {
    const prev = new Date(messages[i - 1].created_at).getTime();
    const curr = new Date(messages[i].created_at).getTime();
    if (curr - prev > gapMs) start = messages[i].created_at;
  }
  return start;
}

/** Cuando escribio por ultima vez una persona del equipo en la conversacion. */
export async function lastHumanReplyAt(supabase: Db, conversationId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("messages")
    .select("created_at")
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    .not("sent_by_user_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[agent-context] no pude leer la ultima respuesta humana:", error.message);
    return null;
  }
  return data?.created_at ?? null;
}

/**
 * Cuantas veces respondio el agente en la conversacion desde un instante.
 * Derivado de agent_runs, no guardado: un contador guardado se desincroniza.
 */
export async function countAgentReplies(
  supabase: Db,
  args: { conversationId: string; since: string | null },
): Promise<number> {
  let query = supabase
    .from("agent_runs")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", args.conversationId)
    .eq("source", "agent")
    .eq("status", "responded");
  if (args.since) query = query.gt("created_at", args.since);
  const { count, error } = await query;
  if (error) {
    console.error("[agent-context] no pude contar las respuestas del agente:", error.message);
    // Del lado seguro: si no se puede contar, se asume el tope alcanzado.
    return Number.MAX_SAFE_INTEGER;
  }
  return count ?? 0;
}

export async function loadContactContext(supabase: Db, contactId: string): Promise<ContactContext> {
  const [{ data: contact }, { data: tagRows }] = await Promise.all([
    supabase
      .from("contacts")
      .select("display_name, lead_temperature, next_followup_date, ai_conversation_summary")
      .eq("id", contactId)
      .maybeSingle(),
    supabase.from("contact_tags").select("tags(name)").eq("contact_id", contactId),
  ]);

  const tags = ((tagRows ?? []) as Array<{ tags: { name: string } | { name: string }[] | null }>)
    .flatMap((row) => (Array.isArray(row.tags) ? row.tags : row.tags ? [row.tags] : []))
    .map((t) => t.name)
    .filter(Boolean);

  return {
    name: contact?.display_name ?? null,
    leadTemperature: contact?.lead_temperature ?? null,
    tags,
    nextFollowupDate: contact?.next_followup_date ?? null,
    summary: contact?.ai_conversation_summary ?? null,
  };
}
