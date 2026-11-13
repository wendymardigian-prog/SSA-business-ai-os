"use server";
// @plantilla-quitar(servicios)

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { svcRpc, svcSchema } from "@/lib/services/db";
import { serviceAllowedForCall } from "@/lib/calls/service-link-options";
import { parseManualSummary, withManualSummary, type ManualSummaryInput } from "@/lib/calls/manual-summary";
import type { Json } from "@/lib/types/database";
import { createCallTask } from "@/lib/tasks/from-call";
import { memberDisplayName } from "@/lib/workspace-members";

/**
 * Reuniones unidas al servicio (Servicios A4, F135, F137 y F141). Capa fina: el permiso, zod y el negocio de la
 * sesión. La regla vive en la base (`svc_call_link_apply`) y en `lib/calls/*`. Nunca lanza al cliente.
 */

type Result<T = null> = { ok: true; data: T } | { ok: false; error: string };
const NOT_ALLOWED = "No tenés permiso para hacer esto.";
const uuid = z.string().uuid();

function refresh(callId?: string) {
  revalidatePath("/dashboard/llamadas");
  if (callId) revalidatePath(`/dashboard/llamadas/${callId}`);
  revalidatePath("/dashboard/clientes");
}

/** Vincular (o desvincular, con null) una reunión a un servicio. Queda `manual`: lo automático no lo rehace. */
export async function linkCallToService(raw: { callId: string; serviceId: string | null }): Promise<Result> {
  try {
    const parsed = z.object({ callId: uuid, serviceId: uuid.nullable() }).safeParse(raw);
    if (!parsed.success) return { ok: false, error: "Ese servicio no existe." };
    const ctx = await getPermissionAction("calls.edit");
    if (!ctx) return { ok: false, error: NOT_ALLOWED };
    // La reunión con la sesión: si no la ve, no existe.
    const { data: call } = await ctx.supabase
      .from("calls")
      .select("id, workspace_id, contact_id, service_id, service_link")
      .eq("id", parsed.data.callId)
      .eq("workspace_id", ctx.workspace.id)
      .maybeSingle();
    if (!call) return { ok: false, error: "No encontré la reunión." };
    const row = call as { id: string; workspace_id: string; contact_id: string | null; service_id: string | null; service_link: string | null };

    if (parsed.data.serviceId) {
      // El servicio tiene que ser visible para quien lo hace y del mismo contacto.
      const { data: svc } = await svcSchema(ctx.supabase)
        .from("services")
        .select("id, workspace_id, contact_id")
        .eq("id", parsed.data.serviceId)
        .maybeSingle();
      const s = svc as { id: string; workspace_id: string; contact_id: string } | null;
      if (!serviceAllowedForCall(s ? { contactId: s.contact_id, workspaceId: s.workspace_id } : null, { contactId: row.contact_id, workspaceId: ctx.workspace.id })) {
        return { ok: false, error: "Ese servicio no es del contacto de esta reunión." };
      }
    }

    const service = await createServiceClient();
    const { error } = await service
      .from("calls")
      .update({ service_id: parsed.data.serviceId, service_link: "manual" } as never)
      .eq("id", row.id)
      .eq("workspace_id", ctx.workspace.id);
    if (error) {
      console.error("[reuniones] no pude vincular el servicio:", error.message);
      return { ok: false, error: "No pude guardar el cambio." };
    }
    await logAudit({
      supabase: ctx.supabase,
      workspaceId: ctx.workspace.id,
      entityType: "call",
      entityId: row.id,
      action: "call.service_linked",
      changes: { service_id: { old: row.service_id, new: parsed.data.serviceId }, service_link: { old: row.service_link, new: "manual" } },
      performedBy: ctx.user.id,
    });
    // Un paso «cuando hay grabación» de ese servicio se completa al quedar vinculada (F138).
    if (parsed.data.serviceId) {
      const done = await svcRpc<number>(service, "svc_call_complete_recorded", { p_call_id: row.id });
      if (!done.ok) console.error("[reuniones] no pude completar el paso de la reunión:", done.error.message);
    }
    refresh(row.id);
    return { ok: true, data: null };
  } catch (error) {
    console.error("[reuniones] vincular falló:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pude guardar el cambio." };
  }
}

/** «Vincular las reuniones de este servicio» (F137): la regla de F135 sobre las grabaciones del contacto sin servicio. */
export async function linkServiceCalls(raw: { serviceId: string }): Promise<Result<{ linked: number; review: number }>> {
  try {
    const parsed = z.object({ serviceId: uuid }).safeParse(raw);
    if (!parsed.success) return { ok: false, error: "Ese servicio no existe." };
    const ctx = await getPermissionAction("calls.edit");
    if (!ctx) return { ok: false, error: NOT_ALLOWED };
    const { data: svc } = await svcSchema(ctx.supabase)
      .from("services")
      .select("id, workspace_id, contact_id")
      .eq("id", parsed.data.serviceId)
      .eq("workspace_id", ctx.workspace.id)
      .maybeSingle();
    const s = svc as { id: string; contact_id: string } | null;
    if (!s) return { ok: false, error: "No encontré el servicio." };
    // Las grabaciones del contacto que ve quien lo pide, sin servicio y sin vínculo manual.
    const { data: calls } = await ctx.supabase
      .from("calls")
      .select("id")
      .eq("workspace_id", ctx.workspace.id)
      .eq("contact_id", s.contact_id)
      .is("service_id", null)
      .or("service_link.is.null,service_link.neq.manual")
      .is("archived_at", null)
      .limit(200);
    const service = await createServiceClient();
    let linked = 0;
    let review = 0;
    for (const c of (calls ?? []) as Array<{ id: string }>) {
      const r = await svcRpc<{ action?: string; service_id?: string | null; link?: string | null }>(service, "svc_call_link_apply", { p_call_id: c.id });
      if (!r.ok) continue;
      if (r.data?.service_id) linked += 1;
      else if (r.data?.link === "review") review += 1;
    }
    refresh();
    return { ok: true, data: { linked, review } };
  } catch (error) {
    console.error("[reuniones] vincular las del servicio falló:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pude vincular las reuniones." };
  }
}

/** Cargar una reunión a mano (F141): en `summary.manual`, sin tocar el análisis. */
export async function saveManualSummary(raw: { callId: string } & ManualSummaryInput): Promise<Result> {
  try {
    if (!uuid.safeParse(raw.callId).success) return { ok: false, error: "No encontré la reunión." };
    const parsed = parseManualSummary(raw);
    if (!parsed.ok) return parsed;
    const ctx = await getPermissionAction("calls.edit");
    if (!ctx) return { ok: false, error: NOT_ALLOWED };
    const { data: call } = await ctx.supabase
      .from("calls")
      .select("id, summary")
      .eq("id", raw.callId)
      .eq("workspace_id", ctx.workspace.id)
      .maybeSingle();
    if (!call) return { ok: false, error: "No encontré la reunión." };
    const manual = { ...parsed.value, by: ctx.user.id, at: new Date().toISOString() };
    const service = await createServiceClient();
    const { error } = await service
      .from("calls")
      .update({ summary: withManualSummary((call as { summary: unknown }).summary, manual) as unknown as Json })
      .eq("id", raw.callId)
      .eq("workspace_id", ctx.workspace.id);
    if (error) {
      console.error("[reuniones] no pude guardar la carga a mano:", error.message);
      return { ok: false, error: "No pude guardar. Probá de nuevo." };
    }
    await logAudit({
      supabase: ctx.supabase,
      workspaceId: ctx.workspace.id,
      entityType: "call",
      entityId: raw.callId,
      action: "call.manual_summary",
      metadata: { next_steps: manual.next_steps.length },
      performedBy: ctx.user.id,
    });
    refresh(raw.callId);
    return { ok: true, data: null };
  } catch (error) {
    console.error("[reuniones] la carga a mano falló:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pude guardar. Probá de nuevo." };
  }
}

/**
 * «+ Tarea» desde un próximo paso de una reunión (F155): la tarea nace con la reunión, el contacto y el servicio de la
 * reunión, a cargo de quien la crea. Pide `calls.edit` y `tasks.edit`, y que la persona vea la reunión.
 */
export async function createTaskFromCallStep(raw: { callId: string; title: string }): Promise<Result<{ taskId: string }>> {
  try {
    if (!uuid.safeParse(raw.callId).success) return { ok: false, error: "No encontré la reunión." };
    const ctx = await getPermissionAction("calls.edit");
    if (!ctx || !ctx.can("tasks.edit")) return { ok: false, error: NOT_ALLOWED };
    const { data: call } = await ctx.supabase
      .from("calls")
      .select("id, contact_id, service_id" as never)
      .eq("id", raw.callId)
      .eq("workspace_id", ctx.workspace.id)
      .maybeSingle();
    const c = call as { id: string; contact_id: string | null; service_id: string | null } | null;
    if (!c) return { ok: false, error: "No encontré la reunión." };
    const service = await createServiceClient();
    const res = await createCallTask(service as never, {
      workspaceId: ctx.workspace.id,
      title: raw.title,
      description: null,
      dueDate: null,
      ownerId: ctx.user.id,
      contactId: c.contact_id,
      serviceId: c.service_id,
      callId: c.id,
      createdBy: ctx.user.id,
      actorName: memberDisplayName(ctx.user.user_metadata?.full_name as string | undefined, ctx.user.user_metadata?.name as string | undefined, ctx.user.email),
    });
    if (!res.ok) return { ok: false, error: res.reason };
    revalidatePath("/dashboard/tareas");
    refresh(c.id);
    return { ok: true, data: { taskId: res.id } };
  } catch (error) {
    console.error("[reuniones] no pude crear la tarea desde la reunión:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pude crear la tarea. Probá de nuevo." };
  }
}
