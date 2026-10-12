"use client";

/**
 * "Probar condiciones": mira por que camino iria cada paso Condiciones con la
 * respuesta real de alguien o con datos cargados a mano. NO ejecuta nada: no
 * manda emails ni mensajes, no crea sesiones ni deja nada en el historial. La
 * cuenta la hace `explainPaths` en el navegador sobre el arbol que esta en
 * pantalla (con los cambios sin guardar); el servidor solo lee las respuestas.
 *
 * Todo lo que decide algo vive en `lib/automations/`; esto compone.
 */

import { useEffect, useMemo, useState } from "react";
import { FlaskConical } from "lucide-react";
import { Notice, inputClass } from "@/components/agents/fields";
import { ExplanationView } from "@/components/automations/explanation-view";
import { Sheet } from "@/components/ui/sheet";
import type { ConditionCatalogInputs } from "@/lib/automations/condition-catalog-inputs";
import { explainPaths, type TestValues } from "@/lib/automations/explain-paths";
import type { StepTree } from "@/lib/automations/step-tree";
import { fieldsOfTree, manualFields, manualValuesFrom, type ManualInputs } from "@/lib/automations/test-values";
import type { ConditionFieldSpec } from "@/lib/flow-engine/condition-eval";

/** Lo que una pantalla aporta para probar con una respuesta REAL (hoy, Formularios). */
export interface TestResponsesSource {
  list: (input: { flowId: string }) => Promise<{ ok: true; formName: string; responses: Array<{ id: string; label: string }> } | { ok: false; error: string }>;
  load: (input: { flowId: string; submissionId: string }) => Promise<{ ok: true; values: TestValues } | { ok: false; error: string }>;
}

type Mode = "real" | "manual";

function ManualField({ field, value, onChange }: { field: ConditionFieldSpec; value: string | string[] | undefined; onChange: (next: string | string[]) => void }) {
  const id = `probar-${field.path}`;
  switch (field.type) {
    case "single_select":
      return (
        <select id={id} className={inputClass} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">(sin responder)</option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "multi_select": {
      const chosen = Array.isArray(value) ? value : [];
      return (
        <div id={id} role="group" aria-label={field.label} className="space-y-1">
          {(field.options ?? []).map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={chosen.includes(o.value)}
                onChange={(e) => onChange(e.target.checked ? [...chosen, o.value] : chosen.filter((v) => v !== o.value))}
                className="h-4 w-4"
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    }
    case "boolean":
      return (
        <select id={id} className={inputClass} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">(sin responder)</option>
          <option value="true">Sí</option>
          <option value="false">No</option>
        </select>
      );
    case "number":
      return <input id={id} type="number" inputMode="decimal" className={inputClass} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />;
    case "date":
      return <input id={id} type="date" className={inputClass} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <input id={id} type="text" className={inputClass} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />;
  }
}

function TestPanel({ flowId, tree, catalog, source }: { flowId: string; tree: StepTree; catalog: ConditionCatalogInputs | null; source?: TestResponsesSource }) {
  const [mode, setMode] = useState<Mode>(source ? "real" : "manual");
  const [responses, setResponses] = useState<Array<{ id: string; label: string }> | null>(null);
  const [selected, setSelected] = useState("");
  const [realValues, setRealValues] = useState<TestValues | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState<ManualInputs>({});

  const fields = useMemo(() => fieldsOfTree(tree, catalog), [tree, catalog]);
  const formFields = useMemo(() => manualFields(catalog?.triggerSchema ?? []), [catalog]);

  // Las ultimas respuestas, una vez al abrir.
  useEffect(() => {
    if (!source) return;
    let alive = true;
    source
      .list({ flowId })
      .then((result) => {
        if (!alive) return;
        if (result.ok) setResponses(result.responses);
        else setError(result.error);
      })
      .catch(() => {
        if (alive) setError("No pude cargar las respuestas. Probá de nuevo.");
      });
    return () => {
      alive = false;
    };
  }, [flowId, source]);

  function choose(id: string) {
    setSelected(id);
    setRealValues(null);
    setError(null);
    if (!id || !source) return;
    setLoading(true);
    source
      .load({ flowId, submissionId: id })
      .then((result) => {
        if (result.ok) setRealValues(result.values);
        else setError(result.error);
      })
      .catch(() => setError("No pude leer esa respuesta. Probá de nuevo."))
      .finally(() => setLoading(false));
  }

  const values: TestValues | null = mode === "real" ? realValues : manualValuesFrom(formFields, inputs);
  const explanation = useMemo(() => (values ? explainPaths(tree, values, fields) : null), [tree, values, fields]);

  return (
    <div className="space-y-4 p-4">
      <p className="text-xs text-muted-foreground">
        Mirá por qué camino iría cada paso Condiciones. Es solo una cuenta: no se manda nada ni se guarda nada en el historial de nadie.
      </p>

      {source && (
        <div role="tablist" aria-label="Con qué datos probar" className="flex gap-1 rounded-lg bg-muted p-1 text-xs">
          {(
            [
              ["real", "Una respuesta real"],
              ["manual", "Cargar a mano"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode === key}
              onClick={() => setMode(key)}
              className={`flex-1 rounded-md px-2 py-1.5 font-medium ${mode === key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      {mode === "real" && source && (
        <div>
          <label htmlFor="probar-respuesta" className="block text-xs font-semibold">
            Respuesta
          </label>
          {responses === null && !error ? (
            <p className="mt-1 text-xs text-muted-foreground">Cargando respuestas…</p>
          ) : responses && responses.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">Todavía no hay respuestas que puedas ver. Probá cargando los datos a mano.</p>
          ) : (
            <select id="probar-respuesta" className={`${inputClass} mt-1`} value={selected} onChange={(e) => choose(e.target.value)}>
              <option value="">Elegí una de las últimas respuestas…</option>
              {(responses ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          )}
          {loading && <p className="mt-1 text-xs text-muted-foreground">Leyendo la respuesta…</p>}
        </div>
      )}

      {mode === "manual" &&
        (formFields.length === 0 ? (
          <Notice tone="info">Este disparador todavía no tiene datos para cargar. Si la condición mira algo del contacto o de un paso anterior, en la prueba figura «sin dato».</Notice>
        ) : (
          <div className="space-y-3">
            {formFields.map((field) => (
              <div key={field.path}>
                <label htmlFor={`probar-${field.path}`} className="block text-xs font-semibold">
                  {field.label}
                </label>
                <div className="mt-1">
                  <ManualField field={field} value={inputs[field.path]} onChange={(next) => setInputs((current) => ({ ...current, [field.path]: next }))} />
                </div>
              </div>
            ))}
          </div>
        ))}

      {explanation && (
        <div aria-live="polite">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Resultado</h3>
          <ExplanationView explanation={explanation} />
          <p className="mt-3 text-[11px] text-muted-foreground">
            Lo que mira un paso anterior, el contacto o una venta figura «sin dato en la prueba» y no se cumple: acá no hay de dónde leerlo.
          </p>
        </div>
      )}
    </div>
  );
}

export function TestConditionsButton({
  flowId,
  tree,
  catalog,
  source,
  disabled,
}: {
  flowId: string;
  tree: StepTree;
  catalog: ConditionCatalogInputs | null;
  source?: TestResponsesSource;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-60"
      >
        <FlaskConical className="h-4 w-4" aria-hidden /> Probar condiciones
      </button>
      {open && (
        <Sheet title="Probar condiciones" onClose={() => setOpen(false)}>
          <TestPanel flowId={flowId} tree={tree} catalog={catalog} source={source} />
        </Sheet>
      )}
    </>
  );
}
