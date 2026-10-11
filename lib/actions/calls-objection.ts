"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { OBJECTION_NOTE_MAX, OBJECTIONS_MAX } from "@/lib/calls/edit-rules";
import { notifyObjection } from "@/lib/calls/notify";
import { isAnalysisSection } from "@/lib/calls/scoring";
import type { Json } from "@/lib/types/database";

/**
 * El closer puede objetar un analisis (F28): "No estoy de acuerdo", con un
 * comentario. No cambia ningun puntaje; deja una marca que ven quienes editan
 * y les avisa. Solo el closer DE ESA llamada (quien la grabo) puede objetar;
 * marcarla resuelta es de quien edita.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ObjectionResult = { ok: true } | { ok: false; error: string };

interface StoredObjection {
  id: string;
  section: string;
  by: string;
  at: string;
  note: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

const asList = (value: unknown): StoredObjection[] => (Array.isArray(value) ? (value as StoredObjection[]) : []);

export async function objectToAnalysis(input: { callId: string; section: string; note: string }): Promise<ObjectionResult> {
  const ctx = await getPermissionAction("calls.view");
  if (!ctx) return { ok: false, error: "No tenés permiso para ver llamadas" };
  if (!UUID.test(input.callId)) return { ok: false, error: "Los datos no son válidos" };
  if (!isAnalysisSection(input.section)) return { ok: false, error: "Esa sección no se puede objetar" };
  const note = input.note?.trim() ?? "";
  if (note.length < 3) return { ok: false, error: "Contá por qué no estás de acuerdo" };
  if (note.length > OBJECTION_NOTE_MAX) return { ok: false, error: `El comentario puede tener hasta ${OBJECTION_NOTE_MAX} caracteres` };

  const { data: call } = await ctx.supabase
    .from("calls")
    .select("id, title, recorded_by_user_id, objections, analysis_status")
    .eq("id", input.callId)
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .maybeSingle();
  if (!call) return { ok: false, error: "No encontré esa llamada" };
  // Solo el closer de la llamada: no cualquiera que la pueda ver.
  if (call.recorded_by_user_id !== ctx.user.id) return { ok: false, error: "Solo quien grabó la llamada puede objetar su análisis" };
  if (call.analysis_status !== "analyzed") return { ok: false, error: "La llamada todavía no tiene un análisis" };

  const current = asList(call.objections);
  if (current.length >= OBJECTIONS_MAX) return { ok: false, error: "Esta llamada ya tiene demasiadas objeciones" };

  const objection: StoredObjection = { id: randomUUID(), section: input.section, by: ctx.user.id, at: new Date().toISOString(), note, resolved_at: null, resolved_by: null };
  const service = await createServiceClient();
  const { error } = await service.from("calls").update({ objections: [...current, objection] as unknown as Json }).eq("id", call.id);
  if (error) {
    console.error("[llamadas] no pude guardar la objeción:", error.message);
    return { ok: false, error: "No pude guardar tu comentario" };
  }

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "call",
    entityId: call.id,
    action: "call.objection",
    changes: { objection: { old: null, new: { section: input.section, note } } },
    metadata: { objectionId: objection.id },
    performedBy: ctx.user.id,
  });
  await notifyObjection(service, { workspaceId: ctx.workspace.id, callId: call.id, closerId: ctx.user.id, callTitle: call.title });
  revalidatePath(`/dashboard/llamadas/${call.id}`);
  return { ok: true };
}

export async function resolveObjection(input: { callId: string; objectionId: string }): Promise<ObjectionResult> {
  const ctx = await getPermissionAction("calls.edit");
  if (!ctx) return { ok: false, error: "No tenés permiso para editar llamadas" };
  if (!UUID.test(input.callId) || !UUID.test(input.objectionId)) return { ok: false, error: "Los datos no son válidos" };

  const { data: call } = await ctx.supabase
    .from("calls")
    .select("id, objections")
    .eq("id", input.callId)
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .maybeSingle();
  if (!call) return { ok: false, error: "No encontré esa llamada" };

  const list = asList(call.objections);
  const target = list.find((o) => o.id === input.objectionId);
  if (!target) return { ok: false, error: "No encontré esa objeción" };
  if (target.resolved_at) return { ok: true };

  const resolvedAt = new Date().toISOString();
  const next = list.map((o) => (o.id === target.id ? { ...o, resolved_at: resolvedAt, resolved_by: ctx.user.id } : o));
  const service = await createServiceClient();
  const { error } = await service.from("calls").update({ objections: next as unknown as Json }).eq("id", call.id);
  if (error) {
    console.error("[llamadas] no pude resolver la objeción:", error.message);
    return { ok: false, error: "No pude guardar el cambio" };
  }

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "call",
    entityId: call.id,
    action: "call.objection_resolved",
    changes: { objection: { old: { resolved_at: null }, new: { resolved_at: resolvedAt, resolved_by: ctx.user.id } } },
    metadata: { objectionId: target.id },
    performedBy: ctx.user.id,
  });
  revalidatePath(`/dashboard/llamadas/${call.id}`);
  return { ok: true };
}
