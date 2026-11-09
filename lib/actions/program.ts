"use server";
// @plantilla-quitar(servicios)

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { svcRpc, svcSchema, type SvcResult } from "@/lib/services/db";
import { normalizeVideoUrl } from "@/lib/program/video-url";
import { unlockRuleProblems, type UnlockRule } from "@/lib/program/unlock";
import { checkDocument, checkHtml, checkImage, checkResource, programPath } from "@/lib/program/lesson";
import { saveLessonTranscriptCore } from "@/lib/program/transcript-store";
import { quizDefinitionIssues, type QuizSettings } from "@/lib/program/quiz";
import { gradingIssues, type GradingDef } from "@/lib/program/grading";

/**
 * El contenido del programa (bloque PR). Escribir pide `program.manage`; prender, apagar y archivar,
 * `program.activate`. Las funciones de la base vuelven a pedirlo con la sesión. Los archivos se validan por sus bytes
 * y van al bucket privado `program-resources` (sube el servidor), en `<negocio>/<producto>/<item>/…`.
 */

const NOT_ALLOWED = { ok: false as const, error: { code: "SV004", message: "No tenés permiso para hacer esto", detail: null } };
const fail = (message: string) => ({ ok: false as const, error: { code: "PR002", message, detail: null } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refresh = (productId: string) => revalidatePath(`/dashboard/portal/${productId}`);

export async function createProgramItem(productId: string, input: { kind: "module" | "submodule" | "lesson"; parentId?: string | null; lessonType?: string | null; title: string }): Promise<SvcResult<string>> {
  const ctx = await getPermissionAction("program.manage");
  if (!ctx || !UUID.test(productId) || (input.parentId && !UUID.test(input.parentId))) return NOT_ALLOWED;
  if (!input.title.trim()) return fail("Escribí el título");
  const res = await svcRpc<string>(ctx.supabase, "program_create_item", {
    p_product_id: productId,
    p: { kind: input.kind, parent_id: input.parentId ?? null, lesson_type: input.kind === "lesson" ? input.lessonType ?? "video" : null, title: input.title.trim() },
  });
  if (res.ok) refresh(productId);
  return res;
}

/** Cambia los datos de un ítem. Un link de video se normaliza (y se rechaza uno que no se puede usar). */
export async function updateProgramItem(productId: string, itemId: string, patch: Record<string, unknown>): Promise<SvcResult<{ warning: string | null }>> {
  const ctx = await getPermissionAction("program.manage");
  if (!ctx || !UUID.test(itemId)) return NOT_ALLOWED;
  const p: Record<string, unknown> = {};
  for (const k of ["title", "description", "lesson_type", "duration_seconds", "html_content", "comments_enabled", "required", "form_id", "source_call_id"]) if (k in patch) p[k] = patch[k];
  let warning: string | null = null;
  if ("video_url" in patch) {
    const url = String(patch.video_url ?? "").trim();
    if (!url) Object.assign(p, { video_url: null, video_embed_url: null, thumbnail_url: null });
    else {
      const v = normalizeVideoUrl(url);
      if (!v.ok) return fail(v.error);
      warning = v.warning;
      Object.assign(p, { video_url: url, video_embed_url: v.embedUrl, thumbnail_url: v.thumbnailUrl });
    }
  }
  if ("unlock_rule" in patch) {
    const problems = unlockRuleProblems((patch.unlock_rule ?? {}) as UnlockRule);
    if (problems.length) return fail(problems.join(". "));
    p.unlock_rule = patch.unlock_rule;
  }
  if (typeof p.html_content === "string" && new TextEncoder().encode(p.html_content).length > 1024 * 1024) return fail("La página tiene hasta 1 MB");
  const res = await svcRpc<null>(ctx.supabase, "program_update_item", { p_item_id: itemId, p });
  if (!res.ok) return res;
  refresh(productId);
  return { ok: true, data: { warning } };
}

export async function setProgramItemStatus(productId: string, itemId: string, status: "inactive" | "active" | "archived", children = false): Promise<SvcResult<number>> {
  const ctx = await getPermissionAction("program.activate");
  if (!ctx || !UUID.test(itemId)) return NOT_ALLOWED;
  const res = await svcRpc<number>(ctx.supabase, "program_set_status", { p_item_id: itemId, p_status: status, p_children: children });
  if (res.ok) refresh(productId);
  return res;
}

export async function reorderProgramItems(productId: string, parentId: string | null, ids: string[]): Promise<SvcResult<null>> {
  const ctx = await getPermissionAction("program.manage");
  if (!ctx || !UUID.test(productId) || ids.some((i) => !UUID.test(i))) return NOT_ALLOWED;
  const res = await svcRpc<null>(ctx.supabase, "program_reorder", { p_product_id: productId, p_parent_id: parentId, p_ids: ids });
  if (res.ok) refresh(productId);
  return res;
}

export type ProgramUploadKind = "html" | "document" | "cover" | "thumbnail" | "resource";

/**
 * Sube un archivo a una clase o módulo. Se valida por sus bytes; la página HTML va a `html_content` (no a un
 * archivo). Un recurso se suma a la lista `resources` con su nombre.
 */
export async function uploadProgramFile(productId: string, itemId: string, kind: ProgramUploadKind, form: FormData): Promise<SvcResult<{ path: string | null }>> {
  const ctx = await getPermissionAction("program.manage");
  if (!ctx || !UUID.test(productId) || !UUID.test(itemId)) return NOT_ALLOWED;
  const file = form.get("file");
  if (!(file instanceof File)) return fail("Elegí un archivo");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = kind === "html" ? checkHtml(bytes) : kind === "document" ? checkDocument(bytes) : kind === "resource" ? checkResource(bytes, file.type) : checkImage(bytes);
  if (!check.ok) return fail(check.error);
  // El ítem tiene que ser de este negocio y de este producto (lo lee la sesión: si no lo ve, no existe).
  const { data: item } = await svcSchema(ctx.supabase).from("program_items").select("id, resources").eq("id", itemId).eq("product_id", productId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!item) return NOT_ALLOWED;
  if (kind === "html") {
    const res = await svcRpc<null>(ctx.supabase, "program_update_item", { p_item_id: itemId, p: { html_content: new TextDecoder().decode(bytes) } });
    if (res.ok) refresh(productId);
    return res.ok ? { ok: true, data: { path: null } } : res;
  }
  const path = programPath(ctx.workspace.id, productId, itemId, `${kind}-${Date.now()}-${file.name}`);
  const service = await createServiceClient();
  const { error } = await service.storage.from("program-resources").upload(path, bytes, { contentType: check.mime, upsert: false });
  if (error) {
    console.error("[programa] no pude subir el archivo:", error.message);
    return fail("No se pudo subir el archivo. Probá de nuevo en un rato.");
  }
  const patch =
    kind === "document"
      ? { document_path: path }
      : kind === "cover"
        ? { cover_path: path }
        : kind === "thumbnail"
          ? { thumbnail_path: path }
          : { resources: [...(((item as { resources?: unknown[] }).resources ?? []) as unknown[]), { id: crypto.randomUUID(), kind: "file", name: file.name.slice(0, 120), path, mime: check.mime }] };
  const res = await svcRpc<null>(ctx.supabase, "program_update_item", { p_item_id: itemId, p: patch });
  if (res.ok) refresh(productId);
  return res.ok ? { ok: true, data: { path } } : res;
}

/**
 * La transcripción de una clase (F49): se indexa en Conocimiento, visible para el tutor (no interna), con el segundo
 * de cada fragmento. Reemplaza la anterior de la misma clase.
 */
export async function saveLessonTranscript(productId: string, itemId: string, text: string, format: "vtt" | "srt" | "txt"): Promise<SvcResult<{ status: string; chunks: number }>> {
  const ctx = await getPermissionAction("program.manage");
  if (!ctx || !UUID.test(itemId)) return NOT_ALLOWED;
  const out = await saveLessonTranscriptCore(ctx, productId, itemId, text, format);
  if (!out.ok) return out.reason === "empty" ? fail("La transcripción está vacía") : NOT_ALLOWED;
  refresh(productId);
  return { ok: true, data: { status: out.status, chunks: out.chunks } };
}

/** «Abrir ahora» un módulo o clase para el estudiante de un servicio (services.access). */
export async function openModuleNow(serviceId: string, itemId: string): Promise<SvcResult<null>> {
  const ctx = await getPermissionAction("services.access");
  if (!ctx || !UUID.test(serviceId) || !UUID.test(itemId)) return NOT_ALLOWED;
  const res = await svcRpc<null>(ctx.supabase, "svc_open_module_now", { p_service_id: serviceId, p_program_item_id: itemId });
  if (res.ok) revalidatePath(`/dashboard/clientes/s/${serviceId}`);
  return res;
}

// ─── Evaluaciones, actividades y términos (bloque EV) ───────────────────────

export interface PortalFormField {
  key: string;
  type: "short_text" | "long_text" | "file" | "single_select" | "multi_select" | "consent";
  label: string;
  required: boolean;
  options?: string[];
  consentText?: string;
}

const PORTAL_FIELD_TYPES: Record<"quiz" | "activity" | "terms", readonly string[]> = {
  quiz: ["single_select", "multi_select"],
  activity: ["short_text", "long_text", "file", "single_select", "multi_select"],
  terms: ["consent"],
};

/**
 * Guarda y publica el formulario de una evaluación, una actividad o los términos (F52-F55, F113). Es de un programa
 * (`product_id`), no aparece en Formularios y se publica con `publish_form_version` (la corrección de la evaluación
 * queda en la versión y nunca viaja al portal). Una evaluación o actividad se ata a su clase; los términos, al
 * producto (`portal_settings.terms.form_id`).
 */
export async function savePortalForm(
  productId: string,
  target: { kind: "quiz" | "activity"; itemId: string } | { kind: "terms" },
  input: { name: string; intro?: string; fields: PortalFormField[]; quiz?: QuizSettings; grading?: GradingDef },
): Promise<SvcResult<{ formId: string }>> {
  const ctx = await getPermissionAction(target.kind === "terms" ? "portal.sections" : "program.manage");
  if (!ctx || !UUID.test(productId) || ("itemId" in target && !UUID.test(target.itemId))) return NOT_ALLOWED;
  const allowed = PORTAL_FIELD_TYPES[target.kind];
  const keys = new Set<string>();
  for (const f of input.fields) {
    if (!allowed.includes(f.type)) return fail(`«${f.label || f.key}»: ese tipo de pregunta no va acá`);
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(f.key) || keys.has(f.key)) return fail("Hay preguntas con la misma clave");
    keys.add(f.key);
    if ((f.type === "single_select" || f.type === "multi_select") && (f.options ?? []).filter((o) => o.trim()).length < 2) return fail(`«${f.label}»: agregá al menos dos opciones`);
  }
  if (input.fields.length === 0) return fail("Agregá al menos una pregunta");
  if (target.kind === "quiz") {
    const problems = quizDefinitionIssues(input.quiz ?? {}, input.fields);
    if (problems.length) return fail(problems.join(". "));
  }
  if (target.kind === "activity") {
    const problems = gradingIssues(input.grading ?? {});
    if (problems.length) return fail(problems.join(". "));
  }
  const service = await createServiceClient();
  const { data: product } = await service.from("products").select("id, portal_settings, portal_settings_rev").eq("id", productId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!product) return NOT_ALLOWED;
  let formId: string | null = null;
  if (target.kind === "terms") {
    formId = (((product as { portal_settings?: { terms?: { form_id?: string } } }).portal_settings ?? {}).terms?.form_id as string | undefined) ?? null;
  } else {
    const { data: item } = await svcSchema(ctx.supabase).from("program_items").select("id, form_id").eq("id", target.itemId).eq("product_id", productId).eq("workspace_id", ctx.workspace.id).maybeSingle();
    if (!item) return NOT_ALLOWED;
    formId = (item as { form_id: string | null }).form_id;
  }
  const definition: Record<string, unknown> = {
    intro: input.intro ?? "",
    fields: input.fields.map((f) => ({ id: f.key, key: f.key, type: f.type, label: f.label, required: f.required, ...(f.options ? { options: f.options } : {}), ...(f.consentText ? { consentText: f.consentText } : {}) })),
  };
  if (target.kind === "quiz") definition.quiz = input.quiz ?? {};
  if (target.kind === "activity") definition.grading = input.grading ?? { enabled: false };
  const name = input.name.trim().slice(0, 120) || (target.kind === "terms" ? "Términos del programa" : "Formulario del programa");
  const db = service as unknown as { from: (t: string) => any; rpc: (f: string, a: Record<string, unknown>) => Promise<{ error: { message: string } | null }> };
  if (formId) {
    const { error } = await db.from("forms").update({ name, draft_definition: definition }).eq("id", formId).eq("workspace_id", ctx.workspace.id);
    if (error) return fail("No se pudo guardar. Probá de nuevo en un rato.");
  } else {
    const slug = `prog-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const { data, error } = await db.from("forms").insert({ workspace_id: ctx.workspace.id, name, type: target.kind, slug, product_id: productId, draft_definition: definition, status: "published", created_by: ctx.user.id }).select("id").single();
    if (error || !data) {
      console.error("[programa] no pude crear el formulario:", error?.message);
      return fail("No se pudo crear. Probá de nuevo en un rato.");
    }
    formId = (data as { id: string }).id;
  }
  const { error: pubError } = await db.rpc("publish_form_version", { p_form_id: formId, p_actor: ctx.user.id });
  if (pubError) {
    console.error("[programa] no pude publicar el formulario:", pubError.message);
    return fail("Se guardó pero no se pudo publicar. Probá de nuevo.");
  }
  if (target.kind === "terms") {
    const ps = ((product as { portal_settings?: Record<string, unknown> }).portal_settings ?? {}) as { terms?: Record<string, unknown> };
    if (ps.terms?.form_id !== formId) {
      const res = await svcRpc(ctx.supabase, "portal_admin_save_program_settings", {
        p_product_id: productId,
        p_patch: { terms: { ...(ps.terms ?? { enabled: false, ask_again_on_change: true }), form_id: formId } },
        p_rev: (product as { portal_settings_rev?: number }).portal_settings_rev ?? 0,
      });
      if (!res.ok) return res;
    }
  } else {
    const res = await svcRpc<null>(ctx.supabase, "program_update_item", { p_item_id: target.itemId, p: { form_id: formId } });
    if (!res.ok) return res;
  }
  refresh(productId);
  return { ok: true, data: { formId } };
}

/** Revisar una entrega (F56): Revisada o A corregir, la calificación según la escala y los dos comentarios. */
export async function reviewSubmission(submissionId: string, input: { status: "reviewed" | "needs_changes"; value?: unknown; comment?: string; internalNote?: string }): Promise<SvcResult<{ passed: boolean | null }>> {
  const ctx = await getPermissionAction("submissions.review");
  if (!ctx || !UUID.test(submissionId)) return NOT_ALLOWED;
  const res = await svcRpc<{ passed: boolean | null }>(ctx.supabase, "submission_review", {
    p_submission_id: submissionId,
    p_status: input.status,
    p_grade_value: input.value === undefined ? null : input.value,
    p_comment: input.comment ?? null,
    p_internal_note: input.internalNote ?? null,
  });
  if (res.ok) revalidatePath("/dashboard/portal");
  return res;
}
