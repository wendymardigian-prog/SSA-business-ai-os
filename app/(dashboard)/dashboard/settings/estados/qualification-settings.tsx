"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { saveQualificationSettings } from "@/lib/actions/contact-qualification";
import {
  QUALIFICATION_COLORS,
  QUALIFICATION_DESCRIPTION_MAX,
  QUALIFICATION_NAME_MAX,
  type QualificationLevelDef,
  type QualificationSettings,
} from "@/lib/contacts/qualification";

/**
 * Ajustes → Estados → «Calificación del lead»: el nombre y la descripción (la
 * rúbrica) de cada uno de los 5 niveles. Los niveles son fijos; el agente de IA
 * lee la descripción para decidir el nivel.
 */
export function QualificationSettingsSection({
  settings,
  usage,
  unqualified,
}: {
  settings: QualificationSettings;
  usage: Record<number, number>;
  unqualified: number | null;
}) {
  const router = useRouter();
  const [levels, setLevels] = useState<QualificationLevelDef[]>(() => settings.levels.map((l) => ({ ...l })));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const dirty = levels.some((l, i) => l.name !== settings.levels[i].name || l.description !== settings.levels[i].description);

  function update(level: number, patch: Partial<QualificationLevelDef>) {
    setSaved(false);
    setLevels((prev) => prev.map((l) => (l.level === level ? { ...l, ...patch } : l)));
  }

  function save() {
    start(async () => {
      const result = await saveQualificationSettings(levels);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setSaved(true);
      setLevels(result.settings.levels.map((l) => ({ ...l })));
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="qualification-levels" className="max-w-3xl">
      <div className="flex items-center gap-2">
        <h2 id="qualification-levels" className="text-sm font-semibold">
          Calificación del lead
        </h2>
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Cada contacto puede tener un nivel del 1 al 5. Poné el nombre que usa tu equipo y qué tiene que cumplir un lead
        para estar en cada nivel: el agente de IA usa esa descripción para calificar. Se cambia a mano en la ficha, con
        el paso «Calificar lead» de las automatizaciones o lo pone el agente.
      </p>
      {unqualified !== null && (
        <p className="mt-1 text-xs text-muted-foreground">
          Sin calificar: <span className="tabular-nums">{unqualified}</span> contactos.
        </p>
      )}

      <div className="mt-3 divide-y divide-border rounded-lg border border-border">
        {levels.map((l) => (
          <div key={l.level} className="grid gap-2 px-3 py-3 sm:grid-cols-[auto_minmax(0,12rem)_minmax(0,1fr)] sm:items-start">
            <div className="flex items-center gap-2 pt-1.5">
              <span
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: QUALIFICATION_COLORS[l.level] }}
                aria-hidden
              >
                {l.level}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground sm:hidden">
                {usage[l.level] ?? 0} contactos
              </span>
            </div>
            <label className="block">
              <span className="sr-only">Nombre del nivel {l.level}</span>
              <input
                value={l.name}
                maxLength={QUALIFICATION_NAME_MAX}
                onChange={(e) => update(l.level, { name: e.target.value })}
                className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm"
              />
              <span className="mt-1 hidden text-[11px] tabular-nums text-muted-foreground sm:block">
                {usage[l.level] ?? 0} contactos
              </span>
            </label>
            <label className="block">
              <span className="sr-only">Qué tiene que cumplir un lead de nivel {l.level}</span>
              <textarea
                value={l.description}
                maxLength={QUALIFICATION_DESCRIPTION_MAX}
                rows={2}
                placeholder="Qué tiene que cumplir un lead para estar en este nivel"
                onChange={(e) => update(l.level, { description: e.target.value })}
                className="w-full resize-y rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
              />
            </label>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={pending || !dirty}
          onClick={save}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          Guardar niveles
        </button>
        {saved && !dirty && (
          <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
            <Check className="h-3.5 w-3.5" aria-hidden /> Guardado
          </span>
        )}
        {error && (
          <p role="alert" className="text-xs text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
