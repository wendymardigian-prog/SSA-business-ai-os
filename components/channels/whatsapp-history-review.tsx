"use client";

import { useState, useTransition } from "react";
import { History, Loader2 } from "lucide-react";
import { reviewWhatsappHistory } from "@/lib/actions/whatsapp-history";
import { reviewText, type ReviewText } from "@/lib/whatsapp-history/review-text";

/**
 * "Historial" en la tarjeta de un número de WhatsApp: revisa cuántas
 * conversaciones guarda el Evolution de ese número y cuántas faltan en la bandeja.
 * Solo lectura (no importa nada). Pega contra Evolution, así que corre al tocar el
 * botón, nunca al abrir la pantalla.
 */
export function WhatsappHistoryReview({ channelId }: { channelId: string }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ReviewText | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function review() {
    setError(null);
    start(async () => {
      const res = await reviewWhatsappHistory(channelId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult(
        reviewText(res.review, (iso) =>
          new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "numeric", year: "numeric" }),
        ),
      );
    });
  }

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
          <p className="text-muted-foreground">
            Revisa qué conversaciones tiene guardadas WhatsApp en tu servidor y cuántas faltan en la bandeja. No importa
            nada ni toca el número.
          </p>
          <button
            type="button"
            onClick={review}
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
        </div>
      )}
    </div>
  );
}
