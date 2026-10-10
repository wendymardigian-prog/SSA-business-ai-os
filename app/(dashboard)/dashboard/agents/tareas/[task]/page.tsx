import { notFound } from "next/navigation";
import { requireWorkspaceAdmin, getPermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { getAiTask } from "@/lib/ai-tasks/catalog";
import { loadTaskRunSummary } from "@/lib/ai-tasks/task-run-summary";
import { loadTaskInstructions, loadTaskPromptVersions, defaultInstructionsFor, taskIsVersioned } from "@/lib/ai-tasks/store";
import { technicalPreviewFor } from "@/lib/ai-tasks/technical-preview";
import { taskModelOf } from "@/lib/ai-tasks/model";
import { listConnectedAiProviders } from "@/lib/ai/provider";
import { PROVIDERS } from "@/lib/integrations/providers";
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

  const [{ workspace, supabase }, service] = await Promise.all([requireWorkspaceAdmin(), createServiceClient()]);
  // Una pestaña que no existe (o Instrucciones en una tarea sin instrucciones)
  // cae en Configuración, igual que la vista: asi se cargan sus datos.
  const requested = typeof query.tab === "string" ? query.tab : "config";
  const tab = requested === "runs" || (requested === "instrucciones" && task.hasInstructions) ? requested : "config";

  const settings = task.configurable ? resolveBackgroundSettings((workspace as { ai_background_settings?: unknown }).ai_background_settings) : null;

  // Solo lo que usa la pestaña abierta, y todo en paralelo: antes era una
  // cadena de seis esperas una detras de otra en cada clic de pestaña.
  const loadInstructions = async (): Promise<TaskScreenData["instructions"]> => {
    const [active, members] = await Promise.all([
      loadTaskInstructions(service, workspace.id, task.id),
      getWorkspaceMembers(workspace.id),
    ]);
    const memberNames = new Map(members.map((m) => [m.userId, m.name]));
    const versions = await loadTaskPromptVersions(supabase, workspace.id, task.id, memberNames);
    return {
      activeVersion: active.version,
      activeText: active.text,
      defaultText: defaultInstructionsFor(task.id),
      versions,
      technical: technicalPreviewFor(task.id),
    };
  };

  // El selector de modelo (solo las tareas que lo tienen): lo guardado, los
  // proveedores de texto conectados y que modelos tienen precio cargado.
  const loadModel = async (): Promise<TaskScreenData["model"]> => {
    const [providers, pricing] = await Promise.all([
      listConnectedAiProviders(workspace.id, service),
      supabase.from("model_pricing").select("provider, model").eq("workspace_id", workspace.id),
    ]);
    return {
      current: taskModelOf((workspace as { ai_task_models?: unknown }).ai_task_models, task.id),
      picker: {
        providers,
        providerLabels: Object.fromEntries(PROVIDERS.map((p) => [p.id, p.label])),
        pricedModels: ((pricing.data ?? []) as Array<{ provider: string; model: string }>).map((p) => `${p.provider}/${p.model}`),
      },
    };
  };

  const loadRunsTab = async (viewerTimezone: string): Promise<TaskScreenData["runs"]> => {
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
    return { rows, total, pageSize: RUNS_PAGE_SIZE, filters, showCost: includeCost, isAdmin: true, options };
  };

  const isClassification = task.id === "message_classification";
  const viewerTimezone = await resolveViewerTimezone(workspace.timezone);
  const [lastRun, backgroundScreen, instructions, model, runs, categories] = await Promise.all([
    loadTaskRunSummary(service, workspace.id, task),
    isClassification && tab === "config" ? loadBackgroundScreen(workspace.id, workspace.timezone) : Promise.resolve(null),
    taskIsVersioned(task.id) && tab === "instrucciones" ? loadInstructions() : Promise.resolve(undefined),
    task.hasModelPicker && tab === "config" ? loadModel() : Promise.resolve(undefined),
    tab === "runs" ? loadRunsTab(viewerTimezone) : Promise.resolve(undefined),
    isClassification && tab === "config" ? loadReviewCategories(workspace.id) : Promise.resolve(undefined),
  ]);

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
    model,
    runs,
  };

  return <TaskDetailView data={data} tab={tab} timeZone={viewerTimezone} />;
}
