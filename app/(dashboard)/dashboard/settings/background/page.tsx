import { requireWorkspaceAdmin } from "@/lib/auth/guards";
import { resolveBackgroundSettings } from "@/lib/background/settings";
import { loadBackgroundScreen, loadReviewCategories } from "@/lib/background/screen-data";
import { BackgroundTasksView } from "@/components/settings/background-tasks-view";

export const dynamic = "force-dynamic";

/**
 * Settings → Tareas en segundo plano (F23, F25). Solo Owner/Admin.
 *
 * Los costos se leen acá, en el servidor y detrás del guard: `authenticated` no
 * puede leer `cost_usd` (GRANT por columna de la 00060) y `ai_cost_report` es
 * solo de service role.
 */
export default async function BackgroundTasksPage() {
  const { workspace } = await requireWorkspaceAdmin();
  // La zona del NEGOCIO, no la de quien mira: la precision semanal de
  // review-queue.ts es un reporte agregado, igual para todo el equipo.
  const timezone = (workspace as { timezone?: string }).timezone ?? "UTC";
  const settings = resolveBackgroundSettings((workspace as { ai_background_settings?: unknown }).ai_background_settings);

  const [data, categories] = await Promise.all([
    loadBackgroundScreen(workspace.id, timezone),
    loadReviewCategories(workspace.id),
  ]);

  return <BackgroundTasksView settings={settings} data={data} categories={categories} />;
}
