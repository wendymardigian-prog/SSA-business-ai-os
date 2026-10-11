"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction, type PermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import type { Json } from "@/lib/types/database";
import type { FormType } from "@/lib/forms/fields";
import { appUrl } from "@/lib/app-url";
import { buildDesiredTriggers } from "@/lib/flow-triggers";
import { sendTransactionalEmail } from "@/lib/email/send";
import { bodyToHtml } from "@/lib/flow-engine/nodes/send-email";
import { interpolateVariables } from "@/lib/flow-engine/interpolate";
import { flowToLinear, linearToFlow, type LinearFlow } from "@/lib/scheduling/automation/linear-flow";
import { blankFormFlowGraph, formFlowName, formTemplateByKey, formTemplateGraph, nextAutomationName, type FormTemplateKey } from "@/lib/forms/automation/templates";
import { emptyFormVariables } from "@/lib/forms/automation/variables";
import { formFlowGraph } from "@/lib/forms/data/form-flows";

/**
 * Las automatizaciones de un formulario (F21). Con `forms.manage` y `flows.edit`.
 *
 * Prender un flujo es publicar el flow y activar su trigger (`buildDesiredTriggers`,
 * igual que al publicar desde el canvas). Apagarlo lo deja en borrador. Los flujos
 * nunca se borran al archivar el formulario: siguen en Automatizaciones.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_PERMISSION = "No tenés permiso para administrar las automatizaciones de formularios";

export type FormFlowResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

async function context(): Promise<PermissionContext | null> {
  const ctx = await getPermissionAction("forms.manage");
  return ctx && ctx.can("flows.edit") ? ctx : null;
}

function refresh(formId: string, flowId?: string) {
  revalidatePath(`/dashboard/formularios/${formId}`);
  if (flowId) revalidatePath(`/dashboard/formularios/${formId}/automatizaciones/${flowId}`);
  revalidatePath("/dashboard/flows");
}

type OwnedFlow =
  | { error: string; ctx?: undefined; found?: undefined }
  | { error?: undefined; ctx: PermissionContext; found: NonNullable<Awaited<ReturnType<typeof formFlowGraph>>> & { formId: string } };

async function ownedFlow(flowId: string): Promise<OwnedFlow> {
  const ctx = await context();
  if (!ctx) return { error: NO_PERMISSION };
  if (!UUID.test(flowId)) return { error: "No encontré esa automatización." };
  const found = await formFlowGraph(ctx.supabase, flowId);
  if (!found || found.flow.workspace_id !== ctx.workspace.id || !found.flow.form_id) return { error: "No encontré esa automatización." };
  return { ctx, found: { ...found, formId: found.flow.form_id } };
}

async function loadForm(ctx: PermissionContext, formId: string) {
  if (!UUID.test(formId)) return null;
  const { data } = await ctx.supabase.from("forms").select("id, name, type, status").eq("id", formId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  return data ? { id: data.id, name: data.name, type: data.type as FormType, status: data.status } : null;
}

async function namesTaken(ctx: PermissionContext, formId: string): Promise<string[]> {
  const { data } = await ctx.supabase.from("flows").select("name").eq("form_id", formId).is("deleted_at", null);
  return (data ?? []).map((r) => r.name);
}

async function audit(ctx: PermissionContext, formId: string, metadata: Record<string, Json>) {
  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "form",
    entityId: formId,
    action: "form.updated",
    metadata,
    performedBy: ctx.user.id,
  });
}

/** "+ Nueva automatización": un flow en borrador con solo el trigger del tipo del formulario. */
export async function createFormFlow(input: { formId: string }): Promise<FormFlowResult<{ flowId: string }>> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const form = await loadForm(ctx, input.formId);
  if (!form) return { ok: false, error: "No encontré ese formulario." };
  if (form.status === "archived") return { ok: false, error: "El formulario está archivado: restauralo para sumarle automatizaciones." };

  const graph = blankFormFlowGraph(form);
  const { data, error } = await ctx.supabase
    .from("flows")
    .insert({
      workspace_id: ctx.workspace.id,
      name: nextAutomationName(form.name, await namesTaken(ctx, form.id)),
      description: null,
      status: "draft",
      nodes: graph.nodes as unknown as Json,
      edges: graph.edges as unknown as Json,
      form_id: form.id,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "No pude crear la automatización. Probá de nuevo." };

  await audit(ctx, form.id, { flow_id: data.id, created: true });
  refresh(form.id);
  return { ok: true, flowId: data.id };
}

/** Una plantilla de un clic. Nace APAGADA, con el email de quien la crea si manda un aviso. */
export async function createFormFlowFromTemplate(input: { formId: string; template: FormTemplateKey; tagName?: string }): Promise<FormFlowResult<{ flowId: string }>> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const form = await loadForm(ctx, input.formId);
  if (!form) return { ok: false, error: "No encontré ese formulario." };
  if (form.status === "archived") return { ok: false, error: "El formulario está archivado: restauralo para sumarle automatizaciones." };

  const template = formTemplateByKey(input.template);
  if (!template || !template.forTypes.includes(form.type)) return { ok: false, error: "Esa plantilla no existe para este tipo de formulario." };

  const tagName = (input.tagName ?? "").trim();
  if (template.needsTag && !tagName) return { ok: false, error: "Elegí el tag que querés ponerle al contacto." };
  const userEmail = ctx.user.email ?? "";
  if (!userEmail && (template.key === "notify_me_email" || template.key === "detractor_alert")) {
    return { ok: false, error: "Tu usuario no tiene email: no hay a dónde mandar el aviso." };
  }

  const graph = formTemplateGraph(template.key, { form, userEmail, tagName });
  const { data, error } = await ctx.supabase
    .from("flows")
    .insert({
      workspace_id: ctx.workspace.id,
      name: formFlowName(form.name, template.name),
      description: template.describe,
      status: "draft",
      nodes: graph.nodes as unknown as Json,
      edges: graph.edges as unknown as Json,
      form_id: form.id,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "No pude crear la automatización. Probá de nuevo." };

  await audit(ctx, form.id, { flow_id: data.id, created: true, template: template.key });
  refresh(form.id);
  return { ok: true, flowId: data.id };
}

/** Prender o apagar un flujo del formulario. */
export async function toggleFormFlow(input: { flowId: string; enabled: boolean }): Promise<FormFlowResult> {
  const owned = await ownedFlow(input.flowId);
  if (owned.error !== undefined) return { ok: false, error: owned.error };
  const { ctx, found } = owned;

  const { error } = await ctx.supabase.from("flows").update({ status: input.enabled ? "published" : "draft" }).eq("id", input.flowId);
  if (error) return { ok: false, error: "No pude guardar el cambio. Probá de nuevo." };

  // El trigger se escribe desde el grafo, igual que al publicar desde el canvas.
  const desired = buildDesiredTriggers(found.nodes as unknown as Array<Record<string, unknown>>, input.flowId);
  await ctx.supabase.from("triggers").delete().eq("flow_id", input.flowId);
  if (desired.length > 0) {
    await ctx.supabase.from("triggers").insert(desired.map((t) => ({ ...t, workspace_id: ctx.workspace.id, is_active: input.enabled })));
  }

  await audit(ctx, found.formId, { flow_id: input.flowId, enabled: input.enabled, name: found.flow.name });
  refresh(found.formId, input.flowId);
  return { ok: true };
}

/** Guardar el flujo desde el editor lineal. */
export async function saveFormLinearFlow(input: { flowId: string; linear: LinearFlow }): Promise<FormFlowResult> {
  const owned = await ownedFlow(input.flowId);
  if (owned.error !== undefined) return { ok: false, error: owned.error };
  const { ctx, found } = owned;

  // Con ramas el editor lineal es de solo lectura: guardar desde acá borraría la rama que no se veía.
  if (flowToLinear(found.nodes, found.edges) === null) {
    return { ok: false, error: "Esta automatización tiene ramas: abrila en el canvas para editarla." };
  }

  const graph = linearToFlow(input.linear);
  const { error } = await ctx.supabase.from("flows").update({ nodes: graph.nodes as unknown as Json, edges: graph.edges as unknown as Json }).eq("id", input.flowId);
  if (error) return { ok: false, error: "No pude guardar. Probá de nuevo." };

  // Si estaba encendido, el trigger se rehace con lo que quedó.
  if (found.flow.status === "published") {
    const desired = buildDesiredTriggers(graph.nodes as unknown as Array<Record<string, unknown>>, input.flowId);
    await ctx.supabase.from("triggers").delete().eq("flow_id", input.flowId);
    if (desired.length > 0) {
      await ctx.supabase.from("triggers").insert(desired.map((t) => ({ ...t, workspace_id: ctx.workspace.id, is_active: true })));
    }
  }

  await audit(ctx, found.formId, { flow_id: input.flowId, saved: true });
  refresh(found.formId, input.flowId);
  return { ok: true };
}

/**
 * "Enviarme una prueba": va SOLO al email de quien edita, nunca al contacto, y se
 * registra con `kind: "flow_test"`. Las variables se reemplazan con valores de
 * ejemplo (`emptyFormVariables`): el flujo todavía no corrió.
 */
export async function sendFormFlowTestEmail(input: { flowId: string; subject: string; body: string }): Promise<FormFlowResult> {
  const owned = await ownedFlow(input.flowId);
  if (owned.error !== undefined) return { ok: false, error: owned.error };
  const { ctx } = owned;
  const to = ctx.user.email ?? "";
  if (!to) return { ok: false, error: "Tu usuario no tiene email." };

  const base = emptyFormVariables();
  const sample = {
    contact: { display_name: "Ana Pérez" },
    ...base,
    answer: { nombre: "Ana Pérez", email: "ana@ejemplo.com" },
    submission: { ...base.submission, id: "ejemplo", url: `${appUrl()}/dashboard/formularios`, score: "9", nps_category: "promoter" },
  };

  const result = await sendTransactionalEmail({
    workspaceId: ctx.workspace.id,
    to,
    subject: interpolateVariables(input.subject || "(sin asunto)", sample),
    html: bodyToHtml(interpolateVariables(input.body, sample)),
    kind: "flow_test",
    relatedEntityType: "flow",
    relatedEntityId: input.flowId,
    createdBy: ctx.user.id,
    deps: { supabase: await createServiceClient() },
  });

  if (!result.ok) {
    return { ok: false, error: result.reason === "not_configured" ? "Resend no está conectado: cargalo en Integraciones." : result.error };
  }
  return { ok: true };
}
