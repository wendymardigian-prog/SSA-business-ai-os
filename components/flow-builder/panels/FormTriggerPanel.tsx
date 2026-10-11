"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { FormField, FormType } from "@/lib/forms/fields";
import { conditionSources } from "@/lib/forms/builder";
import { commonFields } from "@/lib/forms/automation/trigger-config";
import { SURVEY_CATEGORIES, SURVEY_CATEGORY_LABELS } from "@/lib/forms/survey-categories";
import type { VisibilityConfig } from "@/lib/forms/visibility-types";
import { VisibilityRuleBuilder } from "@/components/forms/builder/visibility-rule-builder";

/**
 * La configuración de los tres triggers de Formularios (F19) dentro del panel del
 * constructor de flujos: qué formularios (vacío = cualquiera), el puntaje y la
 * categoría de una encuesta, y las condiciones sobre las respuestas.
 *
 * Los formularios se leen del lado del navegador con la sesión (la RLS decide
 * cuáles ve cada quien), igual que `EnrollSequencePanel` con las secuencias. Las
 * condiciones se arman con los campos de la versión VIGENTE de los formularios
 * elegidos; con varios, solo los que tienen la misma clave y tipo en todos.
 */

const TYPE_FOR_TRIGGER: Record<string, FormType> = {
  form_submitted: "custom",
  survey_answered: "survey",
  contract_signed: "contract",
};

const NOUN: Record<string, string> = {
  form_submitted: "formularios",
  survey_answered: "encuestas",
  contract_signed: "contratos",
};

const NPS_OPTIONS = [
  { value: "promoter", label: "Promotores (9-10)" },
  { value: "passive", label: "Pasivos (7-8)" },
  { value: "detractor", label: "Detractores (0-6)" },
];

const SCORE_OPERATORS = [
  { value: "lte", label: "menor o igual a" },
  { value: "gte", label: "mayor o igual a" },
  { value: "eq", label: "igual a" },
];

interface FormOption {
  id: string;
  name: string;
  status: string;
  fields: FormField[];
}

const chip = (on: boolean) =>
  on
    ? "rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-600 dark:text-emerald-300"
    : "rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted";

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function FormTriggerPanel({ triggerType, data, onChange }: { triggerType: string; data: Record<string, unknown>; onChange: (data: Record<string, unknown>) => void }) {
  const [forms, setForms] = useState<FormOption[]>([]);
  const [loading, setLoading] = useState(true);
  const formType = TYPE_FOR_TRIGGER[triggerType] ?? "custom";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const { data: rows } = await supabase
        .from("forms")
        .select("id, name, status, current_version_id")
        .eq("type", formType)
        .neq("status", "archived")
        .order("name", { ascending: true });
      const withVersion = (rows ?? []).filter((r) => r.current_version_id);
      const versionIds = withVersion.map((r) => r.current_version_id as string);
      const { data: versions } = versionIds.length > 0 ? await supabase.from("form_versions").select("id, definition").in("id", versionIds) : { data: [] };
      const byVersion = new Map((versions ?? []).map((v) => [v.id, v.definition as { fields?: FormField[] } | null]));
      if (cancelled) return;
      setForms(
        (rows ?? []).map((r) => ({
          id: r.id,
          name: r.name,
          status: r.status,
          fields: (r.current_version_id ? byVersion.get(r.current_version_id)?.fields : null) ?? [],
        })),
      );
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [formType]);

  const selectedIds = useMemo(() => ((data.form_ids as string[] | undefined) ?? []).filter(Boolean), [data.form_ids]);
  const selectedForms = useMemo(() => forms.filter((f) => selectedIds.includes(f.id)), [forms, selectedIds]);
  const common = useMemo(() => commonFields(selectedForms.map((f) => ({ id: f.id, fields: f.fields }))), [selectedForms]);
  const sources = useMemo(() => conditionSources(common, common.length), [common]);

  const score = data.score as { operator: string; value: number } | null | undefined;
  const npsCategories = (data.nps_categories as string[] | undefined) ?? [];
  const surveyCategories = (data.survey_categories as string[] | undefined) ?? [];

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-2 block text-xs font-semibold text-foreground">Solo estos {NOUN[triggerType] ?? "formularios"}</label>
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Cargando…
          </div>
        ) : forms.length === 0 ? (
          <p className="text-xs text-muted-foreground">Todavía no hay {NOUN[triggerType]}. El trigger va a valer para cualquiera que se cree.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {forms.map((f) => (
              <button key={f.id} type="button" aria-pressed={selectedIds.includes(f.id)} onClick={() => onChange({ ...data, form_ids: toggle(selectedIds, f.id) })} className={chip(selectedIds.includes(f.id))}>
                {f.name}
                {f.status !== "published" ? " (sin publicar)" : ""}
              </button>
            ))}
          </div>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground/60">Sin elegir ninguno, vale para cualquiera.</p>
      </div>

      {triggerType === "survey_answered" && (
        <>
          <div>
            <label className="mb-2 block text-xs font-semibold text-foreground">Solo estos puntajes de NPS</label>
            <div className="flex flex-wrap gap-2">
              {NPS_OPTIONS.map((o) => (
                <button key={o.value} type="button" aria-pressed={npsCategories.includes(o.value)} onClick={() => onChange({ ...data, nps_categories: toggle(npsCategories, o.value) })} className={chip(npsCategories.includes(o.value))}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-semibold text-foreground">Solo estas categorías de encuesta</label>
            <div className="flex flex-wrap gap-2">
              {SURVEY_CATEGORIES.map((c) => (
                <button key={c} type="button" aria-pressed={surveyCategories.includes(c)} onClick={() => onChange({ ...data, survey_categories: toggle(surveyCategories, c) })} className={chip(surveyCategories.includes(c))}>
                  {SURVEY_CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="form-trigger-score" className="mb-2 block text-xs font-semibold text-foreground">
              Solo si el puntaje es…
            </label>
            <div className="flex gap-2">
              <select
                id="form-trigger-score"
                value={score?.operator ?? ""}
                onChange={(e) => onChange({ ...data, score: e.target.value ? { operator: e.target.value, value: score?.value ?? 0 } : null })}
                className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="">Cualquiera</option>
                {SCORE_OPERATORS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {score && (
                <input
                  type="number"
                  aria-label="Valor del puntaje"
                  value={Number.isFinite(score.value) ? score.value : 0}
                  onChange={(e) => onChange({ ...data, score: { operator: score.operator, value: Number(e.target.value) } })}
                  className="w-24 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              )}
            </div>
          </div>
        </>
      )}

      {triggerType !== "contract_signed" && (
        <fieldset className="space-y-2 rounded-lg border border-border p-3">
          <legend className="px-1 text-xs font-semibold text-foreground">Solo si las respuestas cumplen…</legend>
          {selectedForms.length === 0 ? (
            <p className="text-xs text-muted-foreground">Elegí un formulario para armar condiciones sobre sus campos.</p>
          ) : (
            <>
              <VisibilityRuleBuilder
                value={data.answer_conditions as VisibilityConfig | undefined}
                onChange={(next) => onChange({ ...data, answer_conditions: next ?? null })}
                sources={sources}
                emptyHint="Sin condiciones: vale para cualquier respuesta."
              />
              {selectedForms.length > 1 && <p className="text-[11px] text-muted-foreground/60">Con varios formularios, solo se ofrecen los campos que se llaman igual y son del mismo tipo en todos.</p>}
            </>
          )}
        </fieldset>
      )}

      <p className="text-[11px] text-muted-foreground/60">
        Las variables {"{{form.name}}"}, {"{{answer.<campo>}}"}, {"{{submission.url}}"}
        {triggerType === "survey_answered" ? ", {{submission.score}} y {{submission.nps_category}}" : ""} quedan disponibles para los mensajes. Solo dispara si la respuesta tiene contacto (con email o teléfono).
      </p>
    </div>
  );
}
