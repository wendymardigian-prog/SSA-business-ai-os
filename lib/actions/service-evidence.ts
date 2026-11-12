// @plantilla-quitar(servicios)
"use server";

/**
 * La evidencia de un paso del camino (Servicios A4, F147): una captura o un PDF, un link o una nota. Quién puede la
 * decide la base (`svc_add_evidence` / `svc_remove_evidence`, con la sesión): quien atiende el servicio o quien puede
 * editar la tarea del paso. Un archivo se valida por sus BYTES, se sube con el cliente de servicio a la carpeta del
 * paso y recién después se anota; si la base lo rechaza, el archivo se borra.
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getAnyPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { svcRpc, svcSchema, type SvcResult } from "@/lib/services/db";
import {
  EVIDENCE_BUCKET,
  EVIDENCE_MAX_BYTES,
  EVIDENCE_SIGNED_SECONDS,
  evidencePath,
  isEvidencePathOf,
  readEvidence,
  readEvidenceRule,
  validateEvidence,
  type EvidenceEntry,
  type EvidenceInput,
} from "@/lib/services/evidence";

const NOT_ALLOWED: SvcResult<never> = { ok: false, error: { code: "SV004", message: "No tenés permiso para hacer esto.", detail: null } };
const fail = (message: string): SvcResult<never> => ({ ok: false, error: { code: null, message, detail: null } });

type ItemRow = { id: string; workspace_id: string; service_id: string; status: string; ref: Record<string, unknown> | null; evidence: unknown };

async function loadItem(workspaceId: string, itemId: string): Promise<ItemRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) return null;
  const svc = await createServiceClient();
  const { data } = await svcSchema(svc).from("service_items").select("id, workspace_id, service_id, status, ref, evidence").eq("id", itemId).eq("workspace_id", workspaceId).maybeSingle();
  return (data as ItemRow | null) ?? null;
}

function refresh() {
  revalidatePath("/dashboard/clientes");
  revalidatePath("/dashboard/tasks");
}

export async function addItemEvidence(itemId: string, form: FormData): Promise<SvcResult<EvidenceEntry>> {
  const ctx = await getAnyPermissionAction(["services.items", "tasks.edit"]);
  if (!ctx) return NOT_ALLOWED;
  const item = await loadItem(ctx.workspace.id, itemId);
  if (!item) return fail("No encontré el paso.");
  if (item.status !== "pending") return fail("El paso ya está completo.");

  const kind = String(form.get("kind") ?? "");
  let input: EvidenceInput;
  if (kind === "file") {
    const file = form.get("file");
    if (!(file instanceof File)) return fail("Elegí un archivo.");
    if (file.size > EVIDENCE_MAX_BYTES) return fail("El archivo puede pesar hasta 10 MB.");
    input = { kind: "file", bytes: new Uint8Array(await file.arrayBuffer()), size: file.size };
  } else if (kind === "link") input = { kind: "link", url: String(form.get("url") ?? "") };
  else if (kind === "note") input = { kind: "note", text: String(form.get("text") ?? "") };
  else return fail("Elegí qué querés adjuntar.");

  const rule = readEvidenceRule(item.ref?.evidence);
  const valid = validateEvidence(input, rule, readEvidence(item.evidence));
  if (!valid.ok) return fail(valid.error);

  let entry: Record<string, unknown>;
  let uploaded: string | null = null;
  if (valid.value.kind === "file" && input.kind === "file") {
    const path = evidencePath(item.workspace_id, item.service_id, item.id, randomUUID(), valid.value.ext);
    const svc = await createServiceClient();
    const { error } = await svc.storage.from(EVIDENCE_BUCKET).upload(path, input.bytes, { contentType: valid.value.mime, upsert: false });
    if (error) {
      console.error("[servicios] no pude subir una evidencia:", error.message);
      return fail("No se pudo subir el archivo. Probá de nuevo.");
    }
    uploaded = path;
    entry = { kind: "file", path };
  } else if (valid.value.kind === "link") entry = { kind: "link", url: valid.value.url };
  else entry = { kind: "note", text: (valid.value as { text: string }).text };

  const res = await svcRpc<EvidenceEntry>(ctx.supabase, "svc_add_evidence", { p_item_id: item.id, p_entry: entry });
  if (!res.ok && uploaded) {
    const svc = await createServiceClient();
    await svc.storage.from(EVIDENCE_BUCKET).remove([uploaded]);
  }
  if (res.ok) refresh();
  return res;
}

export async function removeItemEvidence(itemId: string, evidenceId: string): Promise<SvcResult<true>> {
  const ctx = await getAnyPermissionAction(["services.items", "tasks.edit"]);
  if (!ctx) return NOT_ALLOWED;
  const item = await loadItem(ctx.workspace.id, itemId);
  if (!item) return fail("No encontré el paso.");
  const res = await svcRpc<EvidenceEntry>(ctx.supabase, "svc_remove_evidence", { p_item_id: item.id, p_evidence_id: evidenceId });
  if (!res.ok) return res;
  const path = res.data?.path;
  if (path && isEvidencePathOf(path, item.workspace_id, item.service_id, item.id)) {
    const svc = await createServiceClient();
    const { error } = await svc.storage.from(EVIDENCE_BUCKET).remove([path]);
    if (error) console.error("[servicios] no pude borrar el archivo de una evidencia:", error.message);
  }
  refresh();
  return { ok: true, data: true };
}

/** Un link temporal (10 minutos) a un archivo de evidencia. Solo para quien ve el paso (con su sesión). */
export async function evidenceFileUrl(itemId: string, evidenceId: string): Promise<SvcResult<string>> {
  const ctx = await getAnyPermissionAction(["services.view", "tasks.view"]);
  if (!ctx) return NOT_ALLOWED;
  // Con la sesión: si la RLS no deja ver el paso, no hay link.
  const { data } = await svcSchema(ctx.supabase).from("service_items").select("id, workspace_id, service_id, evidence").eq("id", itemId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  let row = data as Pick<ItemRow, "id" | "workspace_id" | "service_id" | "evidence"> | null;
  if (!row) {
    // Quien ve la tarea del paso (sin ver el servicio) también puede abrir su evidencia: lo decide la RLS de `tasks`.
    const svc = await createServiceClient();
    const { data: it } = await svcSchema(svc).from("service_items").select("id, workspace_id, service_id, evidence, task_id").eq("id", itemId).eq("workspace_id", ctx.workspace.id).maybeSingle();
    const taskId = (it as { task_id?: string | null } | null)?.task_id;
    if (!it || !taskId) return NOT_ALLOWED;
    const { data: task } = await ctx.supabase.from("tasks").select("id").eq("id", taskId).maybeSingle();
    if (!task) return NOT_ALLOWED;
    row = it as Pick<ItemRow, "id" | "workspace_id" | "service_id" | "evidence">;
  }
  if (!row) return fail("No encontré el paso.");
  const entry = readEvidence(row.evidence).find((e) => e.id === evidenceId);
  if (!entry?.path || !isEvidencePathOf(entry.path, row.workspace_id, row.service_id, row.id)) return fail("Esa evidencia ya no está.");
  const svc = await createServiceClient();
  const { data: signed, error } = await svc.storage.from(EVIDENCE_BUCKET).createSignedUrl(entry.path, EVIDENCE_SIGNED_SECONDS);
  if (error || !signed?.signedUrl) return fail("No se pudo abrir el archivo.");
  return { ok: true, data: signed.signedUrl };
}
