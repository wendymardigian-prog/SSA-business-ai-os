// @plantilla-quitar(servicios)
"use client";

import { useMemo, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { setModuleOverride } from "@/lib/actions/program";
import { overrideFormOf, overrideRuleFromForm, targetsForModule, type ModuleTargetOptions, type OverrideForm } from "@/lib/program/module-override";
import { unlockRuleProblems, type UnlockRule } from "@/lib/program/unlock";
import { ActionError } from "@/components/contacts/ui";
import { ContentDialog, DialogField, fieldInput } from "@/components/content/dialog";

/**
 * «Programar…» un módulo para UNA persona (00504): una regla propia que reemplaza a la del programa solo para ella.
 * Mismas opciones que el editor del programa, sin «abierto», «lo abre un paso» ni «lo abre una automatización».
 */
export function ModuleOverrideDialog({
  serviceId,
  moduleId,
  moduleTitle,
  current,
  targets,
  onClose,
  onSaved,
}: {
  serviceId: string;
  moduleId: string;
  moduleTitle: string;
  current: UnlockRule | null;
  targets: ModuleTargetOptions | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<OverrideForm>(() => overrideFormOf(current));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const opts = useMemo(() => (targets ? targetsForModule(targets, moduleId) : { journey: [], program: [] }), [targets, moduleId]);
  const set = (patch: Partial<OverrideForm>) => setForm((f) => ({ ...f, ...patch }));
  const rule = overrideRuleFromForm(form);
  const problems = unlockRuleProblems(rule);

  function save() {
    setError(null);
    if (problems.length) {
      setError(problems[0].charAt(0).toUpperCase() + problems[0].slice(1));
      return;
    }
    start(async () => {
      const r = await setModuleOverride(serviceId, moduleId, "rule", rule);
      if (!r.ok) setError(r.error.message);
      else onSaved();
    });
  }

  const comingSoon = form.display === "coming_soon" || (form.type === "fixed_date" && !form.display);
  return (
    <ContentDialog
      title="Programar el módulo"
      label={`Programar ${moduleTitle}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="h-10 rounded-lg border border-border px-3 text-sm hover:bg-accent sm:h-9">
            Volver
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={save}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 sm:h-9"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Guardar
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{moduleTitle}</span>: esta regla vale solo para este cliente y reemplaza a la del programa. Si tiene
          otro servicio del mismo programa, vale también ahí.
        </p>
        <DialogField label="Cuándo se abre">
          <select className={fieldInput} value={form.type} onChange={(e) => set({ type: e.target.value })}>
            <option value="fixed_date">En una fecha</option>
            <option value="days_after_start">N días después de empezar</option>
            <option value="after_complete">Al completar algo</option>
            <option value="challenge_started">Al empezar el Reto</option>
          </select>
        </DialogField>
        {form.type === "fixed_date" && (
          <DialogField label="Fecha">
            <input type="date" className={fieldInput} value={form.date} onChange={(e) => set({ date: e.target.value })} />
          </DialogField>
        )}
        {form.type === "days_after_start" && (
          <DialogField label="Días" hint="Desde que empezó su acceso al programa.">
            <input type="number" min={0} max={3650} inputMode="numeric" className={fieldInput} value={form.days} onChange={(e) => set({ days: e.target.value })} />
          </DialogField>
        )}
        {form.type === "after_complete" && (
          <DialogField label="Qué hay que completar">
            <select className={fieldInput} value={form.target} onChange={(e) => set({ target: e.target.value })}>
              <option value="">Elegí…</option>
              {form.target && ![...opts.journey, ...opts.program].some((o) => o.value === form.target) && <option value={form.target}>Lo que estaba elegido ya no está</option>}
              {opts.journey.length > 0 && (
                <optgroup label="Un paso del camino">
                  {opts.journey.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              )}
              {opts.program.length > 0 && (
                <optgroup label="Una clase o un módulo">
                  {opts.program.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </DialogField>
        )}
        <DialogField label="Mientras está bloqueado se ve">
          <select className={fieldInput} value={form.display} onChange={(e) => set({ display: e.target.value })}>
            <option value="">{form.type === "fixed_date" ? "Próximamente (por defecto)" : "Con candado (por defecto)"}</option>
            <option value="locked">Con candado</option>
            <option value="coming_soon">Próximamente</option>
            <option value="hidden">Oculto</option>
          </select>
        </DialogField>
        {form.display !== "hidden" && (
          <DialogField label="Texto que ve el estudiante (opcional)" hint={comingSoon ? "Si lo dejás vacío, muestra la fecha." : "Si lo dejás vacío, el sistema arma uno."}>
            <input className={fieldInput} maxLength={80} value={form.text} onChange={(e) => set({ text: e.target.value })} />
          </DialogField>
        )}
        {error && <ActionError message={error} />}
      </div>
    </ContentDialog>
  );
}
