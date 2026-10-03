"use server";

import { getPermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { loadAiScatter } from "@/lib/agent/ai-dashboard/data";
import type { ScatterRunRow } from "@/lib/agent/ai-dashboard/scatter-points";
import type { BlockResult } from "@/lib/dashboards/chat/types";

/**
 * La cuarta llamada de A6: la pestaña Puntos la pide recien al abrirse, nunca
 * antes. Vuelve a chequear `ai_costs.view` server-side: el gate del lado del
 * cliente no alcanza, costo y tokens nunca pasan por el cliente del usuario.
 */
export async function loadAiScatterAction(range: { from: string | null; to: string | null }): Promise<BlockResult<ScatterRunRow[]>> {
  const { workspace, can } = await getPermissionContext();
  if (!can("ai_costs.view")) return { ok: false, error: "No tenés permiso para ver los costos de IA." };

  const service = await createServiceClient();
  const rows = await loadAiScatter(service, { workspaceId: workspace.id, range });
  return { ok: true, data: rows, loadedAt: new Date().toISOString() };
}
