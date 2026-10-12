"use server";

import { getMemberAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { eodPorts } from "@/lib/eod/server-ports";
import { saveDraftCore, type SaveDraftResult } from "@/lib/eod/submit";

/**
 * Guarda el borrador de un reporte de fin de día (E7). La persona es la de la sesión
 * (nunca un dato del navegador); el workspace también. Completar un EOD no necesita
 * permiso: alcanza con estar en su audiencia, y eso lo decide `saveDraftCore`.
 * Escribe con el cliente de servicio (la tabla no tiene policies de escritura).
 */
export async function saveEodDraft(input: { formId: string; reportDate: string; rev: number; data: unknown }): Promise<SaveDraftResult> {
  const ctx = await getMemberAction();
  if (!ctx) return { ok: false, error: "Tu sesión venció: volvé a entrar", code: "not_available" };
  const service = await createServiceClient();
  return saveDraftCore(eodPorts(service), {
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    formId: String(input?.formId ?? ""),
    reportDate: input?.reportDate,
    rev: input?.rev,
    data: input?.data,
  });
}
