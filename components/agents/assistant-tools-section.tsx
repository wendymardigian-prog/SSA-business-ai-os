"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateAssistantTools } from "@/lib/actions/learned-rules";
import type { AgentScreenData } from "@/lib/agent/screen";
import { Checkbox, Notice, Section } from "./fields";

/**
 * Las herramientas del asistente del equipo. Cada una declara si lee o escribe y qué permiso exige: el asistente
 * solo le ofrece a cada persona las que su rol permite, y lo que escribe espera su aprobación. Respuesta prevista
 * P-80 (falta confirmar): de serie, todas.
 */
export function AssistantToolsSection({ data }: { data: AgentScreenData }) {
  const router = useRouter();
  const tools = data.assistantTools;
  const [enabled, setEnabled] = useState<string[]>(tools?.enabled ?? []);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!tools) return null;
  const dirty = [...enabled].sort().join(",") !== [...tools.enabled].sort().join(",");

  function toggle(key: string, on: boolean) {
    setMessage(null);
    setEnabled((prev) => (on ? [...new Set([...prev, key])] : prev.filter((k) => k !== key)));
  }
  function save() {
    start(async () => {
      const result = await updateAssistantTools(data.agent.id, enabled);
      if (!result.ok) return setMessage({ tone: "error", text: result.error });
      setMessage({ tone: "success", text: "Herramientas guardadas." });
      router.refresh();
    });
  }

  return (
    <Section
      title="Herramientas del asistente"
      description="Actúa con la identidad de cada persona: solo ve lo que su rol le deja ver y solo ofrece lo que su rol puede hacer. Para usarlo hace falta el permiso «Usar el asistente»."
    >
      <ul className="space-y-2">
        {tools.all.map((tool) => (
          <li key={tool.key} className="rounded-lg border border-border p-3">
            <Checkbox
              checked={enabled.includes(tool.key)}
              onChange={(on) => toggle(tool.key, on)}
              label={`${tool.label} · ${tool.access === "read" ? "Lee" : "Escribe (espera aprobación)"}`}
              description={`${tool.description} Pide el permiso «${tool.permission}».`}
            />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Guardar herramientas
        </button>
        {dirty && !pending && <span className="text-xs text-amber-700 dark:text-amber-400">Cambios sin guardar</span>}
      </div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </Section>
  );
}
