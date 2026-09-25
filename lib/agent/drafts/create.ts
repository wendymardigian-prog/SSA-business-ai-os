import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { messagingWindowHours, sendableUntil } from "@/lib/messaging-window";
import { LIVE_DRAFT_STATUSES, type AppliedAction, type SuggestedAction } from "./types";

/**
 * Deja el borrador de un turno en modo borrador.
 *
 * Un solo borrador vivo por conversacion, garantizado por el indice unico
 * parcial agent_drafts_one_open_per_conversation (pending, sending, failed).
 * Este modulo decide que hacer ANTES de chocar con el indice:
 *
 *   1. Si ya hay algo mas nuevo que la rafaga que responde este turno (un
 *      entrante posterior, o un borrador vivo que responde una rafaga
 *      posterior), el borrador nace `superseded`: queda el run y el rastro, y
 *      un turno lento no pisa una respuesta mas fresca.
 *   2. Si el vivo esta en `sending`, no es un conflicto: es un "todavia no".
 *      Alguien lo esta aprobando en este instante. Devuelve
 *      blocked_by_in_flight_send sin insertar y el turno se reprograma.
 *   3. Si el vivo esta en pending o failed, se reemplaza (superseded) y se
 *      inserta el nuevo.
 *   4. Si el insert choca igual con el indice (otro turno en el medio), se
 *      reintenta una vez desde 1.
 *
 * Escribe con el service role (agent_drafts no tiene policy de INSERT).
 */

type Db = SupabaseClient<Database>;

export interface CreateDraftInput {
  workspaceId: string;
  agentId: string | null;
  conversationId: string;
  contactId: string;
  channelId: string;
  runId: string | null;
  body: string | null;
  bodyParts: string[] | null;
  noReplyReason: string | null;
  suggestedActions: SuggestedAction[];
  appliedActions: AppliedAction[];
  /** Los entrantes que responde, del mas viejo al mas nuevo. */
  burst: Array<{ id: string; created_at: string }>;
  previousDraftId?: string | null;
  regenerateInstruction?: string | null;
}

export type CreateDraftResult =
  | { kind: "created"; draftId: string }
  | { kind: "superseded_on_create"; draftId: string | null }
  | { kind: "blocked_by_in_flight_send" }
  | { kind: "failed"; message: string };

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : -Infinity);

export async function createDraft(service: Db, input: CreateDraftInput): Promise<CreateDraftResult> {
  const burstIds = input.burst.map((m) => m.id);
  const burstStartedAt = input.burst[0]?.created_at ?? null;
  const burstLastAt = input.burst.at(-1)?.created_at ?? null;

  const { data: channel } = await service
    .from("channels")
    .select("platform, messaging_window_hours")
    .eq("id", input.channelId)
    .maybeSingle();
  const windowHours = channel ? messagingWindowHours(channel) : 0;

  const row = (status: "pending" | "superseded") => ({
    workspace_id: input.workspaceId,
    agent_id: input.agentId,
    conversation_id: input.conversationId,
    contact_id: input.contactId,
    channel_id: input.channelId,
    run_id: input.runId,
    status,
    body: input.body,
    body_parts: (input.bodyParts ?? null) as Json | null,
    no_reply_reason: input.body ? null : (input.noReplyReason ?? "escalate"),
    suggested_actions: input.suggestedActions as unknown as Json,
    applied_actions: input.appliedActions as unknown as Json,
    burst_message_ids: burstIds,
    burst_started_at: burstStartedAt,
    burst_last_inbound_at: burstLastAt,
    sendable_until: sendableUntil(burstLastAt, windowHours),
    previous_draft_id: input.previousDraftId ?? null,
    regenerate_instruction: input.regenerateInstruction ?? null,
  });

  for (let attempt = 1; attempt <= 2; attempt++) {
    const [{ data: newest }, { data: live }] = await Promise.all([
      service
        .from("messages")
        .select("id, created_at")
        .eq("conversation_id", input.conversationId)
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      service
        .from("agent_drafts")
        .select("id, status, burst_last_inbound_at")
        .eq("conversation_id", input.conversationId)
        .in("status", LIVE_DRAFT_STATUSES)
        .maybeSingle(),
    ]);

    // 1. Algo mas nuevo que esta rafaga: este borrador ya nacio viejo.
    const newerInbound = newest && !burstIds.includes(newest.id) && ms(newest.created_at) > ms(burstLastAt);
    const newerDraft = live && ms(live.burst_last_inbound_at) > ms(burstLastAt);
    if (newerInbound || newerDraft) {
      const { data, error } = await service.from("agent_drafts").insert(row("superseded")).select("id").single();
      if (error) console.error("[drafts] no pude guardar el borrador reemplazado:", error.message);
      return { kind: "superseded_on_create", draftId: data?.id ?? null };
    }

    // 2. Alguien lo esta enviando en este instante.
    if (live?.status === "sending") return { kind: "blocked_by_in_flight_send" };

    // 3. Reemplaza al vivo anterior.
    if (live) {
      await service
        .from("agent_drafts")
        .update({ status: "superseded" })
        .eq("id", live.id)
        .in("status", ["pending", "failed"]);
    }

    const { data, error } = await service.from("agent_drafts").insert(row("pending")).select("id").single();
    if (!error && data) return { kind: "created", draftId: data.id };
    if (error?.code !== "23505") {
      console.error("[drafts] no pude guardar el borrador:", error?.message ?? "sin fila");
      return { kind: "failed", message: "No se pudo guardar el borrador." };
    }
    // 4. Choco con el indice: otro turno se metio en el medio. Una vuelta mas.
  }

  return { kind: "failed", message: "No se pudo guardar el borrador: otro turno escribio al mismo tiempo." };
}
