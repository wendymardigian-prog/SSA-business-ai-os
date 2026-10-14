"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Checkbox, Field, Notice, Section, inputClass } from "@/components/agents/fields";
import { saveSurveyConfig } from "@/lib/actions/forms/config";
import { SURVEY_CATEGORIES, SURVEY_CATEGORY_LABELS, scoreCandidates, type SurveyCategory, type SurveyConfig } from "@/lib/forms/survey";
import type { ContactMode } from "@/lib/forms/contact-config";
import type { FormField } from "@/lib/forms/fields";

/**
 * La configuración de la encuesta (F22): qué campo lleva el puntaje, la categoría y "una vez por
 * contacto". Se guarda con su propio botón: vale desde que se guarda, no por versión.
 *
 * Plano formularios-ui (diferencia 7): ya no es una pestaña del editor sino las tarjetas de arriba de la ruta
 * `/encuesta`, encima del panel de NPS. Recibe lo mínimo (no el formulario entero) para poder vivir ahí.
 */
export function SurveyTab({
  formId,
  archived,
  contactMode,
  fields,
  config,
  onSaved,
  canManage,
}: {
  formId: string;
  archived: boolean;
  contactMode: ContactMode;
  /** Los campos del borrador: de ahí salen los candidatos a llevar el puntaje. */
  fields: FormField[];
  config: SurveyConfig | null;
  onSaved: (config: SurveyConfig) => void;
  canManage: boolean;
}) {
  const router = useRouter();
  const candidates = useMemo(() => scoreCandidates(fields), [fields]);
  const [scoreFieldKey, setScoreFieldKey] = useState(config?.scoreFieldKey ?? candidates[0]?.key ?? "");
  const [category, setCategory] = useState<SurveyCategory>(config?.category ?? "servicio");
  const [oncePerContact, setOncePerContact] = useState(config?.oncePerContact ?? false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [saving, start] = useTransition();

  const disabled = !canManage || archived;
  const known = candidates.some((c) => c.key === scoreFieldKey);

  function save() {
    setMessage(null);
    start(async () => {
      const next: SurveyConfig = { scoreFieldKey, category, oncePerContact };
      const result = await saveSurveyConfig({ formId, config: next });
      if (result.ok) {
        onSaved(next);
        setMessage({ tone: "success", text: "Guardado" });
        router.refresh();
      } else {
        setMessage({ tone: "error", text: result.error });
      }
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {candidates.length === 0 && (
        <Notice tone="warning">Para publicar la encuesta hace falta un campo de estrellas o de NPS obligatorio. Sumalo en la pestaña Campos.</Notice>
      )}

      <Section title="El puntaje" description="El campo cuyo valor cuenta para el NPS o el promedio. Tiene que ser de estrellas o de NPS, y obligatorio.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Campo del puntaje">
            {(id) => (
              <select id={id} className={inputClass} disabled={disabled || candidates.length === 0} value={scoreFieldKey} onChange={(e) => setScoreFieldKey(e.target.value)}>
                {!known && scoreFieldKey && <option value={scoreFieldKey}>{scoreFieldKey} (ya no es válido)</option>}
                {candidates.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label || c.key}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Categoría" hint="Sirve para filtrar y para las automatizaciones.">
            {(id) => (
              <select id={id} className={inputClass} disabled={disabled} value={category} onChange={(e) => setCategory(e.target.value as SurveyCategory)}>
                {SURVEY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {SURVEY_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">NPS: 9 y 10 son promotores, 7 y 8 pasivos y de 0 a 6 detractores. Con estrellas se calcula el promedio.</p>
      </Section>

      <Section title="Una vez por contacto" description="Con el link firmado de cada persona, cada contacto responde una sola vez.">
        <Checkbox
          checked={oncePerContact}
          onChange={setOncePerContact}
          disabled={contactMode === "none" && !oncePerContact}
          label="Cada contacto responde una sola vez"
          description={contactMode === "none" ? "No disponible: las respuestas de este formulario no se vinculan con contactos. Prendé el vínculo en la pestaña Contacto. " : "Quien ya respondió ve “Ya respondiste, ¡gracias!”. Las respuestas anónimas (sin email ni link) no se pueden limitar. Una respuesta marcada como spam no cuenta: esa persona puede responder de nuevo."}
        />
      </Section>

      {message && (
        <div role="status">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {canManage && (
          <button
            type="button"
            onClick={save}
            disabled={disabled || saving || !known}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Guardar
          </button>
        )}
      </div>
    </div>
  );
}
