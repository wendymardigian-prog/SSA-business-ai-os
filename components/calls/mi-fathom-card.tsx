"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Plug, RefreshCw, Trash2, TriangleAlert, Unplug } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { disconnectFathom, syncFathomNow } from "@/lib/actions/fathom";
import { countImportedCalls, deleteImportedCalls } from "@/lib/actions/trash";
import { SaleModal } from "@/components/shared/sale-modal";
import { TRASH_RETENTION_DAYS } from "@/lib/trash/entities";
import type { FathomCardView } from "@/lib/fathom/connection-state";
import { relativeTime } from "@/lib/notifications/types";

/**
 * La tarjeta de "Mi Fathom" (F6). Que muestra y que botones ofrece lo decide
 * `fathomCardView` (puro, con sus tests); esto solo lo compone.
 */

const BACK_TO = "/dashboard/llamadas/mi-fathom";
/** El `?area=` viaja en la vuelta firmada: al conectar queda como el area por defecto de la conexion. */
const connectUrl = (areaId?: string | null) => `/api/oauth/fathom/start?redirect_to=${encodeURIComponent(areaId ? `${BACK_TO}?area=${areaId}` : BACK_TO)}`;

const TONE: Record<FathomCardView["state"], string> = {
  missing_app: "border-border",
  error: "border-red-500/40",
  connected: "border-emerald-500/40",
  not_connected: "border-border",
};

export function MiFathomCard({
  view,
  connectionId,
  flash,
  areaId = null,
  embedded = false,
  canDeleteImported = false,
}: {
  view: FathomCardView;
  connectionId: string | null;
  /**
   * Dentro de otra pantalla (Integraciones > Mis conexiones): sin el envoltorio de pagina (ancho maximo, centrado y
   * margenes), para alinearse con las demas tarjetas. Como pagina propia (Grabaciones > Mi Fathom) queda como siempre.
   */
  embedded?: boolean;
  /** El area del modulo desde el que se conecta. */
  areaId?: string | null;
  /** `calls.delete`: «Eliminar todo lo importado» de esta conexión (va a la Papelera 30 días). */
  canDeleteImported?: boolean;
  /** Lo que dejo el retorno de Fathom: `?connected=1` o `?error=...`. */
  flash: { kind: "connected" } | { kind: "error"; message: string } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const connectHref = connectUrl(areaId);
  const purge = usePurgeImported(connectionId, () => router.refresh());

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

  const Icon = view.state === "connected" ? CheckCircle2 : view.state === "error" ? TriangleAlert : Plug;
  const iconTone = view.state === "connected" ? "text-emerald-600 dark:text-emerald-400" : view.state === "error" ? "text-red-600 dark:text-red-400" : "text-muted-foreground";

  return (
    <div className={embedded ? "w-full" : "mx-auto w-full max-w-xl p-4 md:p-6"}>
      {flash?.kind === "connected" && (
        <p role="status" className="mb-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          Listo, conectaste tu Fathom. Las llamadas de los últimos 14 días entran en unos minutos; las anteriores las podés importar abajo.
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
          {canDeleteImported && connectionId && (
            <button type="button" onClick={purge.open} disabled={pending || purge.running} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-500/40 px-3 text-sm text-red-700 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400">
              <Trash2 className="h-4 w-4" aria-hidden /> Eliminar todo lo importado
            </button>
          )}
          {view.actions.disconnect && connectionId && (
            <button type="button" onClick={() => setConfirming(true)} disabled={pending} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50">
              <Unplug className="h-4 w-4" aria-hidden /> Desconectar
            </button>
          )}
        </div>

        {embedded && view.connected && (
          <Link href="/dashboard/llamadas/mi-fathom" className="mt-3 inline-block text-sm text-primary-ink underline-offset-2 hover:underline">
            Elegir qué entra, importar historial y ver tus correos
          </Link>
        )}
        {message && <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      </section>

      {purge.modal}

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

type PurgeStep =
  | { kind: "closed" }
  | { kind: "counting" }
  | { kind: "confirm"; count: number }
  | { kind: "running"; deleted: number; total: number }
  | { kind: "done"; deleted: number; failed: number; firstError: string | null }
  | { kind: "error"; message: string };

/**
 * «Eliminar todo lo importado» de una conexión de Fathom: cuenta, pide confirmar con el número, y elimina de a
 * tandas de 50 (`deleteImportedCalls`) mostrando el avance hasta que no quede ninguna o una tanda falle.
 */
function usePurgeImported(connectionId: string | null, onFinished: () => void) {
  const [step, setStep] = useState<PurgeStep>({ kind: "closed" });

  async function open() {
    if (!connectionId) return;
    setStep({ kind: "counting" });
    try {
      const r = await countImportedCalls(connectionId);
      setStep(r.ok ? { kind: "confirm", count: r.count } : { kind: "error", message: r.error });
    } catch {
      setStep({ kind: "error", message: "No pude contar las grabaciones. Probá de nuevo." });
    }
  }

  async function run(total: number) {
    if (!connectionId) return;
    let deleted = 0;
    let failed = 0;
    let firstError: string | null = null;
    setStep({ kind: "running", deleted, total });
    // Tope de vueltas por las dudas: cada una borra hasta 50.
    for (let round = 0; round < 1000; round += 1) {
      let r: Awaited<ReturnType<typeof deleteImportedCalls>>;
      try {
        r = await deleteImportedCalls(connectionId);
      } catch {
        r = { ok: false, error: "Se cortó la conexión. Lo que ya se eliminó está en la Papelera; podés volver a intentar." };
      }
      if (!r.ok) {
        firstError = firstError ?? r.error;
        break;
      }
      deleted += r.deleted;
      if (r.failures.length > 0) {
        failed += r.failures.length;
        firstError = firstError ?? r.failures[0].error;
      }
      setStep({ kind: "running", deleted, total: Math.max(total, deleted) });
      if (r.failures.length > 0 || !r.remaining || r.deleted === 0) break;
    }
    setStep({ kind: "done", deleted, failed, firstError });
    onFinished();
  }

  const running = step.kind === "running" || step.kind === "counting";
  const close = () => {
    if (!running) setStep({ kind: "closed" });
  };

  const btn = "h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-50";
  const modal =
    step.kind === "closed" ? null : (
      <SaleModal
        title="Eliminar todo lo importado"
        label="Eliminar todas las grabaciones importadas de tu Fathom"
        onClose={close}
        footer={
          <div className="ml-auto flex gap-2">
            {step.kind === "confirm" && step.count > 0 ? (
              <>
                <button type="button" onClick={close} className={btn}>Volver</button>
                <button type="button" onClick={() => void run(step.count)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-medium text-white">
                  <Trash2 className="h-4 w-4" aria-hidden /> Eliminar {step.count}
                </button>
              </>
            ) : (
              <button type="button" disabled={running} onClick={close} className={btn}>Cerrar</button>
            )}
          </div>
        }
      >
        {step.kind === "counting" && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Contando las grabaciones…
          </p>
        )}
        {step.kind === "confirm" &&
          (step.count === 0 ? (
            <p className="text-sm">No hay grabaciones importadas de tu Fathom para eliminar.</p>
          ) : (
            <p className="text-sm">
              {step.count === 1 ? "Se elimina 1 grabación." : `Se eliminan ${step.count} grabaciones.`} Quedan {TRASH_RETENTION_DAYS} días en la Papelera y no vuelven a entrar al sincronizar.
            </p>
          ))}
        {step.kind === "running" && (
          <div role="status" className="space-y-2 text-sm">
            <p className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Eliminando… {step.deleted} de {step.total}
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full bg-red-600 transition-all" style={{ width: `${step.total > 0 ? Math.min(100, Math.round((step.deleted / step.total) * 100)) : 0}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">No cierres esta ventana hasta que termine.</p>
          </div>
        )}
        {step.kind === "done" && (
          <div role="status" className="space-y-2 text-sm">
            <p>
              {step.deleted === 1 ? "Se eliminó 1 grabación." : `Se eliminaron ${step.deleted} grabaciones.`} Están en la Papelera (Ajustes → Papelera) durante {TRASH_RETENTION_DAYS} días.
            </p>
            {step.failed > 0 ? (
              <p role="alert" className="text-red-700 dark:text-red-400">
                {step.failed === 1 ? "1 no se pudo eliminar" : `${step.failed} no se pudieron eliminar`}
                {step.firstError ? `: ${step.firstError}` : "."}
              </p>
            ) : (
              step.firstError && (
                <p role="alert" className="text-red-700 dark:text-red-400">Se frenó antes de terminar: {step.firstError}</p>
              )
            )}
          </div>
        )}
        {step.kind === "error" && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{step.message}</p>}
      </SaleModal>
    );

  return { open: () => void open(), running, modal };
}
