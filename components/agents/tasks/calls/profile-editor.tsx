"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History } from "lucide-react";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { Notice, inputClass } from "@/components/agents/fields";
import { Switch } from "@/components/ui/switch";
import { archiveCallProfile, restoreCallProfileInstructions, saveCallProfile } from "@/lib/actions/call-profiles";
import type { CallConfigData } from "@/lib/calls/config-data";
import { changeShape, copyFromProfile, formToRules, initialProfileForm, type ProfileForm } from "@/lib/calls/profile-form";
import { PROFILE_SHAPE_LABELS, validateProfileRubric, type CallAnalysisProfile, type ProfileShape } from "@/lib/calls/profiles";
import { cn } from "@/lib/utils";
import { PromptTestPanel } from "./prompt-test-panel";
import { RubricEditor } from "./rubric-editor";

type Data = Extract<CallConfigData, { task: "call_analysis" }>;

export interface ProfileTarget {
  categoryId: string;
  label: string;
}

const activeText = (data: Data, profile: CallAnalysisProfile | null): string | null =>
  profile?.activePromptVersion ? (data.profileVersions[profile.id]?.find((v) => v.version === profile.activePromptVersion)?.instructions ?? null) : null;

/** Editar el analizador de un tipo: formato, cuando corre, rubrica, instrucciones y probar. Un solo boton guarda todo. */
export function ProfileEditor({ data, target, profile, onClose }: { data: Data; target: ProfileTarget; profile: CallAnalysisProfile | null; onClose: () => void }) {
  const router = useRouter();
  const timeZone = useViewerTimezone();
  const readOnly = !data.canEdit;
  const defaultShape: ProfileShape = data.salesCategoryIds.includes(target.categoryId) ? "sales" : "general";
  const [form, setForm] = useState<ProfileForm>(() => initialProfileForm(profile, activeText(data, profile), defaultShape, data.defaultInstructions));
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  // Servicios A4 (F142, F144): nacen apagados.
  const initialProposals = (profile && "profileProposals" in data ? (data as { profileProposals?: Record<string, { enabled: boolean; client_message: boolean }> }).profileProposals?.[profile.id] : undefined) ?? { enabled: false, client_message: false };
  const [proposals, setProposals] = useState(initialProposals);

  const problems = validateProfileRubric(form.rubric, form.shape);
  const patch = (p: Partial<ProfileForm>) => {
    setMessage(null);
    setForm((f) => ({ ...f, ...p }));
  };
  const others = data.profiles.filter((p) => p.id !== profile?.id);
  const labelOf = (categoryId: string) => {
    for (const g of data.categoryGroups) {
      if (g.areaId === categoryId) return g.areaName;
      const t = g.types.find((x) => x.id === categoryId);
      if (t) return `${g.areaName} · ${t.name}`;
    }
    return "Sin nombre";
  };
  const versions = profile ? (data.profileVersions[profile.id] ?? []) : [];
  const testable = data.testableCalls.filter((c) => c.categoryId === target.categoryId || c.areaId === target.categoryId);

  function save() {
    setMessage(null);
    start(async () => {
      const result = await saveCallProfile({
        categoryId: target.categoryId,
        shape: form.shape,
        mode: form.mode,
        rules: formToRules(form),
        rubric: form.rubric,
        autoSummary: form.autoSummary,
        autoMemory: form.autoMemory,
        autoKnowledge: form.autoKnowledge,
        instructions: form.instructions,
        proposals,
      });
      if (!result.ok) return setMessage({ tone: "error", text: result.error });
      setMessage({ tone: "success", text: `Analizador guardado. La rúbrica está en la versión ${result.rubricVersion}.` });
      router.refresh();
    });
  }

  function restore(version: number | null) {
    if (!profile) return;
    start(async () => {
      const result = await restoreCallProfileInstructions({ profileId: profile.id, version });
      if (!result.ok) return setMessage({ tone: "error", text: result.error });
      patch({ instructions: version === null ? data.defaultInstructions[form.shape] : (versions.find((v) => v.version === version)?.instructions ?? form.instructions) });
      router.refresh();
    });
  }

  function archive() {
    if (!profile) return;
    if (!window.confirm(`¿Quitar el analizador de “${target.label}”? Sus grabaciones dejan de analizarse. Lo ya analizado no cambia.`)) return;
    start(async () => {
      const result = await archiveCallProfile({ profileId: profile.id });
      if (!result.ok) return setMessage({ tone: "error", text: result.error });
      router.refresh();
      onClose();
    });
  }

  return (
    <div className="space-y-5 border-t border-border bg-muted/20 p-4">
      {!readOnly && others.length > 0 && (
        <label className="block max-w-sm text-xs font-semibold">
          Copiar de otro tipo
          <select
            value=""
            onChange={(e) => {
              const source = others.find((p) => p.id === e.target.value);
              if (source) setForm((f) => copyFromProfile(f, source, activeText(data, source), data.defaultInstructions));
            }}
            className={cn(inputClass, "mt-1 font-normal")}
          >
            <option value="">Elegir…</option>
            {others.map((p) => (
              <option key={p.id} value={p.id}>{labelOf(p.categoryId)}</option>
            ))}
          </select>
          <span className="mt-1 block font-normal text-muted-foreground">Trae todo menos cuándo corre. No se guarda hasta que aprietes Guardar.</span>
        </label>
      )}

      <fieldset disabled={readOnly} className="space-y-2">
        <legend className="text-xs font-semibold">Qué evalúa</legend>
        {(Object.keys(PROFILE_SHAPE_LABELS) as ProfileShape[]).map((shape) => (
          <label key={shape} className="flex cursor-pointer items-start gap-3">
            <input type="radio" name={`profile-shape-${target.categoryId}`} checked={form.shape === shape} onChange={() => setForm((f) => changeShape(f, shape, data.defaultInstructions))} className="mt-1 h-4 w-4" />
            <span>
              <span className="block text-sm font-medium">{PROFILE_SHAPE_LABELS[shape]}</span>
              <span className="block text-xs text-muted-foreground">
                {shape === "sales" ? "Puntaje de quien vende y del lead, resultado de la venta, objeciones y creencias." : "Resumen, puntaje de quien atendió, alertas y próximos pasos. Sin datos de venta."}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset disabled={readOnly} className="space-y-3">
        <legend className="text-xs font-semibold">Cuándo corre</legend>
        {([["manual", "Con el botón", "Alguien aprieta Analizar en cada grabación."], ["auto", "Automático", "Cada grabación nueva que cumple las reglas se analiza sola. Lo importado del historial nunca corre solo."]] as const).map(([mode, label, desc]) => (
          <label key={mode} className="flex cursor-pointer items-start gap-3">
            <input type="radio" name={`profile-mode-${target.categoryId}`} checked={form.mode === mode} onChange={() => patch({ mode })} className="mt-1 h-4 w-4" />
            <span>
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-xs text-muted-foreground">{desc}</span>
            </span>
          </label>
        ))}
        {form.mode === "auto" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium">
              El nombre contiene
              <input value={form.titleContains} onChange={(e) => patch({ titleContains: e.target.value })} placeholder="demo, diagnóstico" className={cn(inputClass, "mt-1")} />
            </label>
            <label className="block text-xs font-medium">
              El nombre no contiene
              <input value={form.titleExcludes} onChange={(e) => patch({ titleExcludes: e.target.value })} placeholder="interno" className={cn(inputClass, "mt-1")} />
            </label>
            <label className="block text-xs font-medium">
              Duración mínima (minutos)
              <input type="number" min={1} value={form.minDuration} onChange={(e) => patch({ minDuration: e.target.value })} className={cn(inputClass, "mt-1")} />
            </label>
            <label className="block text-xs font-medium">
              Mínimo de personas
              <input type="number" min={1} value={form.minPeople} onChange={(e) => patch({ minPeople: e.target.value })} className={cn(inputClass, "mt-1")} />
            </label>
            <p className="text-[11px] text-muted-foreground sm:col-span-2">Vacío quiere decir sin esa condición. Lo que no cumple queda pendiente y se puede analizar con el botón.</p>
          </div>
        )}
      </fieldset>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold">Después de analizar</h4>
        {([
          ["autoSummary", "Hacer el resumen", "Saca el resumen, los próximos pasos y las ideas de contenido."],
          ["autoMemory", "Actualizar la memoria del contacto", "Lo que aprendió el análisis queda en la ficha del contacto."],
          ["autoKnowledge", "Mandar a Conocimiento", "Queda como documento interno que el agente puede consultar. Nunca una reunión de equipo."],
        ] as const).map(([key, label, desc]) => (
          <div key={key} className="flex items-start gap-3">
            <Switch checked={form[key]} onChange={(v) => patch({ [key]: v })} disabled={readOnly} label={label} />
            <span>
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-xs text-muted-foreground">{desc}</span>
            </span>
          </div>
        ))}
      </div>

      {form.shape === "general" && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold">Propuestas</h4>
          <div className="flex items-start gap-3">
            <Switch checked={proposals.enabled} onChange={(v) => { setMessage(null); setProposals({ enabled: v, client_message: v ? proposals.client_message : false }); }} disabled={readOnly} label="Proponer acciones" />
            <span>
              <span className="block text-sm font-medium">Proponer acciones</span>
              <span className="block text-xs text-muted-foreground">Tareas, completar un paso del servicio y avisos al equipo. Nada se hace solo: una persona aprueba, edita o descarta cada una.</span>
            </span>
          </div>
          <div className="flex items-start gap-3">
            <Switch checked={proposals.client_message} onChange={(v) => { setMessage(null); setProposals({ ...proposals, client_message: v }); }} disabled={readOnly || !proposals.enabled} label="Proponer siempre un mensaje para el cliente" />
            <span>
              <span className="block text-sm font-medium">Proponer siempre un mensaje para el cliente</span>
              <span className="block text-xs text-muted-foreground">Un WhatsApp con el resumen y los próximos pasos, en el tono de las instrucciones. Sale solo cuando alguien lo aprueba.</span>
            </span>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h4 className="text-xs font-semibold">Rúbrica</h4>
        <p className="text-xs text-muted-foreground">Cada análisis guarda la copia de la rúbrica con la que se hizo: cambiarla no altera los puntajes de lo ya analizado.</p>
        <RubricEditor value={form.rubric} shape={form.shape} onChange={(rubric) => patch({ rubric })} readOnly={readOnly} />
      </div>

      <div className="space-y-2">
        <label htmlFor={`profile-instructions-${target.categoryId}`} className="block text-xs font-semibold">Instrucciones</label>
        <textarea id={`profile-instructions-${target.categoryId}`} value={form.instructions} disabled={readOnly} onChange={(e) => patch({ instructions: e.target.value })} rows={8} className={cn(inputClass, "resize-y text-xs")} />
        <p className="text-[11px] text-muted-foreground">Lo técnico (el formato de salida y la rúbrica) se agrega solo y no se edita.</p>
        {!readOnly && profile && (versions.length > 0 || profile.activePromptVersion) && (
          <details className="rounded-lg border border-border">
            <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-xs font-semibold">
              <History className="h-3.5 w-3.5" aria-hidden /> Versiones de las instrucciones
            </summary>
            <ul className="divide-y divide-border border-t border-border">
              {versions.map((v) => (
                <li key={v.version} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                  <span>Versión {v.version} · {new Date(v.createdAt).toLocaleString("es", { timeZone })}{v.version === profile.activePromptVersion ? " · en uso" : ""}</span>
                  {v.version !== profile.activePromptVersion && (
                    <button type="button" disabled={pending} onClick={() => restore(v.version)} className="rounded-md border border-border px-2 py-1 font-medium hover:bg-accent disabled:opacity-50">Volver a esta</button>
                  )}
                </li>
              ))}
              {profile.activePromptVersion && (
                <li className="px-3 py-2 text-xs">
                  <button type="button" disabled={pending} onClick={() => restore(null)} className="rounded-md border border-border px-2 py-1 font-medium hover:bg-accent disabled:opacity-50">Volver al texto por defecto</button>
                </li>
              )}
            </ul>
          </details>
        )}
      </div>

      <PromptTestPanel
        calls={testable}
        general={form.shape === "general"}
        getDraft={() => ({ categoryId: target.categoryId, shape: form.shape, rubricDraft: form.rubric, instructionsText: form.instructions })}
        disabled={readOnly || problems.length > 0}
        disabledReason={readOnly ? "Necesitás el permiso de configurar." : problems.length > 0 ? "Corregí la rúbrica para poder probar." : undefined}
      />

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={save} disabled={pending || problems.length > 0} title={problems[0]} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {pending ? "Guardando…" : "Guardar"}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent">Cerrar</button>
          {profile && <button type="button" disabled={pending} onClick={archive} className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50">Quitar el analizador</button>}
          {problems.length > 0 && <span className="text-xs text-amber-800 dark:text-amber-300">No se puede guardar: {problems[0]}</span>}
        </div>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </div>
  );
}
