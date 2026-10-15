/**
 * Lo que comparten las Server Actions y los loaders de Finanzas (SOLO servidor): la zona del workspace, "hoy"
 * en esa zona, la configuración y la verificación de que lo que manda el cliente es del workspace.
 *
 * Escribir con la SESIÓN de quien pide (no con el servicio): la RLS (`expenses.manage`) y los triggers de la
 * base son una segunda barrera después de `getPermissionAction`.
 */
import type { PermissionContext } from "@/lib/auth/guards";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { localToday } from "./dates";
import { parseFinanceSettings, type FinanceSettings } from "./settings";

export interface FinanceContext {
  tz: string;
  todayLocal: string;
  settings: FinanceSettings;
}

export function financeContextOf(ctx: Pick<PermissionContext, "workspace">, now: Date = new Date()): FinanceContext {
  const w = ctx.workspace as unknown as { timezone?: string | null; finance_settings?: unknown };
  const tz = w.timezone || "UTC";
  return { tz, todayLocal: localToday(now, tz), settings: parseFinanceSettings(w.finance_settings) };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ¿El proveedor es de este workspace? (la RLS ya lo limita; esto da un mensaje claro). */
export async function vendorBelongs(ctx: Pick<PermissionContext, "supabase" | "workspace">, vendorId: string | null | undefined): Promise<boolean> {
  if (!vendorId) return true;
  if (!UUID_RE.test(vendorId)) return false;
  const { data } = await ctx.supabase.from("vendors").select("id").eq("id", vendorId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  return !!data;
}

/** ¿La persona es miembro de este workspace? */
export async function memberBelongs(ctx: Pick<PermissionContext, "workspace">, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return true;
  if (!UUID_RE.test(userId)) return false;
  return (await getWorkspaceMembers(ctx.workspace.id)).some((m) => m.userId === userId);
}
