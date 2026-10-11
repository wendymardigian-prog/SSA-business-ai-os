"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { ContentDialog, DialogField, fieldInput } from "@/components/content/dialog";
import { saveCallSections } from "@/lib/actions/calls-edit";
import { SECTION_LABELS, type AnalysisSection } from "@/lib/calls/scoring";
import { SECTION_FORMS, blankItem, cleanFormValue, type FieldSpec } from "@/lib/calls/section-forms";
import { validateSectionValue } from "@/lib/calls/section-edit";
import type { CategoryGroup } from "@/lib/calls/rubric";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Las categorias aceptadas por grupo, para sugerirlas mientras se escribe. */
export type CategorySuggestions = Partial<Record<CategoryGroup, Array<{ clave: string; nombre: string }>>>;

/**
 * Corregir a mano una seccion del analisis (F23). Lo que se guarda va a
 * `analysis`; lo que dijo la IA (`analysis_ai`) no se toca. Los puntajes se
 * recalculan solos con la rubrica con la que se analizo la llamada.
 */
export function SectionEditor({
  callId,
  section,
  value,
  suggestions,
  onClose,
}: {
  callId: string;
  section: AnalysisSection;
  value: unknown;
  suggestions: CategorySuggestions;
  onClose: () => void;
}) {
  const router = useRouter();
  const form = SECTION_FORMS[section];
  const [draft, setDraft] = useState<unknown>(() => structuredClone(value ?? (form.kind === "text" ? "" : form.kind === "object" ? {} : [])));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const cleaned = cleanFormValue(section, draft);
  const problem = validateSectionValue(section, cleaned);

  function save() {
    setError(null);
    start(async () => {
      const result = await saveCallSections({ callId, edits: [{ section, value: cleaned }], origin: "manual" });
      if (!result.ok) return setError(result.error);
      router.refresh();
      onClose();
    });
  }

  const setItem = (index: number, key: string, v: unknown) =>
    setDraft((cur: unknown) => (Array.isArray(cur) ? cur.map((item, i) => (i === index && isObj(item) ? { ...item, [key]: v } : item)) : cur));

  return (
    <ContentDialog
      title={`Editar: ${SECTION_LABELS[section]}`}
      label={`Editar ${SECTION_LABELS[section]}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={save} disabled={pending || !!problem} title={problem ?? undefined} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {pending ? "Guardando…" : "Guardar"}
          </button>
          <button type="button" onClick={onClose} disabled={pending} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent">Cancelar</button>
          {problem && <span className="text-xs text-amber-800 dark:text-amber-300">{problem}</span>}
          {error && <span role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</span>}
        </>
      }
    >
      <p className="text-xs text-muted-foreground">Lo que escribas queda como corrección tuya. Lo que dijo la IA se conserva y se puede ver aparte. Los puntajes se recalculan solos.</p>

      {form.kind === "text" && (
        <DialogField label={SECTION_LABELS[section]}>
          <textarea value={typeof draft === "string" ? draft : ""} onChange={(e) => setDraft(e.target.value)} rows={8} className={`${fieldInput} resize-y`} />
        </DialogField>
      )}

      {form.kind === "object" &&
        form.fields.map((f) => (
          <Field key={f.key} spec={f} value={isObj(draft) ? draft[f.key] : undefined} suggestions={suggestions} onChange={(v) => setDraft({ ...(isObj(draft) ? draft : {}), [f.key]: v })} />
        ))}

      {form.kind === "strings" && (
        <div className="space-y-2">
          {(Array.isArray(draft) ? draft : []).map((text, i) => (
            <div key={i} className="flex gap-2">
              <textarea aria-label={`Punto ${i + 1}`} value={String(text ?? "")} rows={2} onChange={(e) => setDraft((Array.isArray(draft) ? draft : []).map((t, j) => (j === i ? e.target.value : t)))} className={`${fieldInput} resize-y`} />
              <button type="button" aria-label={`Sacar el punto ${i + 1}`} onClick={() => setDraft((Array.isArray(draft) ? draft : []).filter((_, j) => j !== i))} className="self-start rounded-md p-2 text-red-700 hover:bg-accent"><Trash2 className="h-4 w-4" aria-hidden /></button>
            </div>
          ))}
          <button type="button" onClick={() => setDraft([...(Array.isArray(draft) ? draft : []), ""])} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"><Plus className="h-3.5 w-3.5" aria-hidden /> Agregar</button>
        </div>
      )}

      {form.kind === "list" && (
        <div className="space-y-3">
          {(Array.isArray(draft) ? draft : []).map((item, i) => (
            <fieldset key={i} className="space-y-2 rounded-lg border border-border p-3">
              <legend className="px-1 text-xs font-semibold">{form.labelKey && isObj(item) && item[form.labelKey] ? String(item[form.labelKey]) : `Mejora ${i + 1}`}</legend>
              {form.fields.map((f) => (
                <Field key={f.key} spec={f} value={isObj(item) ? item[f.key] : undefined} suggestions={suggestions} onChange={(v) => setItem(i, f.key, v)} />
              ))}
              {!form.fixedBy && (
                <button type="button" onClick={() => setDraft((Array.isArray(draft) ? draft : []).filter((_, j) => j !== i))} className="inline-flex items-center gap-1 text-xs text-red-700 hover:underline"><Trash2 className="h-3.5 w-3.5" aria-hidden /> Sacar</button>
              )}
            </fieldset>
          ))}
          {!form.fixedBy && (
            <button type="button" onClick={() => setDraft([...(Array.isArray(draft) ? draft : []), blankItem(section)])} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"><Plus className="h-3.5 w-3.5" aria-hidden /> Agregar</button>
          )}
        </div>
      )}
    </ContentDialog>
  );
}

function Field({ spec, value, suggestions, onChange }: { spec: FieldSpec; value: unknown; suggestions: CategorySuggestions; onChange: (v: unknown) => void }) {
  if (spec.kind === "bool") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
        {spec.label}
      </label>
    );
  }
  if (spec.kind === "select") {
    return (
      <DialogField label={spec.label}>
        <select value={value === undefined || value === null ? "" : String(value)} onChange={(e) => onChange(e.target.value)} className={fieldInput}>
          <option value="">—</option>
          {spec.options?.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </DialogField>
    );
  }
  const listId = spec.suggestFrom ? `sug-${spec.suggestFrom}` : undefined;
  return (
    <DialogField label={spec.label}>
      {spec.kind === "textarea" ? (
        <textarea value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} rows={3} className={`${fieldInput} resize-y`} />
      ) : (
        <>
          <input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} list={listId} className={fieldInput} />
          {spec.suggestFrom && (
            <datalist id={listId}>
              {(suggestions[spec.suggestFrom] ?? []).map((c) => (
                <option key={c.clave} value={c.clave}>{c.nombre}</option>
              ))}
            </datalist>
          )}
        </>
      )}
    </DialogField>
  );
}
