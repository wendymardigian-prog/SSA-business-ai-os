import { notFound } from "next/navigation";
import { requireWorkspaceAdmin, getPermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { getAiTask } from "@/lib/ai-tasks/catalog";
import { loadTaskRunSummary } from "@/lib/ai-tasks/task-run-summary";
import { loadTaskInstructions, loadTaskPromptVersions, defaultInstructionsFor, taskIsVersioned } from "@/lib/ai-tasks/store";
import { technicalPreviewFor } from "@/lib/ai-tasks/technical-preview";
import { resolveBackgroundSettings } from "@/lib/background/settings";
import { TASK_LABELS } from "@/lib/background/screen";
import { loadBackgroundScreen, loadReviewCategories } from "@/lib/background/screen-data";
import { loadRuns, RUNS_PAGE_SIZE } from "@/lib/agent/runs-query";
import { loadRunsScreenInputs } from "@/lib/agent/runs-screen-data";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import type { TaskScreenData } from "@/lib/ai-tasks/screen";
import { TaskDetailView } from "@/components/agents/tasks/task-detail-view";

/**
 * El detalle de una tarea de IA (Bloque Agentes IA): configuración,
 * instrucciones y corridas, sin tab repartida en Ajustes. Solo Owner/Admin,
 * igual que antes el tab de Ajustes → Tareas.
 */
export default async function TaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ task: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { task: taskParam } = await params;
  const query = await searchParams;
  const task = getAiTask(taskParam);
  if (!task) notFound();

  const { workspace, supabase } = await requireWorkspaceAdmin();
  const service = await createServiceClient();
  const viewerTimezone = await resolveViewerTimezone(workspace.timezone);
  const tab = typeof query.tab === "string" ? query.tab : "config";

  const settings = task.configurable ? resolveBackgroundSettings((workspace as { ai_background_settings?: unknown }).ai_background_settings) : null;

  const [lastRun, backgroundScreen] = await Promise.all([
    loadTaskRunSummary(service, workspace.id, task),
    task.id === "message_classification" ? loadBackgroundScreen(workspace.id, workspace.timezone) : Promise.resolve(null),
  ]);

  let instructions: TaskScreenData["instructions"];
  if (taskIsVersioned(task.id)) {
    const [active, members] = await Promise.all([
      loadTaskInstructions(service, workspace.id, task.id),
      getWorkspaceMembers(workspace.id),
    ]);
    const memberNames = new Map(members.map((m) => [m.userId, m.name]));
    const versions = await loadTaskPromptVersions(supabase, workspace.id, task.id, memberNames);
    instructions = {
      activeVersion: active.version,
      activeText: active.text,
      defaultText: defaultInstructionsFor(task.id),
      versions,
      technical: technicalPreviewFor(task.id),
    };
  }

  let runs: TaskScreenData["runs"];
  if (tab === "runs") {
    const permissions = await getPermissionContext();
    const includeCost = permissions.can("ai_costs.view");
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (typeof v === "string") sp.set(k, v);
    const { filters, dateRange, client, agents, channels, options } = await loadRunsScreenInputs({
      workspaceId: workspace.id,
      timeZone: viewerTimezone,
      service,
      userClient: supabase,
      includeCost,
      searchParams: sp,
      rawParams: query,
      currentOrigen: task.id,
    });
    const { rows, total } = await loadRuns(client, {
      workspaceId: workspace.id,
      filters,
      includeCost,
      agentNames: new Map(agents.map((a) => [a.id, a.name])),
      channelLabels: new Map(channels.map((c) => [c.id, c.label])),
      dateRange,
    });
    runs = { rows, total, pageSize: RUNS_PAGE_SIZE, filters, showCost: includeCost, isAdmin: true, options };
  }

  const categories = task.id === "message_classification" ? await loadReviewCategories(workspace.id) : undefined;

  const data: TaskScreenData = {
    task,
    lastRun,
    settings,
    canTurnOff: task.canTurnOff,
    canBatch: task.canTurnOff,
    batchWarning: task.backgroundTask ? (TASK_LABELS[task.backgroundTask].batchWarning ?? null) : null,
    quality: backgroundScreen ?? undefined,
    categories,
    instructions,
    runs,
  };

  return <TaskDetailView data={data} tab={tab} timeZone={viewerTimezone} />;
}
