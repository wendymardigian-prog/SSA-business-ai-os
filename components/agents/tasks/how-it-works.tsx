import Link from "next/link";
import type { TaskAbout } from "@/lib/ai-tasks/about";
import type { AgentCloseSettings } from "@/lib/ai-tasks/agent-close-settings";
import type { AiTaskDef } from "@/lib/ai-tasks/catalog";

/**
 * La pestaña "Cómo funciona" de una tarea de IA: la misma estructura para
 * todas (cuándo corre, qué lee, qué decide, qué escribe, topes y costo). El
 * contenido sale de `lib/ai-tasks/about.ts`, que lee los topes del código real.
 */
export function HowItWorks({ task, about, agentClose }: { task: AiTaskDef; about: TaskAbout; agentClose?: AgentCloseSettings[] }) {
  return (
    <div className="space-y-4">
      <Block title="Cuándo corre">
        <p>{about.trigger}</p>
      </Block>
      <Block title="Qué lee">
        <Bullets items={about.reads} />
      </Block>
      <Block title="Qué decide">
        <Bullets items={about.decides} />
      </Block>
      <Block title="Qué escribe">
        <Bullets items={about.writes} />
      </Block>
      <Block title="Topes fijos">
        <Bullets items={about.limits} />
      </Block>
      {task.control.kind === "agent" && agentClose && (
        <Block title="Cómo está en cada agente">
          <AgentCloseTable task={task} rows={agentClose} />
        </Block>
      )}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 text-sm">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 marker:text-muted-foreground">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

const yes = (on: boolean) => (on ? "Sí" : "No");

/**
 * Agente por agente: si la tarea corre y con qué límites. Es la configuración
 * REAL (la de cada agente y sus herramientas), no una copia: se cambia desde
 * el agente, con el link de cada fila.
 */
export function AgentCloseTable({ task, rows }: { task: AiTaskDef; rows: AgentCloseSettings[] }) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground">Todavía no hay ningún agente que atienda conversaciones. Esta tarea corre cuando un agente cierra una.</p>;
  }
  const isClassification = task.id === "close_classification";
  return (
    <ul className="space-y-3">
      {rows.map((a) => {
        const active = a.isEnabled && (isClassification ? a.classifyOnClose : a.summaryOnClose);
        return (
          <li key={a.agentId} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{a.name}</p>
              <span
                className={
                  active
                    ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                    : "rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                }
              >
                {active ? "Corre" : !a.isEnabled ? "No corre: el agente está apagado" : "No corre: apagada en el agente"}
              </span>
            </div>
            <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
              <Row label={isClassification ? "Clasificación al cierre" : "Resumen al cierre"} value={yes(isClassification ? a.classifyOnClose : a.summaryOnClose)} />
              <Row label="Cierra sola tras" value={`${a.closeAfterInactiveHours} h sin mensajes`} />
              {isClassification && (
                <>
                  <Row
                    label="Etiquetas"
                    value={
                      !a.tags.enabled
                        ? "Herramienta apagada: no etiqueta"
                        : a.tags.allowedNames.length === 0
                          ? "Sin etiquetas permitidas"
                          : `${a.tags.allowedNames.join(", ")}${a.tags.canRemove ? " (puede quitar)" : " (solo agrega)"}`
                    }
                  />
                  <Row
                    label="Temperatura"
                    value={!a.temperature.enabled ? "Herramienta apagada: no la cambia" : a.temperature.canLower ? "Puede subirla y bajarla" : "Solo puede subirla"}
                  />
                  <Row
                    label="Seguimiento"
                    value={
                      !a.followup.enabled
                        ? "Herramienta apagada: no agenda"
                        : `Hasta ${a.followup.maxDaysAhead} días${a.followup.canOverrideManual ? ", y puede pisar una fecha puesta a mano" : ", sin pisar una fecha puesta a mano"}`
                    }
                  />
                </>
              )}
            </dl>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <Link href={`/dashboard/agents/${a.agentId}?tab=config`} className="underline underline-offset-2">
                Cambiar en la configuración del agente
              </Link>
              {isClassification && (
                <Link href={`/dashboard/agents/${a.agentId}?tab=tools`} className="underline underline-offset-2">
                  Herramientas y sus límites
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1">
      <dt className="shrink-0">{label}:</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}
