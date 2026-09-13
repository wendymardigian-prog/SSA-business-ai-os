"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateAgentConfig } from "@/lib/actions/agents";
import { validateAgentConfig, expectedResponseSeconds, type AgentConfigInput } from "@/lib/agent/validate";
import type { AgentConfigSection, AgentTypeDefinition } from "@/lib/agent/agent-types";
import type { AgentScreenData } from "@/lib/agent/screen";
import { PromptSection } from "./prompt-section";
import { Checkbox, Field, Notice, NumberInput, Section, inputClass, linesToList } from "./fields";

/**
 * Pestana Configuracion. Las secciones son las que declara el tipo de agente
 * (configSections): la pestana no pregunta de que tipo es.
 */

type Form = AgentConfigInput;
type SectionProps = { form: Form; set: (patch: Partial<Form>) => void; data: AgentScreenData };

const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function toForm(agent: AgentScreenData["agent"]): Form {
  return {
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    fallbackProvider: agent.fallbackProvider,
    fallbackModel: agent.fallbackModel,
    temperature: agent.temperature,
    maxOutputTokens: agent.maxOutputTokens,
    modelTimeoutSeconds: agent.modelTimeoutSeconds,
    bundleWindowSeconds: agent.bundleWindowSeconds,
    responseDelaySeconds: agent.responseDelaySeconds,
    maxWaitSeconds: agent.maxWaitSeconds,
    maxRepliesPerConversation: agent.maxRepliesPerConversation,
    outputFormat: agent.outputFormat,
    guardrails: agent.guardrails,
    dailyCostLimitUsd: agent.dailyCostLimitUsd,
    dailyCostLimitAction: agent.dailyCostLimitAction,
    monthlyCostLimitUsd: agent.monthlyCostLimitUsd,
    monthlyCostLimitAction: agent.monthlyCostLimitAction,
  };
}

function IdentitySection({ form, set }: SectionProps) {
  return (
    <Section title="Identidad">
      <Field label="Nombre">{(id) => <input id={id} value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} className={inputClass} />}</Field>
    </Section>
  );
}

function ModelPicker({
  label,
  provider,
  model,
  onChange,
  data,
  optional,
}: {
  label: string;
  provider: string | null;
  model: string | null;
  onChange: (provider: string | null, model: string | null) => void;
  data: AgentScreenData;
  optional?: boolean;
}) {
  const connected = data.providers.find((p) => p.provider === provider);
  const unavailable = provider !== null && !connected;
  const models = connected?.models ?? [];
  const priced = provider && model ? data.pricedModels.includes(`${provider}/${model}`) : true;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field label={`${label}: proveedor`}>
        {(id) => (
          <select
            id={id}
            value={provider ?? ""}
            onChange={(e) => {
              const next = e.target.value || null;
              const def = data.providers.find((p) => p.provider === next);
              onChange(next, next ? def?.defaultModel || null : null);
            }}
            className={`${inputClass} ${unavailable ? "border-red-500 text-red-700 dark:text-red-400" : ""}`}
            aria-invalid={unavailable || undefined}
          >
            {optional && <option value="">Sin respaldo</option>}
            {!optional && provider === null && <option value="">Elegí un proveedor</option>}
            {unavailable && (
              <option value={provider ?? ""}>
                {data.providerLabels[provider ?? ""] ?? provider} (no conectado)
              </option>
            )}
            {data.providers.map((p) => (
              <option key={p.provider} value={p.provider}>
                {p.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={`${label}: modelo`}>
        {(id) => (
          <select
            id={id}
            value={model ?? ""}
            onChange={(e) => onChange(provider, e.target.value || null)}
            disabled={!provider || unavailable}
            className={inputClass}
          >
            {model && !models.includes(model) && <option value={model}>{model}</option>}
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
      </Field>
      {unavailable && (
        <div className="md:col-span-2">
          <Notice tone="error">
            El proveedor configurado ya no está conectado. El agente no va a poder usarlo: conectalo en Integraciones o elegí otro.
          </Notice>
        </div>
      )}
      {!unavailable && !priced && (
        <div className="md:col-span-2">
          <Notice tone="warning">
            Este modelo no tiene precio cargado: los runs se van a guardar con el costo sin calcular. Hay que sumarlo a la tabla de precios.
          </Notice>
        </div>
      )}
    </div>
  );
}

function ModelSection({ form, set, data }: SectionProps) {
  return (
    <Section title="Modelo" description="Solo aparecen los proveedores con la API key cargada. Si el principal falla, se reintenta, después se usa el respaldo y, si tampoco responde, la conversación pasa a una persona sin que el lead vea ningún error.">
      {data.providers.length === 0 && (
        <Notice tone="warning">No hay ningún proveedor de IA conectado. Se conecta en Integraciones.</Notice>
      )}
      <ModelPicker label="Principal" provider={form.provider} model={form.model} data={data} onChange={(provider, model) => set({ provider, model })} />
      <ModelPicker label="Respaldo" optional provider={form.fallbackProvider} model={form.fallbackModel} data={data} onChange={(fallbackProvider, fallbackModel) => set({ fallbackProvider, fallbackModel })} />
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Temperatura (0 a 2)" hint="Más baja, más predecible.">
          {(id) => <NumberInput id={id} value={form.temperature} min={0} max={2} step={0.1} allowEmpty onChange={(temperature) => set({ temperature })} />}
        </Field>
        <Field label="Máximo de tokens por respuesta">
          {(id) => <NumberInput id={id} value={form.maxOutputTokens} min={16} max={16000} allowEmpty onChange={(maxOutputTokens) => set({ maxOutputTokens })} />}
        </Field>
        <Field label="Timeout del modelo (segundos)">
          {(id) => <NumberInput id={id} value={form.modelTimeoutSeconds} min={10} max={240} onChange={(v) => set({ modelTimeoutSeconds: v ?? 120 })} />}
        </Field>
      </div>
    </Section>
  );
}

function TimingSection({ form, set }: SectionProps) {
  const total = expectedResponseSeconds(form.bundleWindowSeconds, form.responseDelaySeconds);
  return (
    <Section title="Tiempos de respuesta" description="El agente no contesta al instante: espera a que el lead termine de escribir y responde a todos sus mensajes juntos.">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Ventana de silencio (segundos)" hint="Cada mensaje nuevo reinicia la cuenta.">
          {(id) => <NumberInput id={id} value={form.bundleWindowSeconds} min={15} max={3600} onChange={(v) => set({ bundleWindowSeconds: v ?? 60 })} />}
        </Field>
        <Field label="Demora de respuesta (segundos)" hint="Después de que cierra la ventana.">
          {(id) => <NumberInput id={id} value={form.responseDelaySeconds} min={0} max={180} onChange={(v) => set({ responseDelaySeconds: v ?? 0 })} />}
        </Field>
        <Field label="Tope de espera (segundos)" hint="Vacío: sin tope.">
          {(id) => <NumberInput id={id} value={form.maxWaitSeconds} min={15} max={7200} allowEmpty onChange={(maxWaitSeconds) => set({ maxWaitSeconds })} />}
        </Field>
      </div>
      <Notice tone="info">
        Va a responder unos <strong>{total} segundos</strong> después del último mensaje del lead
        {form.maxWaitSeconds ? `, y como mucho ${form.maxWaitSeconds + form.responseDelaySeconds} segundos después del primero aunque siga escribiendo` : ""}.
      </Notice>
    </Section>
  );
}

function OutputSection({ form, set }: SectionProps) {
  const f = form.outputFormat;
  const patch = (p: Partial<typeof f>) => set({ outputFormat: { ...f, ...p } });
  return (
    <Section title="Formato de salida" description="Se valida en el sistema antes de enviar, no solo se le pide al modelo.">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Largo máximo por mensaje">
          {(id) => <NumberInput id={id} value={f.maxLength} min={80} max={2000} onChange={(v) => patch({ maxLength: v ?? 600 })} />}
        </Field>
        <Field label="Máximo de mensajes por respuesta">
          {(id) => <NumberInput id={id} value={f.maxParts} min={1} max={5} onChange={(v) => patch({ maxParts: v ?? 1 })} />}
        </Field>
        <Field label="Idioma">
          {(id) => (
            <select id={id} value={f.language} onChange={(e) => patch({ language: e.target.value })} className={inputClass}>
              <option value="es">Español</option>
              <option value="en">Inglés</option>
              <option value="pt">Portugués</option>
            </select>
          )}
        </Field>
      </div>
      <Checkbox checked={f.allowSplit} onChange={(allowSplit) => patch({ allowSplit })} label="Puede partir la respuesta en varios mensajes cortos" />
      <Checkbox checked={f.emojis} onChange={(emojis) => patch({ emojis })} label="Puede usar emojis" />
    </Section>
  );
}

function GuardrailsSection({ form, set }: SectionProps) {
  const g = form.guardrails;
  const patch = (p: Partial<typeof g>) => set({ guardrails: { ...g, ...p } });
  const hours = g.businessHours;
  const slotFor = (day: number) => hours.slots.find((s) => s.day === day) ?? null;
  const setSlot = (day: number, slot: { start: string; end: string } | null) =>
    patch({
      businessHours: {
        ...hours,
        slots: [...hours.slots.filter((s) => s.day !== day), ...(slot ? [{ day, ...slot }] : [])].sort((a, b) => a.day - b.day),
      },
    });

  return (
    <Section title="Guardarraíles" description="Los límites que hacen seguro dejarlo prendido. Se evalúan en el servidor antes de llamar al modelo.">
      <div className="space-y-3 rounded-lg border border-border p-4">
        <Checkbox
          checked={hours.enabled}
          onChange={(enabled) => patch({ businessHours: { ...hours, enabled } })}
          label="Horario de atención"
          description="Apagado: atiende 24/7. Los horarios son de Costa Rica."
        />
        {hours.enabled && (
          <>
            <ul className="space-y-2">
              {DAYS.map((name, day) => {
                const slot = slotFor(day);
                return (
                  <li key={day} className="flex flex-wrap items-center gap-3">
                    <label className="flex w-32 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={slot !== null}
                        onChange={(e) => setSlot(day, e.target.checked ? { start: "09:00", end: "18:00" } : null)}
                      />
                      {name}
                    </label>
                    {slot && (
                      <>
                        <input type="time" aria-label={`${name}: desde`} value={slot.start} onChange={(e) => setSlot(day, { ...slot, start: e.target.value })} className={`${inputClass} w-32`} />
                        <span className="text-xs text-muted-foreground">a</span>
                        <input type="time" aria-label={`${name}: hasta`} value={slot.end} onChange={(e) => setSlot(day, { ...slot, end: e.target.value })} className={`${inputClass} w-32`} />
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
            <Field label="Fuera de horario">
              {(id) => (
                <select
                  id={id}
                  value={hours.outsideMode}
                  onChange={(e) => patch({ businessHours: { ...hours, outsideMode: e.target.value as "silent" | "notice" } })}
                  className={inputClass}
                >
                  <option value="silent">No responde</option>
                  <option value="notice">Responde avisando que sigue una persona</option>
                </select>
              )}
            </Field>
            {hours.outsideMode === "notice" && (
              <Field label="Mensaje fuera de horario" hint="Se manda tal cual, sin pasar por el modelo, y como mucho una vez cada 8 horas.">
                {(id) => (
                  <textarea id={id} rows={2} maxLength={500} value={hours.outsideMessage} onChange={(e) => patch({ businessHours: { ...hours, outsideMessage: e.target.value } })} className={inputClass} />
                )}
              </Field>
            )}
          </>
        )}
      </div>

      <div className="space-y-3 rounded-lg border border-border p-4">
        <Checkbox
          checked={g.blockedTopics.enabled}
          onChange={(enabled) => patch({ blockedTopics: { ...g.blockedTopics, enabled } })}
          label="Temas que no contesta"
          description="Si el lead escribe alguna de estas frases, la conversación pasa directo a una persona sin llamar al modelo."
        />
        {g.blockedTopics.enabled && (
          <Field label="Frases (una por línea)">
            {(id) => (
              <textarea id={id} rows={6} value={g.blockedTopics.phrases.join("\n")} onChange={(e) => patch({ blockedTopics: { ...g.blockedTopics, phrases: linesToList(e.target.value) } })} className={`${inputClass} text-xs`} />
            )}
          </Field>
        )}
      </div>

      <div className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-sm font-medium">Escalamiento</p>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Tope de respuestas por conversación" hint="Se reinicia cuando escribe una persona del equipo.">
            {(id) => <NumberInput id={id} value={form.maxRepliesPerConversation} min={1} max={500} onChange={(v) => set({ maxRepliesPerConversation: v ?? 12 })} />}
          </Field>
          <Field label="Turnos seguidos sin resolver">
            {(id) => <NumberInput id={id} value={g.escalation.maxUnresolvedTurns} min={1} max={50} onChange={(v) => patch({ escalation: { ...g.escalation, maxUnresolvedTurns: v ?? 6 } })} />}
          </Field>
          <Field label="Silencio que corta un intercambio (minutos)">
            {(id) => <NumberInput id={id} value={g.escalation.exchangeGapMinutes} min={10} max={1440} onChange={(v) => patch({ escalation: { ...g.escalation, exchangeGapMinutes: v ?? 120 } })} />}
          </Field>
        </div>
        <Checkbox checked={g.escalation.frustration} onChange={(frustration) => patch({ escalation: { ...g.escalation, frustration } })} label="Derivar si detecta enojo" />
        {g.escalation.frustration && (
          <Field label="Señales de enojo (una por línea)">
            {(id) => <textarea id={id} rows={3} value={g.escalation.frustrationPhrases.join("\n")} onChange={(e) => patch({ escalation: { ...g.escalation, frustrationPhrases: linesToList(e.target.value) } })} className={`${inputClass} text-xs`} />}
          </Field>
        )}
        <Checkbox checked={g.escalation.urgency} onChange={(urgency) => patch({ escalation: { ...g.escalation, urgency } })} label="Derivar si detecta urgencia" />
        {g.escalation.urgency && (
          <Field label="Señales de urgencia (una por línea)">
            {(id) => <textarea id={id} rows={3} value={g.escalation.urgencyPhrases.join("\n")} onChange={(e) => patch({ escalation: { ...g.escalation, urgencyPhrases: linesToList(e.target.value) } })} className={`${inputClass} text-xs`} />}
          </Field>
        )}
      </div>

      <div className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-sm font-medium">Topes de gasto (USD, estimado según los precios cargados)</p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Diario" hint="Vacío: sin tope.">
            {(id) => <NumberInput id={id} value={form.dailyCostLimitUsd} min={0} step={0.5} allowEmpty onChange={(dailyCostLimitUsd) => set({ dailyCostLimitUsd })} />}
          </Field>
          <Field label="Al superarlo">
            {(id) => (
              <select id={id} value={form.dailyCostLimitAction} onChange={(e) => set({ dailyCostLimitAction: e.target.value as "notify" | "disable" })} className={inputClass}>
                <option value="notify">Avisar</option>
                <option value="disable">Apagar el agente</option>
              </select>
            )}
          </Field>
          <Field label="Mensual" hint="Vacío: sin tope.">
            {(id) => <NumberInput id={id} value={form.monthlyCostLimitUsd} min={0} step={1} allowEmpty onChange={(monthlyCostLimitUsd) => set({ monthlyCostLimitUsd })} />}
          </Field>
          <Field label="Al superarlo">
            {(id) => (
              <select id={id} value={form.monthlyCostLimitAction} onChange={(e) => set({ monthlyCostLimitAction: e.target.value as "notify" | "disable" })} className={inputClass}>
                <option value="notify">Avisar</option>
                <option value="disable">Apagar el agente</option>
              </select>
            )}
          </Field>
        </div>
      </div>
    </Section>
  );
}

/** Cada seccion declarable por un tipo de agente. Las que viven en otra pestana no se renderizan aca. */
const SECTIONS: Record<AgentConfigSection, ((props: SectionProps) => React.ReactNode) | null> = {
  identity: (p) => <IdentitySection {...p} />,
  prompt: null, // se guarda aparte, con versionado
  model: (p) => <ModelSection {...p} />,
  timing: (p) => <TimingSection {...p} />,
  output: (p) => <OutputSection {...p} />,
  guardrails: (p) => <GuardrailsSection {...p} />,
  knowledge: null,
  channels: null,
};

export function ConfigTab({ data, typeDef }: { data: AgentScreenData; typeDef: AgentTypeDefinition }) {
  const router = useRouter();
  const initial = useMemo(() => toForm(data.agent), [data.agent]);
  const [form, setForm] = useState<Form>(initial);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const set = (patch: Partial<Form>) => {
    setMessage(null);
    setForm((prev) => ({ ...prev, ...patch }));
  };
  const check = validateAgentConfig(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  function save() {
    if (!check.ok) return setMessage({ tone: "error", text: check.error });
    start(async () => {
      const result = await updateAgentConfig(data.agent.id, form);
      if (!result.ok) return setMessage({ tone: "error", text: result.error });
      setMessage({ tone: "success", text: "Configuración guardada." });
      router.refresh();
    });
  }

  return (
    <>
      {typeDef.configSections.includes("prompt") && <PromptSection data={data} />}
      {typeDef.configSections.map((key) => {
        const render = SECTIONS[key];
        return render ? <div key={key}>{render({ form, set, data })}</div> : null;
      })}
      <div className="sticky bottom-0 -mx-2 flex items-center gap-3 border-t border-border bg-background/95 px-2 py-3 backdrop-blur">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Guardar configuración
        </button>
        {dirty && !check.ok && <span role="alert" className="text-xs text-red-700 dark:text-red-400">{check.error}</span>}
        {message && (
          <span role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-xs text-red-700 dark:text-red-400" : "text-xs text-emerald-700 dark:text-emerald-400"}>
            {message.text}
          </span>
        )}
      </div>
    </>
  );
}
