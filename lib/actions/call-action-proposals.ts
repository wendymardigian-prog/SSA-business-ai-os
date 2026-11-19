"use server";
// @plantilla-quitar(servicios)

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getMemberAction } from "@/lib/auth/guards";
import { isAdminRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { memberDisplayName } from "@/lib/workspace-members";
import { svcRpc, svcSchema } from "@/lib/services/db";
import { todayIn } from "@/lib/services/screens/today";
import { createCallTask, dueDateIn } from "@/lib/tasks/from-call";
import { resolveProposal, type MessageDestination, type ResolveDeps, type ResolveOutcome } from "@/lib/calls/proposals-resolve";
import { proposalDestinations, sendProposalMessage, type DestinationOption } from "@/lib/calls/proposal-send";
import { DISCARD_NOTE_MAX, DISCARD_REASONS, type ProposalOriginal } from "@/lib/calls/proposals";
import { resolveCallTaskSettings } from "@/lib/calls/task-settings";
import { ideaRowFromProposal } from "@/lib/calls/summary";
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
    guion: z.string().max(6000).optional(),
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
  discardReason?: string | null;
  discardNote?: string | null;
}): Promise<ResolveOutcome> {
  try {
    const parsed = z
      .object({
        callId: uuid,
        proposalId: z.string().min(1).max(80),
        decision: z.enum(["approve", "discard"]),
        edits: editsSchema,
        destination: destSchema,
        discardReason: z.enum(DISCARD_REASONS).nullable().optional(),
        discardNote: z.string().max(DISCARD_NOTE_MAX).nullable().optional(),
      })
      .safeParse(raw);
    if (!parsed.success) return { ok: false, status: "rejected", error: "Revisá los datos de la propuesta." };
    const ctx = await getMemberAction();
    if (!ctx) return { ok: false, status: "rejected", error: "Tu sesión venció. Volvé a entrar." };
    const service = await createServiceClient();
    const ws = ctx.workspace.id;
    const actorName = memberDisplayName(ctx.user.user_metadata?.full_name as string | undefined, ctx.user.user_metadata?.name as string | undefined, ctx.user.email);
    let contactId: string | null = null;
    let callInfo: { recordedAt: string; title: string } | null = null;
    const { data: wsRow } = await service.from("workspaces").select("ai_background_settings").eq("id", ws).maybeSingle();
    const approvers = resolveCallTaskSettings((wsRow as { ai_background_settings?: unknown } | null)?.ai_background_settings).call_analysis.proposal_approvers;

    /** La fila del banco de ideas para una propuesta de contenido (con la fecha de la grabación y el contacto). */
    const ideaRow = async (proposal: ProposalOriginal) => {
      let contactName: string | null = null;
      if (contactId) {
        const { data: contact } = await service.from("contacts").select("display_name, email").eq("id", contactId).eq("workspace_id", ws).maybeSingle();
        contactName = (contact as { display_name: string | null; email: string | null } | null)?.display_name || (contact as { email: string | null } | null)?.email || null;
      }
      return ideaRowFromProposal(proposal, { recordedAt: callInfo?.recordedAt ?? new Date().toISOString(), contactName, timeZone: ctx.workspace.timezone ?? "UTC" });
    };
    /** Inserta la idea con la sesión de quien aprueba (la RLS de Contenido decide), al final de «nuevas». */
    const insertIdea = async (proposal: ProposalOriginal, callId: string): Promise<{ ok: true; id: string } | { ok: false; reason: string }> => {
      const row = await ideaRow(proposal);
      if (!row) return { ok: false, reason: "La idea no es válida: revisá el título." };
      const { data: last } = await ctx.supabase.from("content_ideas").select("position").eq("workspace_id", ws).eq("status", "nueva").order("position", { ascending: false }).limit(1).maybeSingle();
      const { data, error } = await ctx.supabase
        .from("content_ideas")
        .insert({ ...row, workspace_id: ws, source: "call" as const, call_id: callId, status: "nueva" as const, created_by: ctx.user.id, position: ((last as { position: number } | null)?.position ?? 0) + 10 })
        .select("id")
        .single();
      if (error || !data) {
        console.error("[propuestas] no pude crear la idea:", error?.code ?? "?");
        return { ok: false, reason: "No pude crear la idea de contenido. Probá de nuevo." };
      }
      return { ok: true, id: (data as { id: string }).id };
    };

    const deps: ResolveDeps = {
      async loadCall(callId) {
        const { data } = await ctx.supabase
          .from("calls")
          .select("id, workspace_id, contact_id, service_id, recorded_by_user_id, recorded_at, title, proposals")
          .eq("id", callId)
          .eq("workspace_id", ws)
          .maybeSingle();
        const c = data as { id: string; workspace_id: string; contact_id: string | null; service_id: string | null; recorded_by_user_id: string | null; recorded_at: string; title: string; proposals: unknown } | null;
        if (!c) return null;
        contactId = c.contact_id;
        callInfo = { recordedAt: c.recorded_at, title: c.title };
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
      async createIdea(input) {
        const r = await insertIdea(input.proposal, input.callId);
        return r.ok ? { ok: true, id: r.id } : r;
      },
      async createDraft(input) {
        const idea = await insertIdea(input.proposal, input.callId);
        if (!idea.ok) return idea;
        // La idea se aprueba en el acto (la misma función de siempre, con la sesión) y la pieza nace en Borrador.
        const { data: postId, error } = await ctx.supabase.rpc("approve_content_idea_v2", { p_idea_id: idea.id, p_title: input.proposal.titulo, p_format: input.proposal.formato ?? undefined });
        if (error || !postId) {
          console.error("[propuestas] no pude crear la pieza del borrador:", error?.code ?? "?");
          // Que no quede una idea suelta a medias: se archiva.
          await service.from("content_ideas").update({ deleted_at: new Date().toISOString() }).eq("id", idea.id).eq("workspace_id", ws);
          return { ok: false, reason: "No pude crear la pieza en Borrador. Probá de nuevo." };
        }
        const { error: scriptError } = await ctx.supabase.from("content_posts").update({ script: input.proposal.guion ?? "" }).eq("id", postId as string);
        if (scriptError) console.error("[propuestas] la pieza quedó sin guion:", scriptError.code ?? "?");
        return { ok: true, id: postId as string, ideaId: idea.id };
      },
      approvers,
      isAdmin: isAdminRole(ctx.role),
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
    if (outcome.ok && outcome.result && (outcome.result.idea_id || outcome.result.post_id)) revalidatePath("/dashboard/content");
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
