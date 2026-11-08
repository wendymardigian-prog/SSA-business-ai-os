/**
 * Generar desde una plantilla, la parte de las acciones (DS6, F50, F54): vista previa, emitir para uno, reintentar,
 * reintentar todas las fallidas y volver a generar. Solo servidor.
 *
 * La lógica vive acá y recibe el cliente de servicio, el negocio y la persona POR PARÁMETRO: las Server Actions
 * (`lib/actions/designer/generate.ts`) validan `designer.generate` y la forma de lo que manda el navegador, y llaman con
 * el negocio de la SESIÓN (nunca el que mande el navegador). Así se prueba sin red con una base en memoria.
 *
 * Todo lo que crea una pieza pasa por `createGeneration` (el mismo núcleo que usan el job de «Generar para varios» y el
 * nodo de automatizaciones): un solo lugar decide qué se guarda.
 *
 * Reglas que esto cuida:
 *   - Una generación es una COPIA CONGELADA: nada de acá toca su documento. Reintentar vuelve a armar el archivo del mismo
 *     documento; volver a generar crea otra pieza con el documento de la plantilla de HOY.
 *   - Reintentar una falla de datos sigue pidiendo el dato hasta que se complete; no cambia nada mientras falte.
 *   - Reintentar NUNCA vuelve a correr una automatización ni manda el email de ese flujo.
 *   - Una plantilla con verificación deja una sola pieza válida por persona: reintentar no puede dejar dos.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit";
import { membersWithPermission } from "./permission-members";
import { createNotificationOnce } from "@/lib/notifications/create";
import type { Database, Json } from "@/lib/types/database";
import type { ActionResult, GenerateOneInput, GenerationPreview } from "./contracts";
import { createGeneration, findValidFor, loadGenerationContext, type GenerationDeps } from "./generate-core";
import { emailProblems } from "./generation-email";
import { registeredSubjectSources, registeredVariableGroups, resolveRegisteredValues, type SubjectRef } from "./extensions";
import { enqueueDesignRender } from "./jobs/render";
import { loadDesignLinks } from "./public-links";
import { publishDesignCore } from "./publishing";
import { allowedOverrideKeys, parseCustomVarsList, sanitizeOverrides } from "./variables/custom";
import { isMissingDataError, missingMessage } from "./variables/resolve";
import { alreadyValidNotice } from "./verification";

type Db = SupabaseClient<Database>;

export interface OpsEnv {
  service: Db;
  /** El negocio de la SESIÓN. */
  workspaceId: string;
  userId: string;
}

export interface OpsDeps extends GenerationDeps {
  loadLinks?: typeof loadDesignLinks;
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

function generationDeps(deps: OpsDeps): Required<GenerationDeps> {
  return {
    now: deps.now ?? (() => new Date()),
    enqueue: deps.enqueue ?? enqueueDesignRender,
    publish: deps.publish ?? publishDesignCore,
    notify: deps.notify ?? createNotificationOnce,
    audit: deps.audit ?? logAudit,
    registered: deps.registered ?? resolveRegisteredValues,
    members: deps.members ?? membersWithPermission,
  };
}

const stringValues = (raw: Json | null | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) for (const [k, v] of Object.entries(raw)) if (typeof v === "string") out[k] = v;
  return out;
};

/** Un registro de un módulo registrado: la forma y que el módulo exista (el navegador nunca inventa un origen). */
export function validSubjectRef(raw: unknown): SubjectRef | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() !== "" && v.length <= max ? v : null);
  const moduleKey = text(r.module, 40);
  const type = text(r.type, 40);
  const id = text(r.id, 120);
  const label = text(r.label, 200);
  if (!moduleKey || !type || !id || !label) return null;
  if (!registeredSubjectSources().some((s) => s.group === moduleKey)) return null;
  return { module: moduleKey, type, id, label };
}

/** Los valores puestos a mano, limpios con las claves de ESTA plantilla (y las de los módulos registrados). */
async function cleanOverrides(db: Db, workspaceId: string, templateId: string, raw: unknown): Promise<{ ok: true; overrides: Record<string, string> } | { ok: false; error: string }> {
  const { data, error } = await db.from("design_templates").select("custom_vars").eq("id", templateId).eq("workspace_id", workspaceId).maybeSingle();
  if (error) {
    console.error("[designer] no pude leer la plantilla:", error.message);
    return { ok: false, error: "No se pudo leer la plantilla." };
  }
  if (!data) return { ok: false, error: "La plantilla ya no existe." };
  const registered = registeredVariableGroups().flatMap((g) => g.vars.map((v) => v.key));
  return sanitizeOverrides(raw, allowedOverrideKeys(parseCustomVarsList((data as { custom_vars: unknown }).custom_vars), registered));
}

// ─── Vista previa (F50) ─────────────────────────────────────────────────────

/**
 * Los valores reales de una pieza antes de emitirla: con lo puesto a mano y el contacto elegido. Sirve para dibujar la
 * vista previa (con `renderPageHTML`), pedir lo que falta y avisar si ya tiene una pieza válida. No escribe nada.
 */
export async function previewGenerationCore(env: OpsEnv, input: { templateId: string; contactId: string | null; overrides: unknown }, depsIn: OpsDeps = {}): Promise<ActionResult<GenerationPreview>> {
  const deps = generationDeps(depsIn);
  try {
    const clean = await cleanOverrides(env.service, env.workspaceId, input.templateId, input.overrides);
    if (!clean.ok) return fail(clean.error);
    const context = await loadGenerationContext(env.service, { workspaceId: env.workspaceId, templateId: input.templateId, contactId: input.contactId, overrides: clean.overrides, policy: "fail" }, deps);
    if (!context.ok) return fail(context.error);
    let existingValid: GenerationPreview["existingValid"] = null;
    if (context.template.verify && input.contactId) {
      const valid = await findValidFor(env.service, env.workspaceId, input.templateId, { contactId: input.contactId, subjectRef: null });
      if (valid !== "error" && valid.length > 0) {
        const pick = valid.find((v) => v.status === "ready") ?? valid[0];
        existingValid = { designId: pick.id, code: pick.code };
      }
    }
    return { ok: true, data: { values: context.resolved.values, missing: context.resolved.missing, existingValid } };
  } catch (error) {
    console.error("[designer] previewGeneration falló:", error instanceof Error ? error.message : "error");
    return fail("No se pudo preparar la vista previa. Probá de nuevo.");
  }
}

// ─── Emitir para uno (F50) ──────────────────────────────────────────────────

export interface GeneratedPiece {
  designId: string;
  code: string;
  link: string;
  /** `failed` si la pieza se creó pero no se pudo encolar el archivo (se reintenta desde Generaciones). */
  status: "queued" | "failed";
}

/**
 * Emitir una pieza para una persona (o un registro de un módulo). Pide lo que falta ANTES de crear nada; si ya tiene una
 * válida y la plantilla verifica, avisa (con `replaceExisting` anula la anterior). Publica con link si se pidió y manda el
 * email al quedar lista si se pidió.
 */
export async function generateOneCore(env: OpsEnv, input: GenerateOneInput, depsIn: OpsDeps = {}): Promise<ActionResult<GeneratedPiece>> {
  const deps = generationDeps(depsIn);
  const loadLinks = depsIn.loadLinks ?? loadDesignLinks;
  try {
    const subjectRef = input.subjectRef ? validSubjectRef(input.subjectRef) : null;
    if (input.subjectRef && !subjectRef) return fail("Ese origen no está disponible.");
    if (!input.contactId && !subjectRef) return fail("Elegí para quién es la pieza.");
    if (input.email) {
      const problem = emailProblems(input.email);
      if (problem) return fail(problem);
      if (!input.contactId) return fail("Para mandar un email elegí un contacto.");
    }
    const clean = await cleanOverrides(env.service, env.workspaceId, input.templateId, input.overrides);
    if (!clean.ok) return fail(clean.error);

    // Lo que falta se pide antes de confirmar: una pieza fallida por un dato que la persona tenía a mano no tiene sentido.
    const context = await loadGenerationContext(env.service, { workspaceId: env.workspaceId, templateId: input.templateId, contactId: input.contactId, subjectRef, overrides: clean.overrides, policy: "fail" }, deps);
    if (!context.ok) return fail(context.error);
    if (!context.resolved.ok) return fail(missingMessage(context.resolved.missing));

    const result = await createGeneration(
      env.service,
      {
        workspaceId: env.workspaceId,
        templateId: input.templateId,
        contactId: input.contactId,
        subjectRef,
        overrides: clean.overrides,
        policy: "fail",
        publish: input.publish === true,
        source: "manual",
        sourceRef: { kind: "user", user_id: env.userId },
        replaceExisting: input.replaceExisting === true,
        actorUserId: env.userId,
        email: input.email ?? null,
      },
      deps,
    );
    if (!result.ok) {
      if (result.reason === "existing") return fail(alreadyValidNotice(context.template, result.existing.code));
      return fail(result.error);
    }
    const links = await loadLinks(env.service, env.workspaceId, result.code);
    return { ok: true, data: { designId: result.designId, code: result.code, link: links.link, status: result.status } };
  } catch (error) {
    console.error("[designer] generateOne falló:", error instanceof Error ? error.message : "error");
    return fail("No se pudo generar la pieza. Probá de nuevo.");
  }
}

// ─── Reintentar (F54) ───────────────────────────────────────────────────────

interface FailedRow {
  id: string;
  template_id: string | null;
  subject_contact_id: string | null;
  subject_ref: Json;
  status: string;
  error: string | null;
  code: string;
  values: Json;
}

const FAILED_COLUMNS = "id, template_id, subject_contact_id, subject_ref, status, error, code, values";

/** Deja la pieza en cola y encola el render. Si no se puede encolar, vuelve a `failed` con un motivo claro. */
async function requeue(env: OpsEnv, row: FailedRow, extra: Record<string, unknown>, deps: Required<GenerationDeps>): Promise<ActionResult> {
  // Condicional: si otra persona la reintentó (o ya no está fallida), no se pisa ni se encola dos veces.
  const { data, error } = await env.service
    .from("designs")
    .update({ status: "queued", error: null, attempts: 0, next_attempt_at: null, ...extra })
    .eq("id", row.id)
    .eq("workspace_id", env.workspaceId)
    .eq("status", "failed")
    .select("id");
  if (error) {
    console.error("[designer] no pude reintentar:", error.message);
    return fail("No se pudo reintentar. Probá de nuevo.");
  }
  if (!data || data.length === 0) return fail("La pieza cambió mientras tanto. Recargá la lista y probá de nuevo.");
  try {
    await deps.enqueue(env.service, { designId: row.id, purpose: "generation" });
  } catch (enqueueError) {
    console.error("[designer] no pude encolar el reintento:", enqueueError instanceof Error ? enqueueError.message : "error");
    await env.service.from("designs").update({ status: "failed", error: "No se pudo preparar el archivo. Tocá «Reintentar» para armarlo de nuevo." }).eq("id", row.id);
    return fail("No se pudo preparar el archivo. Probá de nuevo en un rato.");
  }
  return { ok: true, data: undefined };
}

/**
 * Reintentar una pieza fallida. Una falla de RENDER vuelve a armar el archivo con los mismos valores. Una falla de DATOS
 * (la política «No generar y avisarme») vuelve a revisar los valores con lo que se complete: si todavía falta algo,
 * devuelve `needs` y no cambia nada; si no, la deja en cola.
 */
export async function retryGenerationCore(env: OpsEnv, input: { designId: string; values?: unknown }, depsIn: OpsDeps = {}): Promise<ActionResult<{ needs?: { key: string; label: string }[] }>> {
  const deps = generationDeps(depsIn);
  try {
    const { data, error } = await env.service.from("designs").select(FAILED_COLUMNS).eq("id", input.designId).eq("workspace_id", env.workspaceId).maybeSingle();
    if (error) {
      console.error("[designer] no pude leer la pieza para reintentar:", error.message);
      return fail("No se pudo leer la pieza. Probá de nuevo.");
    }
    const row = data as unknown as FailedRow | null;
    if (!row || !row.template_id) return fail("No encontramos esa pieza.");
    if (row.status !== "failed") return fail("Esa pieza no está fallida.");
    const subjectRef = (row.subject_ref && typeof row.subject_ref === "object" && !Array.isArray(row.subject_ref) ? (row.subject_ref as unknown as SubjectRef) : null) ?? null;

    let extra: Record<string, unknown> = {};
    let verify: boolean;
    if (isMissingDataError(row.error)) {
      const given = await cleanOverrides(env.service, env.workspaceId, row.template_id, input.values);
      if (!given.ok) return fail(given.error);
      // Lo que ya se había usado se conserva (la fecha de emisión no cambia); lo que faltaba se vuelve a mirar y se completa.
      const stored = Object.fromEntries(Object.entries(stringValues(row.values)).filter(([key, value]) => key !== "design.code" && value.trim() !== ""));
      const context = await loadGenerationContext(
        env.service,
        { workspaceId: env.workspaceId, templateId: row.template_id, contactId: row.subject_contact_id, subjectRef, overrides: { ...stored, ...given.overrides }, policy: "fail", code: row.code },
        deps,
      );
      if (!context.ok) return fail(context.error);
      if (!context.resolved.ok) return { ok: true, data: { needs: context.resolved.missing } };
      extra = { values: { ...context.resolved.values, "design.code": row.code } };
      verify = context.template.verify;
    } else {
      const { data: tpl } = await env.service.from("design_templates").select("verify, doc_type, doc_type_label").eq("id", row.template_id).eq("workspace_id", env.workspaceId).maybeSingle();
      if (!tpl) return fail("La plantilla ya no existe.");
      verify = (tpl as { verify: boolean }).verify;
    }

    // Una sola válida por persona: reintentar no puede dejar dos.
    if (verify) {
      const valid = await findValidFor(env.service, env.workspaceId, row.template_id, { contactId: row.subject_contact_id, subjectRef });
      if (valid === "error") return fail("No se pudo revisar si ya tiene una pieza válida. Probá de nuevo.");
      if (valid.length > 0) return fail(`Ya tiene una pieza válida (código ${valid[0].code}). Si querés reemplazarla, usá «Volver a generar» en esa.`);
    }

    const done = await requeue(env, row, extra, deps);
    if (!done.ok) return done;
    return { ok: true, data: {} };
  } catch (error) {
    console.error("[designer] retryGeneration falló:", error instanceof Error ? error.message : "error");
    return fail("No se pudo reintentar. Probá de nuevo.");
  }
}

/** El tope de piezas que se reintentan de una vez. */
export const MAX_RETRY_ALL = 200;

/**
 * Reintentar todas las fallidas de una plantilla: las de render se reencolan; las de datos piden el dato una por una (se
 * cuentan, no se tocan).
 */
export async function retryFailedGenerationsCore(env: OpsEnv, input: { templateId: string }, depsIn: OpsDeps = {}): Promise<ActionResult<{ retried: number; needData: number }>> {
  try {
    const { data, error } = await env.service
      .from("designs")
      .select("id, error")
      .eq("workspace_id", env.workspaceId)
      .eq("template_id", input.templateId)
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(MAX_RETRY_ALL);
    if (error) {
      console.error("[designer] no pude listar las fallidas:", error.message);
      return fail("No se pudieron leer las piezas fallidas. Probá de nuevo.");
    }
    const rows = (data ?? []) as { id: string; error: string | null }[];
    let retried = 0;
    let needData = 0;
    const renderFailures = rows.filter((r) => !isMissingDataError(r.error));
    needData = rows.length - renderFailures.length;
    for (let i = 0; i < renderFailures.length; i += 10) {
      const results = await Promise.all(renderFailures.slice(i, i + 10).map((r) => retryGenerationCore(env, { designId: r.id }, depsIn)));
      retried += results.filter((r) => r.ok && !r.data.needs).length;
    }
    return { ok: true, data: { retried, needData } };
  } catch (error) {
    console.error("[designer] retryFailedGenerations falló:", error instanceof Error ? error.message : "error");
    return fail("No se pudo reintentar. Probá de nuevo.");
  }
}

// ─── Volver a generar (F47) ─────────────────────────────────────────────────

/**
 * Volver a generar: crea una pieza nueva para la misma persona con los datos de HOY (el nombre del contacto, la fecha de
 * emisión) y los valores propios que ya se habían puesto; si la plantilla verifica, anula la anterior con «Reemplazado por
 * <código nuevo>».
 */
export async function regenerateCore(env: OpsEnv, input: { designId: string }, depsIn: OpsDeps = {}): Promise<ActionResult<{ designId: string; code: string }>> {
  const deps = generationDeps(depsIn);
  try {
    const { data, error } = await env.service
      .from("designs")
      .select("id, template_id, subject_contact_id, subject_ref, status, values, published")
      .eq("id", input.designId)
      .eq("workspace_id", env.workspaceId)
      .maybeSingle();
    if (error) {
      console.error("[designer] no pude leer la pieza para volver a generar:", error.message);
      return fail("No se pudo leer la pieza. Probá de nuevo.");
    }
    const row = data as unknown as { id: string; template_id: string | null; subject_contact_id: string | null; subject_ref: Json; status: string; values: Json; published: boolean } | null;
    if (!row || !row.template_id) return fail("No encontramos esa pieza.");
    if (row.status !== "ready" && row.status !== "void") return fail("Solo se puede volver a generar una pieza lista o anulada.");
    const ref = row.subject_ref && typeof row.subject_ref === "object" && !Array.isArray(row.subject_ref) ? (row.subject_ref as unknown as SubjectRef) : null;
    if (!row.subject_contact_id && !ref) return fail("Esta pieza no tiene a quién volver a generarla (el contacto ya no existe).");

    const { data: tpl } = await env.service.from("design_templates").select("custom_vars").eq("id", row.template_id).eq("workspace_id", env.workspaceId).maybeSingle();
    if (!tpl) return fail("La plantilla ya no existe.");
    const stored = stringValues(row.values);
    // Lo propio que se había puesto se conserva; lo del contacto, el negocio y la fecha se toma de nuevo, con los datos de hoy.
    const overrides: Record<string, string> = {};
    for (const v of parseCustomVarsList((tpl as { custom_vars: unknown }).custom_vars)) if (stored[v.key]?.trim()) overrides[v.key] = stored[v.key];

    const result = await createGeneration(
      env.service,
      {
        workspaceId: env.workspaceId,
        templateId: row.template_id,
        contactId: row.subject_contact_id,
        subjectRef: ref,
        overrides,
        policy: "fail",
        publish: row.published,
        source: "manual",
        sourceRef: { kind: "user", user_id: env.userId },
        replaceExisting: true,
        actorUserId: env.userId,
      },
      deps,
    );
    if (!result.ok) return fail(result.reason === "existing" ? "Ya tiene una pieza válida." : result.error);
    if (result.status === "failed") {
      return fail(result.missing.length > 0 ? `${missingMessage(result.missing)}. Completalo desde Generaciones → Reintentar.` : "No se pudo preparar el archivo. Reintentá desde Generaciones.");
    }
    try {
      await deps.audit({
        supabase: env.service as unknown as SupabaseClient,
        workspaceId: env.workspaceId,
        entityType: "design",
        entityId: result.designId,
        action: "design.regenerated",
        changes: null,
        metadata: { event: "design.regenerated", replaces: row.id, template_id: row.template_id },
        performedBy: env.userId,
      });
    } catch (auditError) {
      console.error("[designer] no pude anotar el «volver a generar»:", auditError instanceof Error ? auditError.message : "error");
    }
    return { ok: true, data: { designId: result.designId, code: result.code } };
  } catch (error) {
    console.error("[designer] regenerate falló:", error instanceof Error ? error.message : "error");
    return fail("No se pudo volver a generar. Probá de nuevo.");
  }
}
