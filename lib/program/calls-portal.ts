// @plantilla-quitar(servicios)
import type { PermissionContext } from "@/lib/auth/guards";
import { isModuleEnabled } from "@/lib/services/module";
import { svcSchema } from "@/lib/services/db";

/**
 * Grabaciones (F65): de las grabaciones de una página, cuáles ya están en el portal (como clase o como grabación de una
 * sesión) y si quien mira puede agregarlas. Con el módulo apagado, o sin ninguno de los dos permisos, `null`: la lista
 * de Grabaciones queda idéntica a la de siempre. Lee con la sesión (la RLS de cada tabla).
 */
export async function loadCallsPortalState(ctx: Pick<PermissionContext, "supabase" | "workspace" | "can">, callIds: string[]): Promise<{ inPortal: string[]; canAdd: boolean } | null> {
  if (!isModuleEnabled(ctx.workspace as { services_enabled?: boolean | null })) return null;
  const canAdd = ctx.can("recordings.to_portal");
  if (!canAdd && !ctx.can("portal.view")) return null;
  if (!callIds.length) return { inPortal: [], canAdd };
  const [{ data: items }, { data: dates }] = await Promise.all([
    svcSchema(ctx.supabase).from("program_items").select("source_call_id").eq("workspace_id", ctx.workspace.id).in("source_call_id", callIds).neq("status", "archived"),
    svcSchema(ctx.supabase).from("live_session_dates").select("recording_call_id").eq("workspace_id", ctx.workspace.id).in("recording_call_id", callIds),
  ]);
  const ids = new Set<string>([
    ...((items ?? []) as Array<{ source_call_id: string | null }>).map((i) => i.source_call_id).filter((x): x is string => !!x),
    ...((dates ?? []) as Array<{ recording_call_id: string | null }>).map((d) => d.recording_call_id).filter((x): x is string => !!x),
  ]);
  return { inPortal: [...ids], canAdd };
}
