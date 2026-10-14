"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Workflow } from "lucide-react";
import { Notice, Section, inputClass } from "@/components/agents/fields";
import { Switch } from "@/components/ui/switch";
import { createEodFlowFromTemplate, createFormFlow, createFormFlowFromTemplate, toggleFormFlow } from "@/lib/actions/forms/flows";
import { EOD_FLOW_TEMPLATES, type EodTemplateKey } from "@/lib/eod/automation/templates";
import { templateQuestions, templatesForType, type FormTemplateKey } from "@/lib/forms/automation/templates";
import type { EditorExtras, EditorForm } from "./types";

/**
 * La pestaña Automatizaciones (F21): los flujos de este formulario, un botón para
 * crear uno y las plantillas de un clic. Un flujo es un flow normal: se edita en el
 * editor de pasos (Cuándo / Solo si… / Pasos, con Condiciones) o, si hace falta más, en el canvas.
 *
 * Aspecto de `FormAutomationsSection.tsx` de prevxcrm (la lista y las tarjetas de
 * plantilla); el editor es el de pasos de SSA.
 */
export function AutomationsTab({ form, extras, canManage }: { form: EditorForm; extras: EditorExtras; canManage: boolean }) {
  const router = useRouter();
  const [flows, setFlows] = useState(extras.flows);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [tagName, setTagName] = useState("");
  const [questionKey, setQuestionKey] = useState("");
  const [pending, start] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const canEdit = canManage && extras.canFlows && form.status !== "archived";
  const isEod = form.type === "eod";
  const templates = templatesForType(form.type);
  // Las mismas preguntas con las que se arman las condiciones: la version publicada, o el borrador si nunca se publico.
  const questions = templateQuestions((form.publishedSnapshot ?? form.draftDefinition).fields);

  function create() {
    setMessage(null);
    setBusyKey("new");
    start(async () => {
      const result = await createFormFlow({ formId: form.id });
      setBusyKey(null);
      if (result.ok) router.push(`/dashboard/formularios/${form.id}/automatizaciones/${result.flowId}`);
      else setMessage({ tone: "error", text: result.error });
    });
  }

  function fromTemplate(key: FormTemplateKey) {
    setMessage(null);
    setBusyKey(key);
    start(async () => {
      const result = await createFormFlowFromTemplate({ formId: form.id, template: key, tagName: key === "add_tag" ? tagName : undefined, questionKey: key === "email_by_answer" ? questionKey : undefined });
      setBusyKey(null);
      if (result.ok) router.push(`/dashboard/formularios/${form.id}/automatizaciones/${result.flowId}`);
      else setMessage({ tone: "error", text: result.error });
    });
  }

  function fromEodTemplate(key: EodTemplateKey) {
    setMessage(null);
    setBusyKey(key);
    start(async () => {
      const result = await createEodFlowFromTemplate({ formId: form.id, template: key });
      setBusyKey(null);
      if (result.ok) router.push(`/dashboard/formularios/${form.id}/automatizaciones/${result.flowId}`);
      else setMessage({ tone: "error", text: result.error });
    });
  }

  function toggle(flowId: string, enabled: boolean) {
    setMessage(null);
    const before = flows;
    setFlows((list) => list.map((f) => (f.id === flowId ? { ...f, enabled } : f)));
    start(async () => {
      const result = await toggleFormFlow({ flowId, enabled });
      if (!result.ok) {
        setFlows(before);
        setMessage({ tone: "error", text: result.error });
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="mx-auto max-w-[900px] space-y-4">
      {!extras.canFlows && <Notice tone="info">Para crear o prender flows hace falta el permiso de editar automatizaciones.</Notice>}
      {message && (
        <div role={message.tone === "error" ? "alert" : "status"}>
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}

      <Section
        title={isEod ? "Flows de este reporte" : "Flows de este formulario"}
        description={
          isEod
            ? "Lo que pasa solo cuando alguien envía su reporte. Son sobre la persona del equipo, no sobre un contacto: mandan emails y avisos, nunca mensajes por chat."
            : "Lo que pasa solo cuando alguien responde. Solo corren si la respuesta tiene un contacto (con email o teléfono)."
        }
      >
        {flows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Todavía no hay flows. Creá uno desde cero o empezá con una plantilla.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {flows.map((flow) => (
              <li key={flow.id} className="flex items-center gap-3 p-3">
                <Workflow className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <Link href={`/dashboard/formularios/${form.id}/automatizaciones/${flow.id}`} className="block truncate text-sm font-medium hover:underline">
                    {flow.name}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground" title={flow.describe}>
                    {flow.summary}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">{flow.enabled ? "Encendida" : "Apagada"}</span>
                <Switch checked={flow.enabled} disabled={!canEdit || pending} label={`${flow.enabled ? "Apagar" : "Encender"} ${flow.name}`} onChange={(next) => toggle(flow.id, next)} />
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={create}
            disabled={pending}
            className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-60"
          >
            {busyKey === "new" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
            Nuevo flow
          </button>
        )}
      </Section>

      {canEdit && isEod && (
        <Section title="Plantillas de un clic" description="Cada flow nace apagado: lo revisás y lo encendés cuando quieras.">
          <div className="grid gap-3 sm:grid-cols-2">
            {EOD_FLOW_TEMPLATES.map((t) => (
              <div key={t.key} className="flex flex-col justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium">{t.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t.describe}</p>
                </div>
                <button
                  type="button"
                  onClick={() => fromEodTemplate(t.key)}
                  disabled={pending}
                  className="mt-3 inline-flex h-8 items-center justify-center gap-1.5 self-start rounded-lg border border-border px-3 text-xs hover:bg-accent disabled:opacity-50"
                >
                  {busyKey === t.key && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                  Usar esta plantilla
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      {canEdit && !isEod && (
        <Section title="Plantillas de un clic" description="Cada flow nace apagado: lo revisás y lo encendés cuando quieras.">
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.map((t) => (
              <div key={t.key} className="flex flex-col justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium">{t.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t.describe}</p>
                  {t.needsTag && (
                    <div className="mt-2">
                      <label htmlFor={`tpl-${t.key}-tag`} className="sr-only">
                        Tag a poner
                      </label>
                      <select id={`tpl-${t.key}-tag`} className={inputClass} value={tagName} onChange={(e) => setTagName(e.target.value)}>
                        <option value="">Elegí un tag…</option>
                        {extras.tags.map((tag) => (
                          <option key={tag.id} value={tag.name}>
                            {tag.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {t.needsQuestion && (
                    <div className="mt-2">
                      {questions.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Este formulario todavía no tiene preguntas de selección única o de número. Sumá una para usar esta plantilla.</p>
                      ) : (
                        <>
                          <label htmlFor={`tpl-${t.key}-question`} className="sr-only">
                            Pregunta que reparte los caminos
                          </label>
                          <select id={`tpl-${t.key}-question`} className={inputClass} value={questionKey} onChange={(e) => setQuestionKey(e.target.value)}>
                            <option value="">Elegí una pregunta…</option>
                            {questions.map((q) => (
                              <option key={q.key} value={q.key}>
                                {q.label}
                              </option>
                            ))}
                          </select>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Con una selección, un camino por cada una de las dos primeras opciones. Con un número, dos umbrales de partida que después editás en el flujo.
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => fromTemplate(t.key)}
                  disabled={pending || (t.needsTag && !tagName) || (t.needsQuestion && !questionKey)}
                  className="mt-3 inline-flex h-8 items-center justify-center gap-1.5 self-start rounded-lg border border-border px-3 text-xs hover:bg-accent disabled:opacity-50"
                >
                  {busyKey === t.key && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                  Usar esta plantilla
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      <p className="text-xs text-muted-foreground">
        También las ves en <Link href="/dashboard/flows" className="underline">Automatizaciones</Link>, donde se pueden abrir en el canvas.
      </p>
    </div>
  );
}
