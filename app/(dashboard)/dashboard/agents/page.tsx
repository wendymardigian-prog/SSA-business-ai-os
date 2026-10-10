import { Suspense } from "react";
import { Bot } from "lucide-react";
import { getWorkspace } from "@/lib/workspace";
import { getPermissionContext } from "@/lib/auth/guards";
import { isAdminRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/supabase/server";
import { loadWorkspaceAgents } from "@/lib/agent/config";
import { CreateAgentButton } from "@/components/agents/create-agent-button";
import { AgentCard } from "@/components/agents/agent-card";
import { TaskCard } from "@/components/agents/tasks/task-card";
import { PageHeader } from "@/components/page-header";
import { AiPeriodControl } from "@/components/agents/ai-dashboard/period-control";
import { AiDashboardSkeleton } from "@/components/agents/ai-dashboard/dashboard-panel";
import { AiDashboardSection } from "@/components/agents/ai-dashboard/section";
import { parsePeriodFilter } from "@/lib/agent/ai-dashboard/url-state";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { ALL_AI_TASKS } from "@/lib/ai-tasks/catalog";
import { loadTaskRunSummaries } from "@/lib/ai-tasks/task-run-summary";
import { resolveBackgroundSettings } from "@/lib/background/settings";

/**
 * Agentes IA (F24, Bloque Agentes IA): dos grupos, los agentes arriba y las
 * tareas de IA del sistema abajo (antes repartidas en Ajustes → Tareas).
 *
 * Los agentes los ve todo el mundo: un Member entra a las pestanas Runs y
 * Acciones de sus conversaciones. Se lee con service role (la fila completa
 * incluye topes de gasto que el rol authenticated no puede leer), pero de
 * esa fila solo se muestra nombre, estado, modelo y canales. Crear un agente
 * sigue siendo de Owner/Admin.
 *
 * Las tareas son de Owner/Admin, igual que antes el tab de Ajustes → Tareas:
 * cada una gasta IA del negocio y decide cómo corre.
 *
 * Arriba de todo, el mini dashboard de IA (Bloque A), solo para quien tiene
 * `ai_costs.view` (D7): para el resto, esta pagina queda como siempre
 * estuvo. El dashboard es un Server Component aparte, en su propio
 * `<Suspense>`, para no demorar la lista de agentes (que no depende de el).
 */
export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ workspace, role }, service] = await Promise.all([getWorkspace(), createServiceClient()]);
  const isAdmin = isAdminRole(role);
  const [agents, permissions, timeZone] = await Promise.all([
    loadWorkspaceAgents(service, workspace.id),
    getPermissionContext(),
    resolveViewerTimezone(workspace.timezone),
  ]);
  const canViewCosts = permissions.can("ai_costs.view");

  let filter = null;
  if (canViewCosts) {
    const sp = await searchParams;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string") params.set(k, v);
    filter = parsePeriodFilter(params);
  }

  const settings = isAdmin ? resolveBackgroundSettings((workspace as { ai_background_settings?: unknown }).ai_background_settings) : null;

  return (
    <div className="flex h-full flex-col">
      <PageHeader route="/dashboard/agents" filters={canViewCosts ? <AiPeriodControl timezone={timeZone} /> : undefined} />

      <div className="flex-1 overflow-auto px-8 py-6">
        {canViewCosts && filter && (
          <Suspense fallback={<AiDashboardSkeleton />}>
            <AiDashboardSection workspaceId={workspace.id} timeZone={timeZone} filter={filter} firstAgentId={agents[0]?.id ?? null} canEditLimits={isAdmin} />
          </Suspense>
        )}

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agentes</h2>
          {agents.length === 0 ? (
            <div className="mx-auto max-w-lg rounded-xl border border-dashed border-border p-10 text-center">
              <Bot className="mx-auto h-10 w-10 text-muted-foreground/50" aria-hidden />
              <h2 className="mt-4 text-base font-semibold">Todavía no hay un agente</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Se crea apagado y sin canales, con un prompt inicial y límites seguros. Lo encendés cuando lo hayas revisado.
              </p>
              {isAdmin && (
                <div className="mt-6 flex justify-center">
                  <CreateAgentButton />
                </div>
              )}
            </div>
          ) : (
            <ul className="space-y-3">
              {agents.map((agent) => (
                <li key={agent.id}>
                  <AgentCard agent={agent} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {isAdmin && settings && (
          <section className="mt-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tareas</h2>
            {/* En su propio Suspense: la ultima corrida y el gasto del mes de
                cada tarea no frenan la lista de agentes. */}
            <Suspense fallback={<TaskListSkeleton />}>
              <TaskList service={service} workspaceId={workspace.id} settings={settings} />
            </Suspense>
          </section>
        )}
      </div>
    </div>
  );
}

async function TaskList({
  service,
  workspaceId,
  settings,
}: {
  service: Awaited<ReturnType<typeof createServiceClient>>;
  workspaceId: string;
  settings: ReturnType<typeof resolveBackgroundSettings>;
}) {
  const taskRuns = await loadTaskRunSummaries(service, workspaceId, ALL_AI_TASKS);
  return (
    <ul className="space-y-2">
      {ALL_AI_TASKS.map((task, i) => (
        <li key={task.id}>
          <TaskCard task={task} mode={task.backgroundTask ? settings[task.backgroundTask].mode : null} lastRun={taskRuns[i] ?? null} />
        </li>
      ))}
    </ul>
  );
}

function TaskListSkeleton() {
  return (
    <ul className="space-y-2" aria-busy="true">
      {ALL_AI_TASKS.map((task) => (
        <li key={task.id} className="h-16 animate-pulse rounded-xl border border-border bg-muted/50" />
      ))}
    </ul>
  );
}
