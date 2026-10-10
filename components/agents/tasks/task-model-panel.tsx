"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveTaskModel } from "@/lib/actions/ai-tasks";
import { ModelPicker, type ModelPickerData } from "@/components/agents/model-picker";
import { Notice, Section } from "@/components/agents/fields";
import type { TaskModelChoice } from "@/lib/ai-tasks/model";

/**
 * El modelo de una tarea de IA: el del negocio (el que se elige por defecto en
 * Integraciones) o uno propio de esta tarea. Un modelo elegido a mano se usa
 * tal cual y, si ese proveedor se desconecta, la tarea falla avisando: nunca
 * cambia de modelo en silencio.
 */
export function TaskModelPanel({
  taskId,
  taskName,
  current,
  picker,
  runsWhen,
}: {
  taskId: string;
  taskName: string;
  /** Lo guardado; null = usa el modelo del negocio. */
  current: TaskModelChoice | null;
  picker: ModelPickerData;
  /** Cuando corre la tarea, en una frase ("al apretar Analizar con IA…"). */
  runsWhen: string;
}) {
  const router = useRouter();
  const [custom, setCustom] = useState(current !== null);
  const [provider, setProvider] = useState<string | null>(current?.provider ?? null);
  const [model, setModel] = useState<string | null>(current?.model ?? null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const dirty = custom
    ? provider !== (current?.provider ?? null) || model !== (current?.model ?? null)
    : current !== null;
  const incomplete = custom && (!provider || !model);

  function choose(useCustom: boolean) {
    setCustom(useCustom);
    setMessage(null);
    if (useCustom && !provider) {
      // Arranca en el primer proveedor conectado, con su modelo por defecto.
      const first = picker.providers[0];
      setProvider(first?.provider ?? null);
      setModel(first?.defaultModel || null);
    }
  }

  function save() {
    setMessage(null);
    start(async () => {
      const result = await saveTaskModel(taskId, custom ? provider : null, custom ? model : null);
      if (!result.ok) return setMessage({ tone: "error", text: result.error });
      setMessage({
        tone: "success",
        text: custom ? "Listo: esta tarea va a usar ese modelo." : "Listo: esta tarea usa el modelo del negocio.",
      });
      router.refresh();
    });
  }

  return (
    <Section title="Modelo" description={`Qué modelo de IA usa "${taskName}". Corre ${runsWhen}.`}>
      <fieldset className="space-y-2">
        <legend className="sr-only">Qué modelo usa la tarea</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name={`modelo-${taskId}`} checked={!custom} onChange={() => choose(false)} className="mt-1" />
          <span>
            <span className="font-medium">Usar el modelo del negocio</span>
            <span className="block text-xs text-muted-foreground">
              El proveedor y el modelo por defecto que están en Ajustes → Integraciones. Si ahí cambiás de modelo, esta tarea cambia con él.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name={`modelo-${taskId}`}
            checked={custom}
            onChange={() => choose(true)}
            disabled={picker.providers.length === 0}
            className="mt-1"
          />
          <span>
            <span className="font-medium">Elegir un modelo para esta tarea</span>
            <span className="block text-xs text-muted-foreground">Un proveedor y un modelo solo para el análisis.</span>
          </span>
        </label>
      </fieldset>

      {picker.providers.length === 0 && (
        <Notice tone="warning">
          No hay ningún proveedor de IA de texto conectado. Conectalo en Ajustes → Integraciones para poder elegir un modelo.
        </Notice>
      )}

      {custom && (
        <ModelPicker
          label="Modelo"
          provider={provider}
          model={model}
          data={picker}
          onChange={(nextProvider, nextModel) => {
            setProvider(nextProvider);
            setModel(nextModel);
          }}
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending || incomplete}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Guardar modelo
        </button>
        {dirty && !pending && <span className="text-xs text-amber-700 dark:text-amber-400">Cambios sin guardar</span>}
      </div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </Section>
  );
}
