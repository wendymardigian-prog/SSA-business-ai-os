/**
 * «Generar desde plantilla» (Diseñador IA, DS7, F57–F58): un flujo crea una pieza desde una plantilla del Diseñador IA
 * (un certificado, una constancia...) para el contacto del disparador, y deja sus datos para los pasos siguientes.
 *
 * - Los valores salen de las asignaciones del paso (`resolveNodeOverrides`): del disparador, de pasos anteriores, del
 *   contacto, la fecha de hoy, un texto fijo o una combinación. Lo que no se resuelve no se pasa: decide la política de
 *   «si falta un dato» (por defecto, «No generar y avisarme»).
 * - La generación la crea el núcleo de DS6 (`createGeneration`), con `source: "automation"` y la corrida como origen.
 * - Con «Esperar el PDF antes de seguir» (prendido por defecto) el render corre EN EL MOMENTO. Si el servicio falla de
 *   forma pasajera, el paso se deja para después con `deferFlowNode` y se reintenta a 1, 5 y 15 minutos (la misma
 *   generación: el id queda en la sesión); si sigue fallando, el camino termina con el error a la vista y la
 *   generación queda `failed`. Sin esperar, el render va a la cola y el flujo sigue con el estado «En preparación».
 * - Si falta un dato con «No generar», el camino termina con «Falta: …». Nunca sale un certificado vacío.
 * - Deja `design.id`, `design.link`, `design.pdf_url`, `design.code`, `design.status` y `design.doc_type` (los links con
 *   el dominio del negocio, `loadDesignLinks`).
 *
 * NUNCA lanza: un error termina el camino con el paso fallido (lanzar haría fallar el evento entero y la cola volvería a
 * correr TODOS sus flujos).
 */

import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { ContactFlowContext, FlowExecutionContext } from "../types";
import { interpolateVariables } from "../interpolate";
import { deferFlowNode } from "../defer-node";
import {
  DESIGN_GENERATE_LABEL,
  DESIGN_GENERATE_TYPE,
  DESIGN_STOP_HANDLE,
  designGenerateDefaults,
  designGenerateOutputs,
  designGenerateProblem,
  resolveNodeOverrides,
  type DesignGenerateNodeData,
} from "@/lib/designer/automation/node-config";
import { createGeneration } from "@/lib/designer/generate-core";
import { runDesignRender } from "@/lib/designer/jobs/render";
import { loadDesignLinks } from "@/lib/designer/public-links";
import { formatDesignDate, type DateFormat } from "@/lib/designer/variables/catalog";
import { docTypeNoun, isDocType } from "@/lib/designer/verification";

/** La generación que este paso está esperando (por paso), en las variables de la sesión. */
export const DESIGN_PENDING_VAR = "__design_pending";

type Db = NodeExecutionArgs["supabase"];

interface TemplateRow {
  id: string;
  name: string;
  date_format: string;
  verify: boolean;
  doc_type: string | null;
  doc_type_label: string | null;
  archived_at: string | null;
}

interface DesignState {
  id: string;
  code: string;
  status: string;
  error: string | null;
}

/** Las dependencias del paso (se reemplazan en los tests: nada de base, render ni red de verdad). */
export interface DesignGenerateDeps {
  createGeneration: typeof createGeneration;
  runDesignRender: typeof runDesignRender;
  loadDesignLinks: typeof loadDesignLinks;
  now: () => Date;
}

const defaultDeps: DesignGenerateDeps = { createGeneration, runDesignRender, loadDesignLinks, now: () => new Date() };

function pendingMap(context: FlowExecutionContext): Record<string, string> {
  const raw = (context.variables as Record<string, unknown> | undefined)?.[DESIGN_PENDING_VAR];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, string>) : {};
}

function setPending(context: FlowExecutionContext, nodeId: string, designId: string | null): void {
  const all = { ...pendingMap(context) };
  if (designId) all[nodeId] = designId;
  else delete all[nodeId];
  const variables = { ...((context.variables ?? {}) as Record<string, unknown>) };
  if (Object.keys(all).length > 0) variables[DESIGN_PENDING_VAR] = all;
  else delete variables[DESIGN_PENDING_VAR];
  context.variables = variables as FlowExecutionContext["variables"];
}

/** Deja las seis salidas en `variables.design` (las leen la interpolación y Condiciones). */
async function writeOutputs(db: Db, context: FlowExecutionContext, design: DesignState, docType: string, deps: DesignGenerateDeps): Promise<void> {
  const links = await deps.loadDesignLinks(db, context.workspaceId, design.code);
  const variables = { ...((context.variables ?? {}) as Record<string, unknown>) };
  variables.design = {
    id: design.id,
    link: links.link,
    pdf_url: links.pdfUrl,
    code: design.code,
    status: design.status === "rendering" ? "queued" : design.status,
    doc_type: docType,
  };
  context.variables = variables as FlowExecutionContext["variables"];
}

function stop(context: FlowExecutionContext, reason: string): string {
  context.noteStep?.({ status: "failed", reason });
  return DESIGN_STOP_HANDLE;
}

async function readTemplate(db: Db, workspaceId: string, templateId: string): Promise<TemplateRow | null | "error"> {
  const { data, error } = await db
    .from("design_templates")
    .select("id, name, date_format, verify, doc_type, doc_type_label, archived_at")
    .eq("id", templateId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) {
    console.error("[flow-engine] «Generar desde plantilla» no pudo leer la plantilla:", error.message);
    return "error";
  }
  return (data as TemplateRow | null) ?? null;
}

async function readDesign(db: Db, workspaceId: string, designId: string): Promise<DesignState | null | "error"> {
  const { data, error } = await db.from("designs").select("id, code, status, error").eq("id", designId).eq("workspace_id", workspaceId).maybeSingle();
  if (error) {
    console.error("[flow-engine] «Generar desde plantilla» no pudo leer la generación:", error.message);
    return "error";
  }
  return (data as DesignState | null) ?? null;
}

function docTypeOf(template: TemplateRow | null): string {
  if (!template?.verify || !isDocType(template.doc_type)) return "";
  return docTypeNoun(template.doc_type, template.doc_type_label);
}

/**
 * Renderiza la generación en el momento. El render NO se reagenda solo en la cola (lo reintenta este paso): así hay un
 * único reloj de reintentos y nunca dos renders de la misma generación a la vez.
 */
async function renderNow(args: NodeExecutionArgs<DesignGenerateNodeData, ContactFlowContext>, design: DesignState, docType: string, deps: DesignGenerateDeps) {
  const { supabase, context, node, sessionId } = args;
  const outcome = await deps.runDesignRender(supabase, { designId: design.id, purpose: "generation" }, { schedule: async () => ({ id: "" }) });
  if (outcome.status === "rendered") {
    setPending(context, node.id, null);
    await writeOutputs(supabase, context, { ...design, status: "ready", error: null }, docType, deps);
    return undefined;
  }
  if (outcome.status === "retry") {
    setPending(context, node.id, design.id);
    await writeOutputs(supabase, context, { ...design, status: "queued" }, docType, deps);
    return deferFlowNode(supabase, {
      nodeId: node.id,
      nodeType: DESIGN_GENERATE_TYPE,
      sessionId,
      context,
      retryAt: new Date(outcome.at),
      reason: "provider_retry",
      message: `${outcome.error} Se vuelve a intentar solo (intento ${outcome.attempt} de 3).`,
    });
  }
  setPending(context, node.id, null);
  const error = outcome.status === "failed" ? outcome.error : "No se pudo armar el PDF.";
  await writeOutputs(supabase, context, { ...design, status: "failed", error }, docType, deps);
  return stop(context, error);
}

export async function runDesignGenerate(args: NodeExecutionArgs<DesignGenerateNodeData, ContactFlowContext>, deps: DesignGenerateDeps = defaultDeps): Promise<string | void> {
  const { supabase, data, context, node, sessionId } = args;
  try {
    const cfg = designGenerateDefaults(data);
    const problem = designGenerateProblem(data);
    if (problem) return stop(context, problem);
    const templateId = (data.templateId as string).trim();

    const template = await readTemplate(supabase, context.workspaceId, templateId);
    if (template === "error") return stop(context, "No se pudo leer la plantilla.");
    const docType = docTypeOf(template);

    // Volver después de un render que falló: la MISMA generación, nunca otra.
    const pendingId = pendingMap(context)[node.id];
    if (pendingId) {
      const design = await readDesign(supabase, context.workspaceId, pendingId);
      if (design === "error") return stop(context, "No se pudo leer el diseño generado.");
      if (!design) {
        setPending(context, node.id, null);
        return stop(context, "El diseño generado ya no existe.");
      }
      if (design.status === "ready") {
        setPending(context, node.id, null);
        await writeOutputs(supabase, context, design, docType, deps);
        return undefined;
      }
      if (design.status === "failed" || design.status === "void") {
        setPending(context, node.id, null);
        await writeOutputs(supabase, context, design, docType, deps);
        return stop(context, design.error || "No se pudo armar el PDF.");
      }
      return renderNow(args, design, docType, deps);
    }

    if (!template) return stop(context, "La plantilla ya no existe.");
    if (template.archived_at) return stop(context, "La plantilla está archivada.");

    const { data: workspace } = await supabase.from("workspaces").select("timezone").eq("id", context.workspaceId).maybeSingle();
    const timeZone = (workspace as { timezone?: string | null } | null)?.timezone || "UTC";
    const dateFormat = (["long", "short", "en"].includes(template.date_format) ? template.date_format : "long") as DateFormat;
    const overrides = resolveNodeOverrides(data.mappings as Record<string, unknown> | undefined, {
      variables: (context.variables ?? {}) as Record<string, unknown>,
      today: formatDesignDate(deps.now(), dateFormat, timeZone),
      interpolate: (text, vars) => interpolateVariables(text, vars as never),
    });

    const result = await deps.createGeneration(supabase, {
      workspaceId: context.workspaceId,
      templateId,
      contactId: context.contactId,
      overrides,
      policy: cfg.missingPolicy,
      publish: cfg.publish,
      source: "automation",
      sourceRef: { kind: "automation", flow_id: context.flowId, session_id: sessionId, node_id: node.id },
      actorUserId: null,
      enqueueRender: !cfg.waitForPdf,
    });

    if (!result.ok) {
      if (result.reason === "existing") {
        // Ya tiene una válida de esta plantilla: el flujo sigue con esa (no se emite otra ni se anula la anterior).
        await writeOutputs(supabase, context, { id: result.existing.designId, code: result.existing.code, status: "ready", error: null }, docType, deps);
        context.noteStep?.({ status: "ok", reason: `Ya tenía uno válido (código ${result.existing.code}): se usa ese.` });
        return undefined;
      }
      return stop(context, result.error);
    }

    const design: DesignState = { id: result.designId, code: result.code, status: result.status, error: null };
    if (result.status === "failed") {
      const missing = result.missing.map((m) => m.label).join(", ");
      await writeOutputs(supabase, context, design, docType, deps);
      return stop(context, missing ? `Falta: ${missing}` : "No se pudo generar el diseño.");
    }
    if (!cfg.waitForPdf) {
      await writeOutputs(supabase, context, design, docType, deps);
      return undefined;
    }
    return renderNow(args, design, docType, deps);
  } catch (error) {
    console.error("[flow-engine] «Generar desde plantilla» falló:", error instanceof Error ? error.message : String(error));
    return stop(context, "No se pudo generar el diseño.");
  }
}

export const designGenerateNode: NodeDefinition<DesignGenerateNodeData> = {
  // «Para: el contacto del disparador» (F57): sin contacto, el motor saltea el paso y lo anota.
  needsContact: true,
  type: DESIGN_GENERATE_TYPE,
  label: DESIGN_GENERATE_LABEL,
  aliases: [{ nodeType: "action", actionType: DESIGN_GENERATE_TYPE }],
  // Deja `design.*` (y la generación pendiente) para los pasos siguientes: tienen que sobrevivir a una pausa.
  persistsVariables: true,
  outputs: () => designGenerateOutputs(),
  execute: (args) => runDesignGenerate(args),
};
