"use client";

import { useViewerTimezone } from "@/components/dashboard-chrome";
import { useEffect, useState, useTransition } from "react";
import { Download, History, Loader2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { WhatsappDailyChart } from "@/components/channels/whatsapp-daily-chart";
import {
  getWhatsappImportState,
  reviewWhatsappHistory,
  startWhatsappHistoryImport,
} from "@/lib/actions/whatsapp-history";
import { whatsappImportView, type WhatsappImportState } from "@/lib/whatsapp-history/import-state";
import type { HistoryReview } from "@/lib/whatsapp-history/review";
import { reviewText, type ReviewText } from "@/lib/whatsapp-history/review-text";

const IMPORT_POLL_MS = 4000;

/**
 * "Historial" en la tarjeta de un número de WhatsApp: revisa cuántas
 * conversaciones guarda el Evolution de ese número y cuántas faltan en la bandeja,
 * y las importa si la persona lo confirma. Pega contra Evolution, así que corre al
 * tocar el botón, nunca al abrir la pantalla.
 */
export function WhatsappHistoryReview({ channelId }: { channelId: string }) {
  const timeZone = useViewerTimezone();
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<HistoryReview | null>(null);
  const [result, setResult] = useState<ReviewText | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [importState, setImportState] = useState<WhatsappImportState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [importing, startImporting] = useTransition();

  const view = whatsappImportView(importState);
  const running = view?.running ?? false;

  // Al abrir se muestra lo último que pasó; mientras corre, se vuelve a mirar cada tanto.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      const res = await getWhatsappImportState(channelId);
      if (!cancelled && res.ok) setImportState(res.state);
    };
    void load();
    if (!running) return () => { cancelled = true; };
    const timer = window.setInterval(load, IMPORT_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, running, channelId]);

  function runReview() {
    setError(null);
    start(async () => {
      const res = await reviewWhatsappHistory(channelId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setReview(res.review);
      setResult(
        reviewText(res.review, (iso) =>
          new Date(iso).toLocaleDateString("es-AR", { timeZone, day: "numeric", month: "numeric", year: "numeric" }),
        ),
      );
    });
  }

  function runImport() {
    setConfirming(false);
    setError(null);
    startImporting(async () => {
      const res = await startWhatsappHistoryImport(channelId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setImportState(res.state);
    });
  }

  const missing = review?.missingInInbox ?? 0;
  const canImport = (review?.messages ?? 0) > 0 && !running;

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-medium hover:bg-muted"
      >
        <History className="h-3 w-3" aria-hidden />
        Historial
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-2.5 py-2 text-[11px]">
          <WhatsappDailyChart channelId={channelId} />
          <p className="border-t border-border pt-2 text-muted-foreground">
            Revisa qué conversaciones tiene guardadas WhatsApp en tu servidor y cuántas faltan en la bandeja. Revisar no
            importa nada ni toca el número.
          </p>
          <button
            type="button"
            onClick={runReview}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 font-medium hover:bg-muted disabled:opacity-50"
          >
            {pending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
            {pending ? "Revisando…" : result ? "Revisar de nuevo" : "Revisar historial"}
          </button>
          {error && (
            <p role="alert" className="text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          {result && !error && (
            <div role="status" className="space-y-1">
              <p className="font-medium text-foreground">{result.headline}</p>
              <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                {result.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
          {canImport && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={importing}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {importing ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Download className="h-3 w-3" aria-hidden />}
              {missing > 0 ? `Importar ${missing.toLocaleString("es-AR")} conversaciones` : "Importar los mensajes que falten"}
            </button>
          )}
          {view && (
            <div
              role="status"
              className={
                view.tone === "warning"
                  ? "text-amber-700 dark:text-amber-400"
                  : view.tone === "ok"
                    ? "text-green-700 dark:text-green-400"
                    : "text-muted-foreground"
              }
            >
              <p className="flex items-center gap-1 font-medium">
                {view.running && <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />}
                {view.text}
              </p>
              {view.detail && <p className="mt-0.5">{view.detail}</p>}
            </div>
          )}
          <p className="text-muted-foreground">
            ¿Falta historial? WhatsApp solo lo manda al escanear el QR: cerrá la sesión de este número en el teléfono
            (Dispositivos vinculados), tocá Reconectar acá y escaneá. Después importá de nuevo.
          </p>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        title="Importar conversaciones de WhatsApp"
        message="Cada persona de estos chats pasa a ser un contacto, también los chats personales, y puede entrar en un broadcast por WhatsApp. Lo importado no dispara automatizaciones ni el agente, y no se le manda nada a nadie."
        confirmLabel="Importar"
        cancelLabel="Cancelar"
        onConfirm={runImport}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
