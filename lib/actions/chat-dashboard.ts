"use server";

import { getWorkspace } from "@/lib/workspace";
import { parseDashboardFilters } from "@/lib/dashboards/url-state";
import { chatQueryArgs, loadReplies } from "@/lib/dashboards/chat/loaders";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import type { RepliesPanel } from "@/lib/dashboards/chat/patterns";
import type { BlockResult } from "@/lib/dashboards/chat/types";

/**
 * "Qué le responden" a una categoría, a pedido.
 *
 * No viaja con la pantalla porque son tantas consultas como categorías y casi
 * ninguna se mira: se pide cuando alguien toca una. Se lee con el cliente del
 * usuario, así la RLS acota a un Member a su scope.
 *
 * Los filtros llegan como los tiene la URL y se vuelven a validar acá: lo que
 * manda el navegador no se confía.
 */
export async function fetchRepliesAction(
  categoryId: string,
  query: Record<string, string>,
): Promise<BlockResult<RepliesPanel>> {
  if (!/^[0-9a-f-]{36}$/i.test(categoryId)) return { ok: false, error: "Categoría inválida" };

  const { workspace, supabase } = await getWorkspace();
  const filters = parseDashboardFilters(new URLSearchParams(query));
  const timezone = await resolveViewerTimezone((workspace as { timezone?: string }).timezone);
  const args = chatQueryArgs({ workspaceId: workspace.id, filters, timezone });

  return loadReplies(supabase, args, categoryId);
}
