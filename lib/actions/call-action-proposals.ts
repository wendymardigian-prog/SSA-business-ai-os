"use server";
// @plantilla-quitar(servicios)

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getMemberAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { memberDisplayName } from "@/lib/workspace-members";
import { svcRpc, svcSchema } from "@/lib/services/db";
import { todayIn } from "@/lib/services/screens/today";
import { createCallTask, dueDateIn } from "@/lib/tasks/from-call";
import { resolveProposal, type MessageDestination, type ResolveDeps, type ResolveOutcome } from "@/lib/calls/proposals-resolve";
import { proposalDestinations, sendProposalMessage, type DestinationOption } from "@/lib/calls/proposal-send";
import type { ProposalOriginal } from "@/lib/calls/proposals";
import type { Json } from "@/lib/types/database";

/**
 * Las propuestas del analizador desde el detalle de la reunión (Servicios A4, F143 y F144). Capa fina: arma las
 * dependencias reales y llama al núcleo (`lib/calls/proposals-resolve.ts`), que es lo que se prueba. Nunca lanza.
 */

const uuid = z.string().uuid();
const editsSchema = z
  .object({
    titulo: z.string().max(200).optional(),
    detalle: z.string().max(2000).optional(),
    vence_en_dias: z.number().int().min(0).max(60).nullable().optional(),
    responsable: z.enum(["servicio", "grabo"]).nullable().optional(),
    texto: z.string().max(1500).optional(),
    para: z.enum(["servicio", "grabo"]).optional(),
  })
  .strict()
  .nullable()
  .optional();
const destSchema = z.object({ kind: z.enum(["conversation", "group"]), id: uuid }).nullable().optional();

export async function resolveCallProposal(raw: {
  callId: string;
  proposalId: string;
  decision: "approve" | "discard";
  edits?: Partial<ProposalOriginal> | null;
  destination?: MessageDestination | null;
}): Promise<ResolveOutcome> {
  try {
    const parsed = z
      .object({ callId: uuid, proposalId: z.string().min(1).max(80), decision: z.enum(["approve", "discard"]), edits: editsSchema, destination: destSchema })
      .safeParse(raw);
    if (!parsed.success) return { ok: false, status: "rejected", error: "Revisá los datos de la propuesta." };
    const ctx = await getMemberAction();
    if (!ctx) return { ok: false, status: "rejected", error: "Tu sesión venció. Volvé a entrar." };
    const service = await createServiceClient();
    const ws = ctx.workspace.id;
    const actorName = memberDisplayName(ctx.user.user_metadata?.full_name as string | undefined, ctx.user.user_metadata?.name as string | undefined, ctx.user.email);
    let contactId: string | null = null;

    const deps: ResolveDeps = {
      async loadCall(callId) {
        const { data } = await ctx.supabase
          .from("calls")
          .select("id, workspace_id, contact_id, service_id, recorded_by_user_id, proposals")
          .eq("id", callId)
          .eq("workspace_id", ws)
          .maybeSingle();
        const c = data as { id: string; workspace_id: string; contact_id: string | null; service_id: string | null; recorded_by_user_id: string | null; proposals: unknown } | null;
        if (!c) return null;
        contactId = c.contact_id;
        return { id: c.id, workspaceId: c.workspace_id, contactId: c.contact_id, serviceId: c.service_id, recordedBy: c.recorded_by_user_id, proposals: c.proposals };
      },
      can: (key) => ctx.can(key),
      async claim(callId, proposalId) {
        const { data, error } = await service.rpc("call_proposal_claim", { p_call_id: callId, p_proposal_id: proposalId });
        if (error) throw new Error(error.message);
        return data === true;
      },
      async patch(callId, proposalId, patch) {
        const { error } = await service.rpc("call_proposal_patch", { p_call_id: callId, p_proposal_id: proposalId, p_patch: patch as unknown as Json });
        if (error) console.error("[propuestas] no pude guardar el estado:", error.message);
      },
      async serviceOwner(serviceId) {
        const { data } = await svcSchema(service).from("services").select("owner_user_id").eq("id", serviceId).eq("workspace_id", ws).maybeSingle();
        return (data as { owner_user_id: string | null } | null)?.owner_user_id ?? null;
      },
      async createTask(input) {
        return createCallTask(service, {
          workspaceId: ws,
          title: input.title,
          description: input.description,
          dueDate: dueDateIn(input.dueInDays, todayIn(ctx.workspace.timezone)),
          ownerId: input.ownerId,
          contactId: input.contactId,
          serviceId: input.serviceId,
          callId: input.callId,
          createdBy: ctx.user.id,
          actorName,
        });
      },
      async completeStep(serviceId, itemKey) {
        const { data } = await svcSchema(service)
          .from("service_items")
          .select("id")
          .eq("service_id", serviceId)
          .eq("template_key", itemKey)
          .eq("status", "pending")
          .eq("is_recurring_template", false)
          .order("occurrence_index", { ascending: true, nullsFirst: true })
          .limit(1)
          .maybeSingle();
        const itemId = (data as { id: string } | null)?.id;
        if (!itemId) return { ok: false, reason: "Ese paso ya no está pendiente." };
        // Con la sesión: mira services.items y su alcance, y respeta bloqueo y evidencia (SV033 / SV034).
        const r = await svcRpc<boolean>(ctx.supabase, "svc_complete_item", { p_item_id: itemId });
        if (!r.ok) return { ok: false, reason: r.error.message };
        return { ok: true, id: itemId };
      },
      async sendMessage(input) {
        if (!contactId) return { ok: false, reason: "La reunión no tiene contacto." };
        return sendProposalMessage(
          { supabase: ctx.supabase, service, workspaceId: ws, userId: ctx.user.id, permissions: ctx.permissions, isAdmin: ctx.role === "owner" || ctx.role === "admin", contactId },
          input,
        );
      },
      async notify(input) {
        const { data, error } = await service
          .from("notifications")
          .insert({ workspace_id: ws, type: "call_note", title: input.title || "Aviso de una reunión", body: input.body || null, entity_type: "call", entity_id: input.callId, recipient_id: input.recipientId, metadata: {} })
          .select("id")
          .single();
        if (error || !data) return { ok: false, reason: "No pude mandar el aviso." };
        return { ok: true, id: (data as { id: string }).id };
      },
      async audit(input) {
        await logAudit({
          supabase: ctx.supabase,
          workspaceId: ws,
          entityType: "call",
          entityId: input.callId,
          action: input.action,
          changes: input.changes as never,
          metadata: input.metadata as Record<string, Json>,
          performedBy: ctx.user.id,
        });
      },
      now: () => new Date(),
    };

    const outcome = await resolveProposal(deps, { ...parsed.data, edits: parsed.data.edits ?? null, destination: parsed.data.destination ?? null, actorId: ctx.user.id });
    revalidatePath(`/dashboard/llamadas/${parsed.data.callId}`);
    revalidatePath("/dashboard/llamadas");
    return outcome;
  } catch (error) {
    console.error("[propuestas] resolver falló:", error instanceof Error ? error.message : error);
    return { ok: false, status: "failed", error: "No se pudo hacer. Probá de nuevo." };
  }
}

/** Los destinos del mensaje para el cliente: los chats del contacto donde puede responder y los grupos que puede escribir. */
export async function loadProposalDestinations(raw: { callId: string }): Promise<{ ok: true; data: DestinationOption[] } | { ok: false; error: string }> {
  try {
    if (!uuid.safeParse(raw.callId).success) return { ok: false, error: "No encontré la reunión." };
    const ctx = await getMemberAction();
    if (!ctx || !ctx.can("calls.edit")) return { ok: false, error: "No tenés permiso." };
    const { data } = await ctx.supabase.from("calls").select("contact_id").eq("id", raw.callId).eq("workspace_id", ctx.workspace.id).maybeSingle();
    const contactId = (data as { contact_id: string | null } | null)?.contact_id;
    if (!contactId) return { ok: true, data: [] };
    const service = await createServiceClient();
    const options = await proposalDestinations({ supabase: ctx.supabase, service, workspaceId: ctx.workspace.id, permissions: ctx.permissions, isAdmin: ctx.role === "owner" || ctx.role === "admin", contactId });
    return { ok: true, data: options };
  } catch {
    return { ok: false, error: "No pude leer los destinos." };
  }
}
