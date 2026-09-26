"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { updateBackgroundSettings } from "@/lib/actions/workspace";
import { BACKGROUND_TASKS, type BackgroundSettings, type BackgroundTask, type TaskMode, type TaskFrequency } from "@/lib/background/settings";

const TASK_LABELS: Record<BackgroundTask, { name: string; desc: string; note?: string }> = {
  message_classification: { name: "Clasificación de mensajes", desc: "Agrupa los mensajes por intención para el dashboard." },
  conversation_summary: { name: "Resumen de conversación", desc: "La memoria del agente sobre cada contacto.", note: "En Económico: si el contacto vuelve a escribir antes de la corrida, el agente no tiene la memoria actualizada." },
  close_classification: { name: "Clasificación al cierre", desc: "Tags, temperatura y seguimiento al cerrar una conversación.", note: "En Económico: un lead que se calentó hoy aparece como caliente recién mañana." },
  knowledge_indexing: { name: "Indexación de Conocimiento", desc: "Prepara los documentos que subís para que el agente los use.", note: "No se puede apagar." },
};
const MODE_LABELS: Record<TaskMode, string> = { now: "Inmediato", batch: "Económico (por lote)", off: "Apagado" };
const FREQ_LABELS: Record<TaskFrequency, string> = { daily: "Diaria", every6h: "Cada 6 h", hourly: "Cada hora", weekly: "Semanal" };

export function BackgroundTasksView({ settings: initial }: { settings: BackgroundSettings }) {
  const router = useRouter();
  const [settings, setSettings] = useState<BackgroundSettings>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  function patch(task: BackgroundTask, next: Partial<BackgroundSettings[BackgroundTask]>) {
    setSettings((s) => ({ ...s, [task]: { ...s[task], ...next } }));
    setSaved(false);
  }
  function save() {
    setError(null);
    start(async () => {
      const r = await updateBackgroundSettings(settings);
      if (!r.ok) return setError(r.error);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <h1 className="text-2xl font-bold">Tareas en segundo plano</h1>
      </div>
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-4 px-8 py-8">
          <p className="text-sm text-muted-foreground">
            Cada tarea de IA que no es una conversación en vivo. Inmediato cuesta más pero es al toque; Económico agrupa y corre por lote.
          </p>
          {BACKGROUND_TASKS.map((task) => {
            const cfg = settings[task];
            const isIndex = task === "knowledge_indexing";
            return (
              <section key={task} className="rounded-xl border border-border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-semibold">{TASK_LABELS[task].name}</h2>
                    <p className="text-xs text-muted-foreground">{TASK_LABELS[task].desc}</p>
                  </div>
                  <select
                    aria-label={`Modo de ${TASK_LABELS[task].name}`}
                    value={cfg.mode}
                    disabled={isIndex}
                    onChange={(e) => patch(task, { mode: e.target.value as TaskMode })}
                    className="rounded-md border border-input bg-background px-2 py-1 text-sm disabled:opacity-50"
                  >
                    {(isIndex ? ["now"] : ["now", "batch", "off"]).map((m) => (<option key={m} value={m}>{MODE_LABELS[m as TaskMode]}</option>))}
                  </select>
                </div>
                {cfg.mode === "batch" && (
                  <div className="mt-3 flex items-center gap-2">
                    <select aria-label="Frecuencia" value={cfg.frequency ?? "daily"} onChange={(e) => patch(task, { frequency: e.target.value as TaskFrequency })} className="rounded-md border border-input bg-background px-2 py-1 text-sm">
                      {(Object.keys(FREQ_LABELS) as TaskFrequency[]).map((f) => (<option key={f} value={f}>{FREQ_LABELS[f]}</option>))}
                    </select>
                    <input aria-label="Hora" type="time" value={cfg.hour ?? "03:00"} onChange={(e) => patch(task, { hour: e.target.value })} className="rounded-md border border-input bg-background px-2 py-1 text-sm" />
                  </div>
                )}
                {cfg.mode !== "now" && TASK_LABELS[task].note && <p className="mt-2 text-xs text-amber-700">{TASK_LABELS[task].note}</p>}
              </section>
            );
          })}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {saved && <p className="text-sm text-emerald-600">Guardado.</p>}
          <button onClick={save} disabled={pending} className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">
            {pending && <Loader2 className="h-4 w-4 animate-spin" />} Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
