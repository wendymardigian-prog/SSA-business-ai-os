"use client";

import { useState, useTransition } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { analyzeAdsWithAi } from "@/lib/actions/ads-analysis";
import type { PeriodPreset } from "@/lib/dashboards/period";

/**
 * "Analizar con IA" (F61).
 *
 * Le pasa al modelo los numeros de la cuenta y le pide que diga que
 * funciona, que no y que hacer. Se puede preguntar algo puntual.
 *
 * El texto se muestra tal como viene, sin formatear: lo que importa es lo
 * que dice, y un renderizador de markdown para esto seria una dependencia
 * mas para nada.
 */
export function AdsAiPanel({
  period,
  adAccountId,
  onClose,
}: {
  period: PeriodPreset;
  adAccountId: string;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<{ text: string; costUsd: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function analyze() {
    setError(null);
    start(async () => {
      const outcome = await analyzeAdsWithAi({ period, adAccountId, question: question || undefined });
      if (outcome.ok) setResult({ text: outcome.text, costUsd: outcome.costUsd });
      else setError(outcome.error);
    });
  }

  return (
    <aside
      role="dialog"
      aria-label="Analisis con IA"
      className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto border-l border-border bg-background shadow-xl sm:max-w-md"
    >
      <header className="sticky top-0 flex items-center gap-2 border-b border-border bg-background px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-accent"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
        <h2 className="flex-1 text-sm font-semibold">Analizar con IA</h2>
      </header>

      <div className="space-y-4 p-4">
        <p className="text-sm text-muted-foreground">
          Le paso los numeros de esta cuenta y este periodo, y le pido que diga que esta funcionando,
          que no, y que conviene hacer. No ve nada mas que esos numeros.
        </p>

        <div>
          <label htmlFor="pregunta" className="text-sm font-medium">
            Algo puntual que quieras preguntar (opcional)
          </label>
          <textarea
            id="pregunta"
            rows={2}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="¿Conviene apagar la campaña de remarketing?"
            className="mt-1 w-full rounded-lg border border-input bg-background p-2 text-sm"
          />
        </div>

        <button
          type="button"
          onClick={analyze}
          disabled={pending}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="h-4 w-4" aria-hidden />
          )}
          Analizar
        </button>

        {error && (
          <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {result && (
          <div>
            <p className="whitespace-pre-wrap rounded-lg border border-border p-3 text-sm">
              {result.text}
            </p>
            {result.costUsd !== null && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Este analisis costo USD {result.costUsd.toFixed(4)}.
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
