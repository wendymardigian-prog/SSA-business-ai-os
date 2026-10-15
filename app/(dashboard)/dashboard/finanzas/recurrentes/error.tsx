"use client";

import { useEffect } from "react";

/** Si algo falla al armar la pantalla de Recurrentes: un mensaje claro y «Reintentar». */
export default function RecurrentesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[finanzas] la pantalla de recurrentes fallo:", error.message);
  }, [error]);
  return (
    <div className="grid h-full place-items-center p-6">
      <div role="alert" className="max-w-sm rounded-xl border border-red-500/40 bg-red-500/10 p-5 text-center">
        <p className="text-sm font-medium text-red-700 dark:text-red-300">No pudimos mostrar los gastos recurrentes.</p>
        <p className="mt-1 text-xs text-muted-foreground">Probá de nuevo. Si sigue pasando, avisale a quien administra el sistema.</p>
        <button type="button" onClick={reset} className="mt-3 h-8 rounded-lg border border-border px-3 text-sm hover:bg-accent">Reintentar</button>
      </div>
    </div>
  );
}
