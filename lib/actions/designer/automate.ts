"use server";

/**
 * El Diseñador IA en las automatizaciones (DS7, F57 y F60).
 *
 * - "Automatizar" desde una plantilla: crea un borrador de automatización con "Formulario enviado", el paso
 *   "Generar desde plantilla" y un "Enviar email" con el link y el PDF. Pide `flows.edit` y `designer.view`.
 * - El panel del paso en el lienzo: la lista de plantillas y las variables de una. Piden `flows.edit`; la tabla la lee
 *   el cliente de la PERSONA, así que sin `designer.view` la RLS no devuelve ninguna plantilla (se oculta, no se rompe).
 *
 * Todo con el workspace de la SESIÓN.
 */

import { revalidatePath } from "next/cache";
import type { Json } from "@/lib/types/database";
import { getPermissionAction, type PermissionContext } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import type { ActionResult } from "@/lib/designer/contracts";
import { designFlowName, designFlowTemplate } from "@/lib/designer/automation/flow-template";
import { mappingRows, type MappingRow } from "@/lib/designer/automation/node-config";
import { docVariables, parseDesignDoc } from "@/lib/designer/doc/schema";
import { variableInfo, type CustomVar } from "@/lib/designer/variables/catalog";
import { docTypeNoun, isDocType } from "@/lib/designer/verification";

const NO_PERMISSION = "No tenés permiso para hacer esto.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TemplateRow {
  id: string;
  name: string;
  format: string;
  doc: unknown;
  custom_vars: unknown;
  verify: boolean;
  doc_type: string | null;
  doc_type_label: string | null;
  archived_at: string | null;
}

async function flowsContext(): Promise<PermissionContext | null> {
  try {
    return await getPermissionAction("flows.edit");
  } catch {
    return null;
  }
}

async function readTemplate(ctx: PermissionContext, templateId: string): Promise<TemplateRow | null> {
  if (!UUID_RE.test(templateId)) return null;
  const { data, error } = await ctx.supabase
    .from("design_templates")
    .select("id, name, format, doc, custom_vars, verify, doc_type, doc_type_label, archived_at")
    .eq("id", templateId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (error) {
    console.error("[designer] no pude leer la plantilla:", error.message);
    return null;
  }
  return (data as TemplateRow | null) ?? null;
}

function customVarsOf(row: Pick<TemplateRow, "custom_vars">): CustomVar[] {
  return Array.isArray(row.custom_vars) ? (row.custom_vars as unknown as CustomVar[]).filter((v) => v && typeof v.key === "string" && typeof v.label === "string") : [];
}

function nounOf(row: Pick<TemplateRow, "verify" | "doc_type" | "doc_type_label">): string | null {
  return row.verify && isDocType(row.doc_type) ? docTypeNoun(row.doc_type, row.doc_type_label).toLowerCase() : null;
}

function flowsUsing(flows: Array<{ id: string; name: string; status: string }>): { id: string; name: string; href: string; status: string }[] {
  return flows.map((f) => ({ id: f.id, name: f.name, status: f.status, href: `/dashboard/flows/${f.id}` }));
}

export async function createAutomationFromTemplate(input: { templateId: string }): Promise<ActionResult<{ flowId: string; href: string }>> {
  const ctx = await flowsContext();
  if (!ctx || !ctx.can("designer.view")) return { ok: false, error: NO_PERMISSION };
  const template = await readTemplate(ctx, String(input?.templateId ?? ""));
  if (!template) return { ok: false, error: "No encontré esa plantilla." };
  if (template.archived_at) return { ok: false, error: "La plantilla está archivada: restaurala para automatizarla." };

  const graph = designFlowTemplate({ id: template.id, name: template.name, docNoun: nounOf(template) });
  const { data, error } = await ctx.supabase
    .from("flows")
    .insert({
      workspace_id: ctx.workspace.id,
      name: designFlowName(template.name),
      description: "Genera la pieza de la plantilla con los datos del formulario y la manda por email.",
      status: "draft",
      nodes: graph.nodes as unknown as Json,
      edges: graph.edges as unknown as Json,
      categories: ["Diseñador IA"],
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[designer] no pude crear la automatización:", error?.message ?? "sin fila");
    return { ok: false, error: "No pude crear la automatización. Probá de nuevo." };
  }

  try {
    await logAudit({
      supabase: ctx.supabase,
      workspaceId: ctx.workspace.id,
      entityType: "design_template",
      entityId: template.id,
      action: "design_template.automation_created",
      performedBy: ctx.user.id,
      metadata: { flow_id: data.id },
    });
  } catch (auditError) {
    console.error("[designer] no pude anotar la automatización en el historial:", auditError instanceof Error ? auditError.message : "error");
  }
  revalidatePath("/dashboard/flows");
  return { ok: true, data: { flowId: data.id, href: `/dashboard/flows/${data.id}` } };
}

/** Las automatizaciones que ya usan la plantilla (lo que corre o el borrador), para listarlas con su link. */
export async function automationsUsingTemplate(input: { templateId: string }): Promise<ActionResult<{ id: string; name: string; href: string; status: string }[]>> {
  const ctx = await getPermissionAction("flows.view").catch(() => null);
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const templateId = String(input?.templateId ?? "");
  if (!UUID_RE.test(templateId)) return { ok: true, data: [] };
  const needle = JSON.stringify([{ data: { templateId } }]);
  const [live, draft] = await Promise.all([
    ctx.supabase.from("flows").select("id, name, status").eq("workspace_id", ctx.workspace.id).filter("nodes", "cs", needle).limit(50),
    ctx.supabase.from("flows").select("id, name, status").eq("workspace_id", ctx.workspace.id).filter("draft_nodes", "cs", needle).limit(50),
  ]);
  if (live.error || draft.error) {
    console.error("[designer] no pude buscar las automatizaciones de la plantilla:", (live.error ?? draft.error)?.message);
    return { ok: false, error: "No pude ver qué automatizaciones la usan." };
  }
  const byId = new Map<string, { id: string; name: string; status: string }>();
  for (const f of [...(live.data ?? []), ...(draft.data ?? [])]) byId.set(f.id as string, f as { id: string; name: string; status: string });
  return { ok: true, data: flowsUsing([...byId.values()]) };
}

/** Las plantillas que se pueden elegir en el paso (no archivadas). */
export async function templatesForAutomation(): Promise<ActionResult<{ id: string; name: string; format: string; docNoun: string | null }[]>> {
  const ctx = await flowsContext();
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  // Sin `designer.view` la RLS no devolvería ninguna: mejor decirlo que mostrar «Todavía no hay plantillas».
  if (!ctx.can("designer.view")) return { ok: false, error: "No tenés acceso al Diseñador IA: pedile a un Admin que te lo dé para elegir una plantilla." };
  const { data, error } = await ctx.supabase
    .from("design_templates")
    .select("id, name, format, verify, doc_type, doc_type_label")
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("[designer] no pude listar las plantillas:", error.message);
    return { ok: false, error: "No pude cargar las plantillas." };
  }
  return { ok: true, data: (data ?? []).map((t) => ({ id: t.id, name: t.name, format: t.format, docNoun: nounOf(t as TemplateRow) })) };
}

/** Las variables que usa una plantilla, para las filas «Con qué se llena cada variable» del panel. */
export async function templateVariablesForAutomation(input: { templateId: string }): Promise<ActionResult<{ name: string; rows: MappingRow[] }>> {
  const ctx = await flowsContext();
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const template = await readTemplate(ctx, String(input?.templateId ?? ""));
  if (!template) return { ok: false, error: "No encontré esa plantilla." };
  const parsed = parseDesignDoc(template.doc);
  const customVars = customVarsOf(template);
  const used = parsed.ok ? docVariables(parsed.doc) : [];
  return { ok: true, data: { name: template.name, rows: mappingRows(used, customVars, (key) => variableInfo(key, { customVars })) } };
}
