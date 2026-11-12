// @plantilla-quitar(servicios)
"use client";

/**
 * «Se puede completar desde», «Pide evidencia» y el checklist de un paso del camino (Servicios A4, F146 a F148).
 * Las reglas viven en `lib/services/screens/step-rules.ts`; acá solo se componen. Todo se guarda dentro de `ref`.
 */
import { Plus, X } from "lucide-react";
import type { JourneyItem } from "@/lib/services/journey-template";
import { CHECKLIST_MAX_ITEMS } from "@/lib/services/journey-template";
import type { EvidenceKind } from "@/lib/services/evidence";
import {
  LOCK_FROM_LABEL,
  canAskEvidence,
  canHaveChecklist,
  checklistForm,
  evidenceForm,
  lockForm,
  withChecklist,
  withEvidence,
  withLock,
  type LockForm,
} from "@/lib/services/screens/step-rules";

const label = "mb-1 block text-xs font-medium text-muted-foreground";
const input = "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm";

const EVIDENCE_LABEL: Record<EvidenceKind, string> = { file: "Una captura o un archivo", link: "Un link", note: "Una nota" };

export function StepRulesSection({ item, before, onRef }: { item: JourneyItem; before: JourneyItem[]; onRef: (ref: Record<string, unknown>) => void }) {
  const ref = (item.ref ?? {}) as Record<string, unknown>;
  const lock = lockForm(ref);
  const ev = evidenceForm(ref);
  const points = checklistForm(ref);
  const setLock = (patch: Partial<LockForm>) => onRef(withLock(ref, { ...lock, ...patch }));

  return (
    <>
      <fieldset className="space-y-2">
        <legend className={label}>Se puede completar desde</legend>
        <select
          aria-label="Desde cuándo se puede completar"
          value={lock.mode === "after" ? `item:${lock.afterKey}` : lock.mode === "days" ? `days:${lock.from}` : "any"}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "any") setLock({ mode: "any" });
            else if (v.startsWith("item:")) setLock({ mode: "after", afterKey: v.slice(5) });
            else setLock({ mode: "days", from: v.slice(5) as LockForm["from"] });
          }}
          className={input}
        >
          <option value="any">En cualquier momento</option>
          {(Object.keys(LOCK_FROM_LABEL) as LockForm["from"][]).map((f) => (
            <option key={f} value={`days:${f}`}>
              Unos días después de {LOCK_FROM_LABEL[f]}
            </option>
          ))}
          {before.map((b) => (
            <option key={b.key} value={`item:${b.key}`}>
              Cuando se complete «{b.name}»
            </option>
          ))}
        </select>
        {lock.mode === "days" && (
          <div className="flex items-center gap-2 text-sm">
            <input
              aria-label="Cantidad de días"
              inputMode="numeric"
              value={String(lock.days)}
              onChange={(e) => setLock({ days: Number(e.target.value.replace(/\D/g, "")) || 0 })}
              className={`${input} w-20`}
            />
            <span className="text-muted-foreground">día(s) después de {LOCK_FROM_LABEL[lock.from]}</span>
          </div>
        )}
        {lock.mode !== "any" && <p className="text-xs text-muted-foreground">Antes de eso el paso se ve con un candado y no se puede marcar.</p>}
      </fieldset>

      {canAskEvidence(item.kind) && (
        <fieldset className="space-y-2">
          <legend className={label}>Evidencia</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={ev.required} onChange={(e) => onRef(withEvidence(ref, e.target.checked, ev.kinds))} />
            Pide evidencia para completarlo
          </label>
          {ev.required && (
            <div className="flex flex-wrap gap-3 pl-6">
              {(Object.keys(EVIDENCE_LABEL) as EvidenceKind[]).map((k) => {
                const on = ev.kinds.includes(k);
                return (
                  <label key={k} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => {
                        const next = e.target.checked ? [...ev.kinds, k] : ev.kinds.filter((x) => x !== k);
                        onRef(withEvidence(ref, true, next.length ? next : ev.kinds));
                      }}
                    />
                    {EVIDENCE_LABEL[k]}
                  </label>
                );
              })}
            </div>
          )}
        </fieldset>
      )}

      {canHaveChecklist(item.kind) && (
        <fieldset className="space-y-2">
          <legend className={label}>Checklist</legend>
          {points.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                aria-label={`Punto ${i + 1}`}
                maxLength={200}
                value={p}
                onChange={(e) => onRef({ ...ref, checklist: points.map((x, j) => (j === i ? e.target.value.slice(0, 200) : x)) })}
                onBlur={() => onRef(withChecklist(ref, points))}
                className={input}
              />
              <button type="button" aria-label={`Sacar el punto ${i + 1}`} onClick={() => onRef(withChecklist(ref, points.filter((_, j) => j !== i)))} className="rounded p-1.5 text-muted-foreground hover:bg-accent">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ))}
          {points.length < CHECKLIST_MAX_ITEMS && (
            <button
              type="button"
              onClick={() => onRef({ ...ref, checklist: [...points, "Nuevo punto"] })}
              className="inline-flex items-center gap-1 text-sm text-primary-ink hover:underline"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Agregar un punto
            </button>
          )}
          {points.length > 0 && <p className="text-xs text-muted-foreground">Viaja a la tarea del paso. Hasta {CHECKLIST_MAX_ITEMS} puntos.</p>}
        </fieldset>
      )}
    </>
  );
}
