"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Plug, RefreshCw, TriangleAlert, Unplug } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { disconnectFathom, syncFathomNow } from "@/lib/actions/fathom";
import type { FathomCardView } from "@/lib/fathom/connection-state";
import { relativeTime } from "@/lib/notifications/types";

/**
 * La tarjeta de "Mi Fathom" (F6). Que muestra y que botones ofrece lo decide
 * `fathomCardView` (puro, con sus tests); esto solo lo compone.
 */

const connectHref = "/api/oauth/fathom/start?redirect_to=/dashboard/llamadas/mi-fathom";

const TONE: Record<FathomCardView["state"], string> = {
  missing_app: "border-border",
  error: "border-red-500/40",
  not_closer: "border-amber-500/40",
  connected: "border-emerald-500/40",
  not_connected: "border-border",
};

export function MiFathomCard({
  view,
  connectionId,
  flash,
}: {
  view: FathomCardView;
  connectionId: string | null;
  /** Lo que dejo el retorno de Fathom: `?connected=1` o `?error=...`. */
  flash: { kind: "connected" } | { kind: "error"; message: string } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function syncNow() {
    setError(null);
    setMessage(null);
    start(async () => {
      const r = await syncFathomNow();
      if (r.ok) setMessage(r.message);
      else setError(r.error);
      router.refresh();
    });
  }

  function disconnect() {
    if (!connectionId) return;
    setConfirming(false);
    setError(null);
    setMessage(null);
    start(async () => {
      const r = await disconnectFathom(connectionId);
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  }

  const Icon = view.state === "connected" ? CheckCircle2 : view.state === "error" || view.state === "not_closer" ? TriangleAlert : Plug;
  const iconTone = view.state === "connected" ? "text-emerald-600 dark:text-emerald-400" : view.state === "error" ? "text-red-600 dark:text-red-400" : view.state === "not_closer" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground";

  return (
    <div className="mx-auto w-full max-w-xl p-4 md:p-6">
      {flash?.kind === "connected" && (
        <p role="status" className="mb-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          Listo, conectaste tu Fathom. Las llamadas nuevas entran en unos minutos.
        </p>
      )}
      {flash?.kind === "error" && (
        <p role="alert" className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          No se pudo conectar: {flash.message}
        </p>
      )}

      <section aria-labelledby="mi-fathom-title" className={`rounded-xl border bg-card p-5 ${TONE[view.state]}`}>
        <div className="flex items-start gap-3">
          <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconTone}`} aria-hidden />
          <div className="min-w-0">
            <h2 id="mi-fathom-title" className="text-base font-semibold">{view.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{view.message}</p>
          </div>
        </div>

        {view.connected && (
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Última consulta</dt>
              <dd>{view.lastSyncedAt ? relativeTime(view.lastSyncedAt) : "Todavía no consultó"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Llamadas en los últimos 7 días</dt>
              <dd>{view.callsLast7d}</dd>
            </div>
          </dl>
        )}

        {view.syncWarning && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
            <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            La última consulta no se pudo completar: {view.syncWarning}. Se reintenta sola.
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {view.actions.connect && (
            <a href={connectHref} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">
              <Plug className="h-4 w-4" aria-hidden /> Conectar Fathom
            </a>
          )}
          {view.actions.reconnect && (
            <a href={connectHref} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">
              <Plug className="h-4 w-4" aria-hidden /> Reconectar
            </a>
          )}
          {view.actions.syncNow && (
            <button type="button" onClick={syncNow} disabled={pending} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-50">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />} Sincronizar ahora
            </button>
          )}
          {view.actions.disconnect && connectionId && (
            <button type="button" onClick={() => setConfirming(true)} disabled={pending} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50">
              <Unplug className="h-4 w-4" aria-hidden /> Desconectar
            </button>
          )}
        </div>

        {message && <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      </section>

      <ConfirmDialog
        open={confirming}
        title="¿Desconectar tu Fathom?"
        message="Dejan de entrar llamadas nuevas. Las que ya entraron se quedan."
        confirmLabel="Desconectar"
        cancelLabel="Cancelar"
        destructive
        onConfirm={disconnect}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
