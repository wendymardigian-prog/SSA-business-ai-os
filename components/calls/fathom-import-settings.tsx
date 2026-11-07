"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { saveFathomSettings } from "@/lib/actions/fathom";
import type { CategoryGroup } from "@/lib/calls/catalog";
import { FATHOM_MODE_LABELS, fathomSettingsForm, fathomSettingsFromForm, type FathomMode, type FathomSettings, type FathomSettingsForm } from "@/lib/fathom/settings";

const MODE_HELP: Record<FathomMode, string> = {
  auto: "Entra todo lo que grabes, cada 10 minutos.",
  rules: "Entra solo lo que cumple las reglas de abajo. Lo demás no se guarda.",
  manual: "No entra nada solo. Traés las llamadas con Importar historial.",
};

const fieldClass = "mt-1 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm font-normal";

/** Qué importa una conexión y con qué área. Las reglas viven en `lib/fathom/settings.ts`. */
export function FathomImportSettings({
  settings,
  groups,
  connectionId = null,
  presetAreaId = null,
  title = "Qué llamadas entran",
}: {
  settings: FathomSettings;
  groups: CategoryGroup[];
  /** La conexión de otra persona (quien configura el análisis). Sin esto, la propia. */
  connectionId?: string | null;
  /** El `?area=` del link: queda elegida, y se guarda con el botón. */
  presetAreaId?: string | null;
  title?: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FathomSettingsForm>(() => fathomSettingsForm(settings, presetAreaId));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const name = connectionId ?? "propia";
  const patch = (p: Partial<FathomSettingsForm>) => {
    setMessage(null);
    setError(null);
    setForm((f) => ({ ...f, ...p }));
  };

  function save() {
    setMessage(null);
    setError(null);
    start(async () => {
      const r = await saveFathomSettings({ connectionId, settings: fathomSettingsFromForm(form) });
      if (!r.ok) return setError(r.error);
      setMessage(r.message);
      router.refresh();
    });
  }

  return (
    <section aria-label={title} className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      <fieldset className="mt-3 space-y-2" disabled={pending}>
        <legend className="sr-only">Qué llamadas entran</legend>
        {(Object.keys(FATHOM_MODE_LABELS) as FathomMode[]).map((mode) => (
          <label key={mode} className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="radio" name={`fathom-mode-${name}`} checked={form.mode === mode} onChange={() => patch({ mode })} className="mt-1" />
            <span>
              <span className="block font-medium">{FATHOM_MODE_LABELS[mode]}</span>
              <span className="block text-xs text-muted-foreground">{MODE_HELP[mode]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {form.mode === "rules" && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium">
            El nombre contiene
            <input value={form.titleContains} onChange={(e) => patch({ titleContains: e.target.value })} placeholder="demo, diagnóstico" className={fieldClass} />
          </label>
          <label className="block text-xs font-medium">
            El nombre no contiene
            <input value={form.titleExcludes} onChange={(e) => patch({ titleExcludes: e.target.value })} placeholder="interno" className={fieldClass} />
          </label>
          <label className="block text-xs font-medium">
            Duración mínima (minutos)
            <input type="number" min={1} value={form.minDuration} onChange={(e) => patch({ minDuration: e.target.value })} className={fieldClass} />
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={form.withExternal} onChange={(e) => patch({ withExternal: e.target.checked })} />
            Con alguien de afuera del equipo
          </label>
          <p className="text-[11px] text-muted-foreground sm:col-span-2">Las palabras van separadas por coma. Importar historial usa estas mismas reglas.</p>
        </div>
      )}

      <label className="mt-4 block text-xs font-medium">
        Área por defecto
        <select value={form.areaId} onChange={(e) => patch({ areaId: e.target.value })} disabled={pending} className={fieldClass}>
          <option value="">Sin área fija</option>
          {groups.map((g) => (
            <option key={g.areaId} value={g.areaId}>{g.areaName}</option>
          ))}
        </select>
        <span className="mt-1 block font-normal text-muted-foreground">Se usa si la reunión agendada o una regla no deciden el área.</span>
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={pending} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Guardar
        </button>
        {message && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
    </section>
  );
}
