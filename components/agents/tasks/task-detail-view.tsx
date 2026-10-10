"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { AiPeriodControl } from "@/components/agents/ai-dashboard/period-control";
import { RunsScreen } from "@/components/agents/runs-screen";
import { TaskIcon } from "./task-icon";
import { TaskModeEditor } from "./task-mode-editor";
import { TaskInstructionsPanel } from "./task-instructions-panel";
import { QualityPanel, ButtonTextsPanel } from "./classification-quality";
import { MODE_LABELS, formatSpend, lastRunLabel } from "@/lib/background/screen";
import type { TaskScreenData } from "@/lib/ai-tasks/screen";

const TABS = [
  { key: "config", label: "Configuración" },
  { key: "instrucciones", label: "Instrucciones" },
  { key: "runs", label: "Corridas" },
] as const;

/**
 * El detalle de una tarea de IA (Bloque Agentes IA): configuración,
 * instrucciones (si las tiene) y sus corridas, sin salir de acá. Mismo
 * patrón de pestañas por `?tab=` que el detalle de un agente.
 */
export function TaskDetailView({ data, tab, timeZone }: { data: TaskScreenData; tab: string; timeZone: string }) {
  const { task } = data;
  const tabs = TABS.filter((t) => t.key !== "instrucciones" || task.hasInstructions);
  const activeTab = tabs.some((t) => t.key === tab) ? tab : "config";

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/agents/tareas/[task]"
        title={task.name}
        backHref={
          <Link
            href="/dashboard/agents"
            aria-label="Volver a Agentes IA"
            className="-ml-1 flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        }
        filters={activeTab === "runs" ? <AiPeriodControl timezone={timeZone} /> : undefined}
      />

      <div className="border-b border-border px-4 pt-4 md:px-8">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <TaskIcon icon={task.icon} className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <h2 className="sr-only">{task.name}</h2>
            <p className="text-sm text-muted-foreground">{task.description}</p>
            {data.settings && (
              <p className="mt-1 text-xs text-muted-foreground">
                {MODE_LABELS[data.settings[task.backgroundTask!].mode]}
                {" · "}
                Última corrida:{" "}
                {data.settings[task.backgroundTask!].mode === "off"
                  ? "Apagada"
                  : data.lastRun
                    ? lastRunLabel(data.lastRun.at)
                    : "Sin corridas propias todavía"}
                {" · "}
                Gasto del mes: {formatSpend(data.lastRun?.monthSpendUsd ?? null)}
              </p>
            )}
          </div>
        </div>

        <nav className="mt-5 flex gap-1 overflow-x-auto" aria-label="Secciones de la tarea">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={`/dashboard/agents/tareas/${task.id}?tab=${t.key}`}
              aria-current={activeTab === t.key ? "page" : undefined}
              className={cn(
                "whitespace-nowrap border-b-2 px-3 pb-3 text-sm font-medium transition-colors",
                activeTab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="flex-1 overflow-auto px-4 py-6 md:px-8">
        <div className={cn("mx-auto space-y-6", activeTab === "runs" ? "max-w-5xl" : "max-w-3xl")}>
          {activeTab === "config" && (
            <>
              {data.settings && task.backgroundTask ? (
                <TaskModeEditor
                  task={task.backgroundTask}
                  settings={data.settings}
                  canTurnOff={data.canTurnOff}
                  canBatch={data.canBatch}
                  batchWarning={data.batchWarning}
                  lastRun={data.lastRun}
                />
              ) : (
                <section className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
                  Esta tarea no tiene modo propio: corre apenas hace falta. El proveedor que la resuelve se elige en{" "}
                  <Link href="/dashboard/settings/integrations" className="underline underline-offset-2">
                    Ajustes → Integraciones
                  </Link>
                  .
                </section>
              )}
              {data.quality && <QualityPanel data={data.quality} categories={data.categories ?? []} />}
              {data.quality && <ButtonTextsPanel buttonTexts={data.quality.buttonTexts} />}
            </>
          )}

          {activeTab === "instrucciones" && data.instructions && (
            <TaskInstructionsPanel
              taskId={task.id}
              taskName={task.name}
              defaultText={data.instructions.defaultText}
              activeVersion={data.instructions.activeVersion}
              activeText={data.instructions.activeText}
              versions={data.instructions.versions}
              technical={data.instructions.technical}
            />
          )}

          {activeTab === "runs" && data.runs && <RunsScreen {...data.runs} currentOrigen={task.id} />}
        </div>
      </div>
    </div>
  );
}
