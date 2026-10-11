"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { LinkPending } from "@/components/ui/link-pending";
import { AiPeriodControl } from "@/components/agents/ai-dashboard/period-control";
import { RunsScreen } from "@/components/agents/runs-screen";
import { TaskIcon } from "./task-icon";
import { TaskModeEditor } from "./task-mode-editor";
import { TaskInstructionsPanel } from "./task-instructions-panel";
import { TaskModelPanel } from "./task-model-panel";
import { QualityPanel, ButtonTextsPanel } from "./classification-quality";
import { AgentCloseTable, HowItWorks } from "./how-it-works";
import { ClassificationConfig } from "./calls/classification-config";
import { AnalysisConfig } from "./calls/analysis-config";
import { PromptTestPanel } from "./calls/prompt-test-panel";
import { MODE_LABELS, formatSpend, lastRunLabel } from "@/lib/background/screen";
import { controlLabel } from "@/lib/ai-tasks/catalog";
import { TASK_TABS, resolveTaskTab } from "@/lib/ai-tasks/tabs";
import type { TaskScreenData } from "@/lib/ai-tasks/screen";

/**
 * El detalle de una tarea de IA (Bloque Agentes IA). Las mismas cinco
 * pestañas para todas (`TASK_TABS`): lo que cambia entre una tarea y otra sale
 * del catálogo (`task.control`, `task.instructions`, `task.modelSource`), no
 * de un `if` por tarea. La única tarea con paneles propios es la
 * clasificación de mensajes (calidad y textos de botón), en Configuración.
 */
export function TaskDetailView({ data, tab, timeZone }: { data: TaskScreenData; tab: string; timeZone: string }) {
  const { task } = data;
  const activeTab = resolveTaskTab(tab);
  const mode = data.settings && task.backgroundTask ? data.settings[task.backgroundTask].mode : null;

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
            <p className="mt-1 text-xs text-muted-foreground">
              {mode ? MODE_LABELS[mode] : controlLabel(task)}
              {" · "}
              Última corrida: {mode === "off" ? "Apagada" : data.lastRun?.at ? lastRunLabel(data.lastRun.at) : "Sin corridas todavía"}
              {" · "}
              Gasto del mes: {formatSpend(data.lastRun?.monthSpendUsd ?? null)}
            </p>
          </div>
        </div>

        <nav className="mt-5 flex gap-1 overflow-x-auto" aria-label="Secciones de la tarea">
          {TASK_TABS.map((t) => (
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
              <LinkPending className="ml-1.5 align-middle" />
            </Link>
          ))}
        </nav>
      </div>

      <div className="flex-1 overflow-auto px-4 py-6 md:px-8">
        <div className={cn("mx-auto space-y-6", activeTab === "runs" ? "max-w-5xl" : "max-w-3xl")}>
          {activeTab === "como" && <HowItWorks task={task} about={data.about} agentClose={data.agentClose} />}

          {activeTab === "config" && <ConfigTab data={data} />}

          {activeTab === "instrucciones" &&
            (task.instructions.editable ? (
              data.instructions && (
                <TaskInstructionsPanel
                  taskId={task.id}
                  taskName={task.name}
                  defaultText={data.instructions.defaultText}
                  activeVersion={data.instructions.activeVersion}
                  activeText={data.instructions.activeText}
                  versions={data.instructions.versions}
                  technical={data.instructions.technical}
                  variables={task.instructions.variables}
                  testPanel={
                    data.callConfig?.task === "call_analysis"
                      ? (draft) => (
                          <PromptTestPanel
                            calls={data.callConfig && data.callConfig.task === "call_analysis" ? data.callConfig.testableCalls : []}
                            what="las instrucciones"
                            getDraft={() => ({ instructionsText: draft })}
                          />
                        )
                      : undefined
                  }
                />
              )
            ) : (
              <Notice title="Esta tarea no usa instrucciones">{task.instructions.whyNot}</Notice>
            ))}

          {activeTab === "runs" && data.runs && <RunsScreen {...data.runs} currentOrigen={task.id} />}

          {activeTab === "costos" && <CostsTab data={data} />}
        </div>
      </div>
    </div>
  );
}

/**
 * Configuración: dónde se prende y se ajusta de verdad (`task.control`), y de
 * dónde sale el modelo. Una sola fuente: si la tarea se controla desde cada
 * agente, se muestra cómo está cada uno, no un selector propio.
 */
function ConfigTab({ data }: { data: TaskScreenData }) {
  const { task } = data;
  const control = task.control;
  return (
    <>
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cuándo corre y dónde se prende</h3>
        {control.kind === "task" && data.settings && task.backgroundTask && (
          <TaskModeEditor
            task={task.backgroundTask}
            settings={data.settings}
            canTurnOff={data.canTurnOff}
            canBatch={data.canBatch}
            batchWarning={data.batchWarning}
            lastRun={data.lastRun}
          />
        )}
        {control.kind === "agent" && (
          <>
            <Notice>
              Se prende y se apaga desde cada agente (pestaña Configuración, sección “Cierre de la conversación y memoria”), porque corre cuando ese agente cierra
              una conversación de su canal. No tiene modo propio: no hay un segundo interruptor que pueda contradecir al del agente.
            </Notice>
            {data.agentClose && <AgentCloseTable task={task} rows={data.agentClose} />}
          </>
        )}
        {control.kind === "integration" && (
          <Notice>
            Corre siempre, apenas hace falta: no se apaga ni se pasa a económico. El proveedor que la resuelve se elige en{" "}
            <Link href={control.href} className="underline underline-offset-2">
              {control.label}
            </Link>
            .
          </Notice>
        )}
        {control.kind === "on_demand" &&
          (task.id.startsWith("call_") ? (
            <Notice>
              Corre {control.where}. Si la corre sola o solo con un botón se elige más abajo, en esta misma pantalla.
            </Notice>
          ) : (
            <Notice>Corre solo {control.where}. Nunca corre sola.</Notice>
          ))}
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Modelo</h3>
        {data.model ? (
          <TaskModelPanel
            taskId={task.id}
            taskName={task.name}
            current={data.model.current}
            picker={data.model.picker}
            runsWhen={control.kind === "on_demand" ? control.where : "cuando corre"}
          />
        ) : (
          <Notice>{task.modelSource}</Notice>
        )}
      </section>

      {data.callConfig?.task === "call_classification" && <ClassificationConfig data={data.callConfig} />}
      {data.callConfig?.task === "call_analysis" && <AnalysisConfig data={data.callConfig} />}

      {data.quality && <QualityPanel data={data.quality} categories={data.categories ?? []} />}
      {data.quality && <ButtonTextsPanel buttonTexts={data.quality.buttonTexts} />}
    </>
  );
}

/** Costos: lo del mes en curso, y cómo se calcula. */
function CostsTab({ data }: { data: TaskScreenData }) {
  const runs = data.lastRun?.monthRuns ?? null;
  const spend = data.lastRun?.monthSpendUsd ?? null;
  const average = runs && spend !== null ? spend / runs : null;
  return (
    <>
      <dl className="grid gap-3 sm:grid-cols-3">
        <Stat label="Gasto del mes" value={formatSpend(spend)} />
        <Stat label="Corridas del mes" value={runs === null ? "—" : runs.toLocaleString("es")} />
        <Stat label="Promedio por corrida" value={formatSpend(average)} />
      </dl>
      <Notice title="Cómo se calcula">{data.about.cost}</Notice>
      <p className="text-xs text-muted-foreground">
        El mes cuenta desde el día 1 (UTC). El detalle de cada corrida, con su costo, está en la pestaña{" "}
        <Link href={`/dashboard/agents/tareas/${data.task.id}?tab=runs`} className="underline underline-offset-2">
          Corridas
        </Link>
        ; los topes de gasto de IA del negocio, en{" "}
        <Link href="/dashboard/agents" className="underline underline-offset-2">
          Agentes IA
        </Link>
        .
      </p>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-semibold">{value}</dd>
    </div>
  );
}

function Notice({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
      {title && <h3 className="mb-1 font-medium text-foreground">{title}</h3>}
      {children}
    </section>
  );
}
