"use server";

import { revalidatePath } from "next/cache";
import { getMemberAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { eodPorts } from "@/lib/eod/server-ports";
import { submitEodCore, type SubmitResult } from "@/lib/eod/submit";

/**
 * "Enviar reporte" (E8). En el servidor, en este orden: sesión y miembro, audiencia,
 * publicado, fecha, validación total contra la versión vigente, modo de reporte, y se
 * guarda (con la unicidad de la base). La persona sale de la sesión.
 */
export async function submitEodReport(input: { formId: string; reportDate: string; rev: number }): Promise<SubmitResult> {
  const ctx = await getMemberAction();
  if (!ctx) return { ok: false, error: "Tu sesión venció: volvé a entrar", code: "not_available" };
  const service = await createServiceClient();
  const formId = String(input?.formId ?? "");
  const result = await submitEodCore(eodPorts(service), {
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    formId,
    reportDate: input?.reportDate,
    rev: input?.rev,
  });
  if (result.ok) {
    revalidatePath("/dashboard/eod");
    revalidatePath(`/dashboard/formularios/${formId}/reportes`);
  }
  return result;
}
