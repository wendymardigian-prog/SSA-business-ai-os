"use server";
// @plantilla-quitar(servicios)

import { getMemberAction } from "@/lib/auth/guards";
import { isModuleEnabled } from "@/lib/services/module";
import { svcSchema } from "@/lib/services/db";

/**
 * El número de Grabaciones en el menú (Servicios A4, F145): las reuniones QUE VEO (la RLS decide) con propuestas
 * pendientes de los últimos 30 días donde soy el responsable del servicio o quien grabó. Pide como mucho 10 filas
 * (el menú muestra hasta «9+»). Nunca lanza: ante cualquier problema, 0.
 */
export async function countMyPendingProposals(): Promise<number> {
  try {
    const ctx = await getMemberAction();
    if (!ctx || !ctx.can("calls.view") || !isModuleEnabled(ctx.workspace as { services_enabled?: boolean | null })) return 0;
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data: mine } = await svcSchema(ctx.supabase).from("services").select("id").eq("workspace_id", ctx.workspace.id).eq("owner_user_id", ctx.user.id).limit(500);
    const serviceIds = ((mine ?? []) as Array<{ id: string }>).map((s) => s.id);
    const who = serviceIds.length ? `recorded_by_user_id.eq.${ctx.user.id},service_id.in.(${serviceIds.join(",")})` : `recorded_by_user_id.eq.${ctx.user.id}`;
    const { data } = await ctx.supabase
      .from("calls")
      .select("id")
      .eq("workspace_id", ctx.workspace.id)
      .gte("recorded_at", since)
      .is("archived_at", null)
      .contains("proposals", [{ status: "pending" }] as never)
      .or(who)
      .limit(10);
    return (data ?? []).length;
  } catch {
    return 0;
  }
}
