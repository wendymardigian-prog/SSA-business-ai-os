"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import { updateAgentTools } from "@/lib/actions/agents";
import type { AgentScreenData } from "@/lib/agent/screen";
import { Notice, Section } from "./fields";
import { ToolConfigFields, blockingField } from "./tool-config-fields";

/**
 * Pestana Herramientas (F23): cada herramienta del registro con su switch y
 * sus parametros desplegables. Todo sale del descriptor que declara cada
 * herramienta (configFields): aca no hay un solo `if (tool.name === ...)`.
 *
 * Una herramienta obligatoria no tiene switch. Una que se decide en otra
 * pestana (la busqueda en la KB, desde Conocimiento) muestra el link. Una que
 * necesita una lista (tags, usuarios) y la fuente esta vacia queda apagada con
 * el motivo escrito.
 */
export function ToolsTab({ data }: { data: AgentScreenData }) {
  const router = useRouter();
  const { agent, tools, toolOptionSources } = data;
  const [allowed, setAllowed] = useState<string[]>(agent.allowedTools);
  const [config, setConfig] = useState<Record<string, Record<string, unknown>>>(() =>
    Object.fromEntries(
      tools.map((t) => [t.name, { ...t.defaults, ...((agent.toolsConfig[t.name] as Record<string, unknown> | undefined) ?? {}) }]),
    ),
  );
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const initial = JSON.stringify({ allowed: [...agent.allowedTools].sort(), config: Object.fromEntries(tools.map((t) => [t.name, { ...t.defaults, ...((agent.toolsConfig[t.name] as Record<string, unknown> | undefined) ?? {}) }])) });
  const dirty = JSON.stringify({ allowed: [...allowed].sort(), config }) !== initial;

  function toggle(name: string, on: boolean) {
    setMessage(null);
    setAllowed((prev) => (on ? [...new Set([...prev, name])] : prev.filter((n) => n !== name)));
  }

  function setField(name: string, key: string, value: unknown) {
    setMessage(null);
    setConfig((prev) => ({ ...prev, [name]: { ...prev[name], [key]: value } }));
  }

  function save() {
    setMessage(null);
    start(async () => {
      const result = await updateAgentTools(agent.id, { allowedTools: allowed, toolsConfig: config });
      if (!result.ok) return setMessage({ tone: "error", text: result.error });
      setMessage({ tone: "success", text: "Herramientas guardadas." });
      router.refresh();
    });
  }

  return (
    <>
      <Section
        title="Herramientas"
        description="Lo que el agente puede hacer además de responder. Cada una corre en modo «aplica solo» (sin aprobación previa), queda en el historial de Acciones y se puede revertir desde ahí."
      >
        <ul className="divide-y divide-border rounded-lg border border-border">
          {tools.map((tool) => {
            const blocked = blockingField(tool.configFields, toolOptionSources);
            const on = tool.required || allowed.includes(tool.name);
            const managedElsewhere = tool.managedFrom !== null;
            return (
              <li key={tool.name} className="px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {tool.label}
                      <span className="ml-2 font-mono text-[10px] text-muted-foreground">{tool.name}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{tool.description}</p>
                    {tool.required && <p className="mt-1 text-[11px] text-muted-foreground">Siempre activa: es la salida de emergencia del agente.</p>}
                    {managedElsewhere && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Se enciende desde la pestaña{" "}
                        <Link href={`/dashboard/agents/${agent.id}?tab=knowledge`} className="underline underline-offset-2">Conocimiento</Link>
                        {agent.knowledgeEnabled ? " (hoy: encendida)." : " (hoy: apagada)."}
                      </p>
                    )}
                    {blocked && !tool.required && (
                      <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                        {(blocked.kind === "multiselect" && blocked.emptySourceMessage) || "Falta configurar una lista para poder habilitarla."}
                      </p>
                    )}
                  </div>
                  {!tool.required && !managedElsewhere && (
                    <Switch
                      checked={on && !blocked}
                      disabled={pending || blocked !== null}
                      onChange={(next) => toggle(tool.name, next)}
                      label={`Habilitar ${tool.label}`}
                    />
                  )}
                </div>

                {tool.configFields.length > 0 && (
                  <details className="mt-2 group" open={on && !blocked}>
                    <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground">
                      Parámetros
                    </summary>
                    <div className="mt-3 rounded-lg border border-dashed border-border p-3">
                      <ToolConfigFields
                        fields={tool.configFields}
                        values={config[tool.name] ?? tool.defaults}
                        sources={toolOptionSources}
                        onChange={(key, value) => setField(tool.name, key, value)}
                        disabled={pending}
                      />
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>

        <Notice tone="info">
          Las herramientas de lectura (buscar en la base de conocimiento, buscar datos del contacto) dejan su paso en el run pero no
          una acción: no hay nada que revertir en una lectura.
        </Notice>

        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={!dirty || pending} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            Guardar herramientas
          </button>
          {message && (
            <span role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-xs text-red-700 dark:text-red-400" : "text-xs text-emerald-700 dark:text-emerald-400"}>
              {message.text}
            </span>
          )}
        </div>
      </Section>
    </>
  );
}
