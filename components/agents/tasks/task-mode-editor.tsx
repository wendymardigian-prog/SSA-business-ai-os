"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateBackgroundSettings } from "@/lib/actions/workspace";
import type { BackgroundSettings, BackgroundTask, TaskFrequency, TaskMode } from "@/lib/background/settings";
import { FREQUENCY_LABELS, MODE_LABELS, formatSpend, lastRunLabel } from "@/lib/background/screen";
import type { TaskRunInfo } from "@/lib/background/screen";

const MODES: TaskMode[] = ["now", "batch", "off"];

/**
 * El modo, la frecuencia y la hora de UNA tarea (Bloque Agentes IA): la
 * misma fila que antes vivía en la tabla de Ajustes → Tareas, ahora en la
 * pestaña Configuración de esa tarea sola. Guarda con `updateBackgroundSettings`
 * (toma la configuración COMPLETA): se le manda la de siempre con solo esta
 * tarea cambiada.
 */
export function TaskModeEditor({
  task,
  settings,
  canTurnOff,
  canBatch,
  batchWarning,
  lastRun,
}: {
  task: BackgroundTask;
  /** La configuración completa del workspace: hace falta para no pisar las otras tareas al guardar. */
  settings: BackgroundSettings;
  canTurnOff: boolean;
  canBatch: boolean;
  batchWarning: string | null;
  lastRun: TaskRunInfo | null;
}) {
  const router = useRouter();
  const original = settings[task];
  const [mode, setMode] = useState<TaskMode>(original.mode);
  const [frequency, setFrequency] = useState<TaskFrequency>(original.frequency ?? "daily");
  const [hour, setHour] = useState(original.hour ?? "03:00");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const dirty = mode !== original.mode || (mode === "batch" && (frequency !== (original.frequency ?? "daily") || hour !== (original.hour ?? "03:00")));

  function touch<T>(set: (v: T) => void) {
    return (v: T) => {
      setError(null);
      setSaved(false);
      set(v);
    };
  }

  function save() {
    setError(null);
    start(async () => {
      const next: BackgroundSettings = { ...settings, [task]: { mode, frequency, hour, model: original.model ?? null } };
      const result = await updateBackgroundSettings(next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">Cuándo corre</h3>

      <div role="group" aria-label="Modo" className="mt-3 inline-flex gap-0.5 rounded-[9px] border border-border bg-background p-[3px]">
        {MODES.map((m) => {
          const disabled = (m === "off" && !canTurnOff) || (m === "batch" && !canBatch);
          return (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              disabled={disabled}
              title={disabled ? "El agente necesita los documentos indexados" : undefined}
              onClick={() => touch(setMode)(m)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                mode === m ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
                disabled && "cursor-not-allowed opacity-40",
              )}
            >
              {MODE_LABELS[m]}
            </button>
          );
        })}
      </div>

      {mode === "batch" && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            Frecuencia
            <select
              value={frequency}
              onChange={(e) => touch(setFrequency)(e.target.value as TaskFrequency)}
              className="rounded-lg border border-input bg-background px-2 py-1 text-sm"
            >
              {(Object.keys(FREQUENCY_LABELS) as TaskFrequency[]).map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABELS[f]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            Hora
            <input type="time" value={hour} onChange={(e) => touch(setHour)(e.target.value)} className="rounded-lg border border-input bg-background px-2 py-1 text-sm" />
          </label>
          {batchWarning && <span className="text-xs text-warn">⚠ {batchWarning}</span>}
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Última corrida: {mode === "off" ? "Apagada" : lastRun ? lastRunLabel(lastRun.at) : "Sin corridas propias todavía"}
        {" · "}
        Gasto del mes: {formatSpend(lastRun?.monthSpendUsd ?? null)}
      </p>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={!dirty || pending}
          onClick={save}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Guardar cambios
        </button>
        {error && (
          <span role="alert" className="text-xs text-red-700 dark:text-red-400">
            {error}
          </span>
        )}
        {saved && !dirty && <span className="text-xs text-emerald-700 dark:text-emerald-400">Guardado.</span>}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Si una corrida por lote falla o tarda más de 24 h, se reintenta y después corre en modo normal. Respeta los topes de gasto.
      </p>
    </section>
  );
}
