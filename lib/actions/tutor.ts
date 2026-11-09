"use server";
// @plantilla-quitar(servicios)

import { revalidatePath } from "next/cache";
import { getPermissionAction, getAnyPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { scheduleJob } from "@/lib/scheduler";
import { detectMimeType } from "@/lib/knowledge/extract";
import { validateFileSize, validateTitle, titleFromFilename, storagePathFor } from "@/lib/knowledge/validate";
import { INDEX_DOCUMENT_JOB, KNOWLEDGE_BUCKET } from "@/lib/knowledge/index-document";
import { isEmbeddingProviderConnected } from "@/lib/knowledge/embeddings";
import { svcRpc, type SvcResult } from "@/lib/services/db";

/**
 * El tutor del programa (bloque IA, F83-F86, F110). Prender, apagar y duplicar piden `tutor.manage` (prender también
 * `portal.sections`); los materiales, `tutor.knowledge`. Las funciones de la base vuelven a pedir la clave.
 */

const NOT_ALLOWED = { ok: false as const, error: { code: "SV004", message: "No tenés permiso para hacer esto", detail: null } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refresh = (productId: string) => revalidatePath(`/dashboard/portal/${productId}`);
/** Lo que el tutor lee: PDF, Word y texto (el resto de lo que acepta Conocimiento no va acá). */
const TUTOR_MIMES = new Set(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain", "text/markdown"]);

export async function setTutorEnabled(productId: string, enabled: boolean): Promise<SvcResult<string | null>> {
  const ctx = await getAnyPermissionAction(["tutor.manage", "portal.sections"]);
  if (!ctx || !UUID.test(productId)) return NOT_ALLOWED;
  const res = await svcRpc<string | null>(ctx.supabase, "program_tutor_set_enabled", { p_product_id: productId, p_enabled: enabled });
  if (res.ok) refresh(productId);
  return res;
}

export async function duplicateTutor(agentId: string, destProductId: string, replace: boolean): Promise<SvcResult<string>> {
  const ctx = await getPermissionAction("tutor.manage");
  if (!ctx || !UUID.test(agentId) || !UUID.test(destProductId)) return NOT_ALLOWED;
  const res = await svcRpc<string>(ctx.supabase, "program_duplicate_tutor", { p_agent_id: agentId, p_dest_product_id: destProductId, p_replace: replace });
  if (res.ok) refresh(destProductId);
  return res;
}

export async function setTutorMaterial(productId: string, knowledgeId: string, used: boolean): Promise<SvcResult<null>> {
  const ctx = await getPermissionAction("tutor.knowledge");
  if (!ctx || !UUID.test(productId) || !UUID.test(knowledgeId)) return NOT_ALLOWED;
  const res = await svcRpc<null>(ctx.supabase, "tutor_set_excluded", { p_product_id: productId, p_knowledge_id: knowledgeId, p_excluded: !used });
  if (res.ok) refresh(productId);
  return res;
}

export async function addTutorDocumentFromKnowledge(productId: string, knowledgeId: string): Promise<SvcResult<null>> {
  const ctx = await getPermissionAction("tutor.knowledge");
  if (!ctx || !UUID.test(productId) || !UUID.test(knowledgeId)) return NOT_ALLOWED;
  const res = await svcRpc<null>(ctx.supabase, "tutor_add_document", { p_product_id: productId, p_knowledge_id: knowledgeId });
  if (res.ok) refresh(productId);
  return res;
}

/** Documentos de Conocimiento que se pueden sumar al tutor: del negocio, nunca internos ni de una clase. */
export async function searchKnowledgeForTutor(productId: string, query: string): Promise<SvcResult<Array<{ id: string; title: string }>>> {
  const ctx = await getPermissionAction("tutor.knowledge");
  if (!ctx || !UUID.test(productId)) return NOT_ALLOWED;
  const q = query.trim().replace(/[%_,()]/g, " ").trim().slice(0, 60);
  let req = ctx.supabase.from("knowledge_base").select("id, title, tags").eq("workspace_id", ctx.workspace.id).is("deleted_at", null).eq("internal_only", false).is("program_item_id" as never, null as never).order("created_at", { ascending: false }).limit(15);
  if (q.length >= 2) req = req.ilike("title", `%${q}%`);
  const { data } = await req;
  const tag = `programa:${productId}`;
  return { ok: true, data: ((data ?? []) as Array<{ id: string; title: string; tags: string[] }>).filter((d) => !(d.tags ?? []).includes(tag)).map(({ id, title }) => ({ id, title })) };
}

/** «+ Documento»: PDF, Word o texto, solo para este tutor (va a Conocimiento con la etiqueta del programa). */
export async function uploadTutorDocument(productId: string, formData: FormData): Promise<SvcResult<{ pending: boolean }>> {
  const ctx = await getPermissionAction("tutor.knowledge");
  if (!ctx || !UUID.test(productId)) return NOT_ALLOWED;
  const fail = (message: string) => ({ ok: false as const, error: { code: "IA002", message, detail: null } });
  const { data: product } = await ctx.supabase.from("products").select("id").eq("id", productId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!product) return NOT_ALLOWED;
  const file = formData.get("file");
  if (!(file instanceof File)) return fail("Falta el archivo");
  const size = validateFileSize(file.size);
  if (!size.ok) return fail(size.error);
  const buffer = new Uint8Array(await file.arrayBuffer());
  const realSize = validateFileSize(buffer.byteLength);
  if (!realSize.ok) return fail(realSize.error);
  const detected = detectMimeType(buffer, file.name);
  if (!detected.ok) return fail(detected.error);
  if (!TUTOR_MIMES.has(detected.mime)) return fail("El tutor lee PDF, Word o texto");
  const rawTitle = String(formData.get("title") ?? "").trim() || titleFromFilename(file.name);
  const title = validateTitle(rawTitle);
  if (!title.ok) return fail(title.error);
  const service = await createServiceClient();
  const connected = await isEmbeddingProviderConnected(ctx.workspace.id, service);
  const { data: created, error } = await service
    .from("knowledge_base")
    .insert({ workspace_id: ctx.workspace.id, title: rawTitle, tags: [`programa:${productId}`], internal_only: false, source_mime: detected.mime, source_size_bytes: buffer.byteLength, source_filename: file.name, status: connected ? "processing" : "pending", created_by: ctx.user.id })
    .select("id")
    .single();
  if (error || !created) return fail("No se pudo guardar el documento. Probá de nuevo.");
  const path = storagePathFor(ctx.workspace.id, created.id, detected.mime);
  const { error: upErr } = await service.storage.from(KNOWLEDGE_BUCKET).upload(path, buffer, { contentType: detected.mime, upsert: true });
  if (upErr) {
    await service.from("knowledge_base").delete().eq("id", created.id);
    return fail("No se pudo guardar el archivo. Probá de nuevo.");
  }
  await service.from("knowledge_base").update({ source_file_path: path }).eq("id", created.id);
  if (connected) {
    try {
      await scheduleJob(service, INDEX_DOCUMENT_JOB, { documentId: created.id, workspaceId: ctx.workspace.id }, new Date());
    } catch {
      await service.from("knowledge_base").update({ status: "error", error_detail: "No se pudo encolar el procesamiento. Probá reprocesarlo." }).eq("id", created.id);
    }
  }
  refresh(productId);
  return { ok: true, data: { pending: !connected } };
}

/** El límite propio de un estudiante en el asistente (F85): null vuelve al de su variante o del programa. */
export async function setOwnAssistantLimit(serviceId: string, limitUsd: number | null): Promise<SvcResult<number>> {
  const ctx = await getPermissionAction("tutor.manage");
  if (!ctx || !UUID.test(serviceId)) return NOT_ALLOWED;
  if (limitUsd !== null && (!Number.isFinite(limitUsd) || limitUsd < 0 || limitUsd > 10000)) return { ok: false, error: { code: "IA002", message: "El límite va de 0 a 10.000 dólares", detail: null } };
  const res = await svcRpc<number>(ctx.supabase, "assistant_set_own_limit", { p_service_id: serviceId, p_limit_usd: limitUsd });
  if (res.ok) revalidatePath(`/dashboard/clientes/s/${serviceId}`);
  return res;
}
