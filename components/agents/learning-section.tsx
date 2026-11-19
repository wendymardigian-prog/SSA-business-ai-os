"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateAgentLearning } from "@/lib/actions/learned-rules";
import type { AgentScreenData } from "@/lib/agent/screen";
import { LEARNING_LIMITS } from "@/lib/ai-learning/settings";
import { Checkbox, Field, Notice, NumberInput, Section } from "./fields";

/**
 * Aprobación y aprendizaje del agente (bloque 16):
 *  - «Las acciones esperan aprobación»: en un canal con borradores, lo que escribe en el CRM queda propuesto. Apagado de
 *    serie (decisión de producto, 18/11/2026).
 *  - Ejemplos automáticos: apagados de serie.
 *  - Umbral de reglas aprendidas.
 */
export function LearningSection({ data }: { data: AgentScreenData }) {
  const router = useRouter();
  const { agent } = data;
  const [actions, setActions] = useState(agent.actionsNeedApproval);
  const [examples, setExamples] = useState(agent.learning.examples);
  const [approved, setApproved] = useState<number | null>(agent.learning.approvedExamples);
  const [edits, setEdits] = useState<number | null>(agent.learning.editExamples);
  const [threshold, setThreshold] = useState<number | null>(agent.learning.ruleThreshold);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const dirty =
    actions !== agent.actionsNeedApproval ||
    examples !== agent.learning.examples ||
    approved !== agent.learning.approvedExamples ||
    edits !== agent.learning.editExamples ||
    threshold !== agent.learning.ruleThreshold;

  function save() {
    setMessage(null);
    start(async () => {
      const result = await updateAgentLearning(agent.id, {
        actionsNeedApproval: actions,
        examples,
        approvedExamples: approved ?? 0,
        editExamples: edits ?? 0,
        ruleThreshold: threshold ?? 3,
      });
      if (!result.ok) return setMessage({ tone: "error", text: result.error });
      setMessage({ tone: "success", text: "Guardado." });
      router.refresh();
    });
  }

  return (
    <Section title="Aprobación y aprendizaje" description="Qué espera a una persona y qué aprende el agente de lo que se aprueba y se rechaza. El prompt nunca se reescribe solo.">
      <Checkbox
        label="Las acciones esperan aprobación"
        description="En los canales que dejan borradores para aprobar, lo que el agente quiere hacer en el CRM (etiquetar, cambiar la temperatura, crear una tarea…) queda en Agentes IA › Aprobaciones hasta que una persona lo apruebe. En los canales que envían directo no cambia nada. Apagado, el agente hace esas acciones solo, como siempre."
        checked={actions}
        onChange={setActions}
      />
      <Checkbox
        label="Llevar ejemplos de lo aprobado en el prompt"
        description="Los últimos borradores aprobados de ese canal y las correcciones más útiles («propuesto → final»). Apagado de serie: los ejemplos llevan textos de conversaciones con otros leads."
        checked={examples}
        onChange={setExamples}
      />
      {examples && (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Aprobados tal cual">
            {(id) => <NumberInput id={id} value={approved} min={LEARNING_LIMITS.approvedExamples.min} max={LEARNING_LIMITS.approvedExamples.max} onChange={setApproved} />}
          </Field>
          <Field label="Correcciones">
            {(id) => <NumberInput id={id} value={edits} min={LEARNING_LIMITS.editExamples.min} max={LEARNING_LIMITS.editExamples.max} onChange={setEdits} />}
          </Field>
        </div>
      )}
      <Field label="Proponer una regla tras este número de rechazos con el mismo motivo" hint="Dentro de los últimos 30 días. La regla solo entra al prompt si una persona la acepta.">
        {(id) => <NumberInput id={id} value={threshold} min={LEARNING_LIMITS.ruleThreshold.min} max={LEARNING_LIMITS.ruleThreshold.max} onChange={setThreshold} />}
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Guardar
        </button>
        {dirty && !pending && <span className="text-xs text-amber-700 dark:text-amber-400">Cambios sin guardar</span>}
      </div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </Section>
  );
}
