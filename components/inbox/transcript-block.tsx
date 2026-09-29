"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { transcriptView, canTranscribe, type TranscriptRow } from "@/lib/inbox/transcript-state";

/**
 * Lo que dice el audio, debajo del reproductor (F13).
 *
 * Va debajo y no en lugar del reproductor: se puede escuchar el audio Y leer lo
 * que dice. La barra lateral izquierda es lo que lo separa visualmente del
 * mensaje, para que no se confunda con algo que la persona escribió.
 */
export function TranscriptBlock({
  messageId,
  message,
}: {
  messageId: string;
  message: TranscriptRow;
}) {
  const router = useRouter();
  const view = transcriptView(message);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (view.state === "hidden") return null;

  function request() {
    start(async () => {
      try {
        const response = await fetch(`/api/v1/messages/${messageId}/transcribe`, { method: "POST" });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          setError(body?.error ?? "No pudimos pedir la transcripción. Probá de nuevo.");
          return;
        }
        setError(null);
        router.refresh();
      } catch {
        setError("No pudimos pedir la transcripción. Revisá tu conexión.");
      }
    });
  }

  // Sin archivo no hay nada que transcribir, y un botón que siempre falla es
  // peor que no tener botón.
  const available = canTranscribe(message);

  return (
    <div className="mt-1.5 border-l-2 border-current/25 pl-2.5 text-xs">
      {view.state === "ready" && <p className="whitespace-pre-wrap opacity-90">{view.text}</p>}

      {view.state === "pending" && (
        <p className="flex items-center gap-1.5 opacity-70">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          Transcribiendo…
        </p>
      )}

      {view.state === "failed" && (
        <div className="space-y-1">
          <p className="flex flex-wrap items-center gap-1.5 text-red-700 dark:text-red-300">
            <AlertTriangle className="h-3 w-3 flex-shrink-0" aria-hidden />
            {view.error}
          </p>
          {available && (
            <Action onClick={request} pending={pending} icon={<RotateCcw className="h-3 w-3" aria-hidden />}>
              Reintentar transcripción
            </Action>
          )}
        </div>
      )}

      {view.state === "none" && available && (
        <Action onClick={request} pending={pending} icon={<Sparkles className="h-3 w-3" aria-hidden />}>
          Transcribir
        </Action>
      )}

      {error && <p className="mt-1 text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}

function Action({
  onClick,
  pending,
  icon,
  children,
}: {
  onClick: () => void;
  pending: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex min-h-[32px] items-center gap-1.5 rounded border border-current/25 px-2 py-1 text-[11px] font-medium hover:bg-current/10 disabled:opacity-60"
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}
