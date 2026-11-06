"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, History, Loader2, TriangleAlert } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { resumeFathomHistoryImport, startFathomHistoryImport, stopFathomHistoryImport } from "@/lib/actions/fathom";
import { dateInputToIso, todayInputValue } from "@/lib/dates";
import type { HistoryView } from "@/lib/fathom/history-state";

/** Cada cuanto se pide el avance mientras corre. */
const REFRESH_MS = 15_000;

/**
 * "Importar historial" en Mi Fathom. Que muestra y que botones ofrece lo decide
 * `historyView` (puro, con sus tests); esto solo lo compone.
 */
export function FathomHistoryImport({ view }: { view: HistoryView }) {
  const router = useRouter();
  const timeZone = useViewerTimezone();
  const [mode, setMode] = useState<"all" | "from">("all");
  const [date, setDate] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const running = view.phase === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [running, router]);

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    start(async () => {
      const r = await action();
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  }

  function askToStart() {
    setError(null);
    if (mode === "from" && !date) {
      setError("Elegí desde qué fecha querés importar");
      return;
    }
    setConfirming(true);
  }

  function confirmStart() {
    setConfirming(false);
    const from = mode === "from" ? dateInputToIso(date, timeZone) : null;
    run(() => startFathomHistoryImport({ from }));
  }

  const Icon = view.phase === "done" ? CheckCircle2 : view.phase === "partial" ? TriangleAlert : running ? Loader2 : History;
  const tone = view.phase === "done" ? "text-emerald-600 dark:text-emerald-400" : view.phase === "partial" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground";

  return (
    <section aria-labelledby="fathom-history-title" className="mt-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${tone} ${running ? "animate-spin" : ""}`} aria-hidden />
        <div className="min-w-0">
          <h2 id="fathom-history-title" className="text-base font-semibold">{view.title}</h2>
          <p role="status" className="mt-1 text-sm text-muted-foreground">{view.message}</p>
        </div>
      </div>

      {view.canStart && (
        <fieldset className="mt-4 space-y-2 text-sm" disabled={pending}>
          <legend className="sr-only">Qué llamadas importar</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="fathom-history-range" checked={mode === "all"} onChange={() => setMode("all")} />
            Todo el historial
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <input type="radio" name="fathom-history-range" checked={mode === "from"} onChange={() => setMode("from")} />
            Desde una fecha
            {mode === "from" && (
              <input
                type="date"
                aria-label="Desde qué fecha importar"
                value={date}
                max={todayInputValue(undefined, timeZone)}
                onChange={(e) => setDate(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
              />
            )}
          </label>
        </fieldset>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {view.canResume && (
          <button type="button" onClick={() => run(resumeFathomHistoryImport)} disabled={pending} className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            Seguir desde donde quedó
          </button>
        )}
        {view.canStart && (
          <button type="button" onClick={askToStart} disabled={pending} className={`inline-flex h-9 items-center rounded-lg px-3 text-sm disabled:opacity-50 ${view.canResume ? "border border-border hover:bg-accent" : "bg-primary font-medium text-primary-foreground hover:opacity-90"}`}>
            {view.phase === "idle" ? "Importar" : "Importar de nuevo"}
          </button>
        )}
        {view.canStop && (
          <button type="button" onClick={() => run(stopFathomHistoryImport)} disabled={pending} className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
            Frenar
          </button>
        )}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}

      <ConfirmDialog
        open={confirming}
        title="¿Importar tu historial de Fathom?"
        message="Puede tardar horas si tenés muchas llamadas: entran unas 400 por hora. Cada llamada se clasifica con IA si la clasificación está prendida, y eso tiene costo. No se analizan solas ni disparan automatizaciones."
        confirmLabel="Importar"
        cancelLabel="Cancelar"
        onConfirm={confirmStart}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}
