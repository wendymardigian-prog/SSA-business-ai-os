"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, PauseCircle } from "lucide-react";
import { resumeMarketingAction, saveMarketingDeliveryAction } from "@/lib/actions/resend-connection";
import { marketingDeliveryView, type MarketingDeliveryData } from "@/lib/email/marketing-delivery-view";

const input = "h-9 w-32 rounded-lg border border-border bg-background px-3 text-sm";
const primaryButton =
  "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50";

/**
 * «Entrega de marketing» (la guardia de entrega, 00287): el máximo de emails de marketing por día, el calentamiento,
 * el freno automático con «Reanudar» y las cuentas de las últimas 24 h. Lo transaccional no pasa por acá.
 *
 * Los textos salen de `marketingDeliveryView` (puro); este componente solo los compone.
 */
export function MarketingDeliverySection({ data, readOnly }: { data: MarketingDeliveryData; readOnly: boolean }) {
  const router = useRouter();
  const view = marketingDeliveryView(data);
  const [cap, setCap] = useState(String(data.capacity?.manual_cap ?? 100));
  const [warmup, setWarmup] = useState(data.capacity?.warmup_enabled ?? data.warmupSaved ?? true);
  const [busy, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function save() {
    setMessage(null);
    setError(null);
    start(async () => {
      const result = await saveMarketingDeliveryAction({ dailyCap: cap, warmupEnabled: warmup });
      if (!result.ok) return setError(result.error);
      setMessage(result.message ?? "Guardado.");
      router.refresh();
    });
  }

  function resume() {
    if (!window.confirm("¿Reanudar los emails de marketing? Revisá antes por qué se pausaron: si el problema sigue, el freno puede volver a saltar.")) return;
    setMessage(null);
    setError(null);
    start(async () => {
      const result = await resumeMarketingAction();
      if (!result.ok) return setError(result.error);
      setMessage(result.message ?? "Reanudado.");
      router.refresh();
    });
  }

  return (
    <section className="border-t border-border pt-6" aria-labelledby="marketing-delivery-title">
      <div className="mb-2">
        <h3 id="marketing-delivery-title" className="text-sm font-semibold">
          Entrega de marketing
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Cuántos emails de marketing salen por día (broadcasts, automatizaciones y secuencias). Lo que pasa del máximo no se
          pierde: queda pendiente y sale al día siguiente, primero los contactos más activos. Los transaccionales no cuentan.
        </p>
      </div>

      {data.webhookProblem && (
        <p role="alert" className="mb-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {data.webhookProblem}
        </p>
      )}

      {view.paused && (
        <div role="alert" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="flex items-center gap-1.5 font-medium">
            <PauseCircle className="h-3.5 w-3.5" aria-hidden />
            El freno automático pausó el marketing
          </p>
          <p className="mt-1">{view.paused.reason}</p>
          <p className="mt-1">Los transaccionales siguen saliendo. Lo de marketing queda pendiente hasta que lo reanudes.</p>
          {!readOnly && (
            <button type="button" onClick={resume} disabled={busy} className="mt-2 rounded-lg border border-amber-300 px-3 py-1.5 font-medium hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:hover:bg-amber-900/40">
              Reanudar el marketing
            </button>
          )}
        </div>
      )}

      <ul className="space-y-1 text-xs">
        <li>{view.todayLine}</li>
        {view.warmupLine && <li className="text-muted-foreground">{view.warmupLine}</li>}
        {view.statsLine && <li className="text-muted-foreground">{view.statsLine}</li>}
      </ul>

      <div className="mt-4 space-y-3">
        <div>
          <label htmlFor="marketing-daily-cap" className="text-xs font-medium">
            Máximo de emails de marketing por día
          </label>
          <div className="mt-1">
            <input
              id="marketing-daily-cap"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              disabled={readOnly || busy}
              className={input}
            />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">Con el calentamiento prendido, el tope del día es el más bajo entre este número y el escalón.</p>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={warmup} onChange={(e) => setWarmup(e.target.checked)} disabled={readOnly || busy} />
          <span>
            Calentar el dominio
            <span className="block text-[11px] text-muted-foreground">100 → 200 → 400 → 800 por día; sube solo cada día que el freno no saltó. Recomendado para un dominio nuevo.</span>
          </span>
        </label>
        {!readOnly && (
          <button type="button" onClick={save} disabled={busy} className={primaryButton}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Guardar
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {message && <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-300">{message}</p>}
    </section>
  );
}
