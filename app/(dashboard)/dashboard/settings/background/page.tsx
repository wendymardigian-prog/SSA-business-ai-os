import { requireWorkspaceAdmin } from "@/lib/auth/guards";
import { resolveBackgroundSettings } from "@/lib/background/settings";
import { BackgroundTasksView } from "@/components/settings/background-tasks-view";

export const dynamic = "force-dynamic";

/** Settings → Tareas en segundo plano (F23). Solo Owner/Admin. */
export default async function BackgroundTasksPage() {
  const { workspace } = await requireWorkspaceAdmin();
  const settings = resolveBackgroundSettings((workspace as { ai_background_settings?: unknown }).ai_background_settings);
  return <BackgroundTasksView settings={settings} />;
}
