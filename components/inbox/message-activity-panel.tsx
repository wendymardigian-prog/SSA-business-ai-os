"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import type { ActivityEntry, ActivityTone, MessageActivity } from "@/lib/inbox/message-activity";
import { cn } from "@/lib/utils";

/**
 * "Que hizo el agente con este mensaje": un indicador chico que abre un panel
 * con la historia. Funciona igual con mouse que con el dedo (se abre con un
 * clic o un toque, nunca con hover): en pantallas grandes es un panel junto al
 * indicador y en el telefono, una hoja que sube desde abajo.
 *
 * Las sugerencias y las respuestas se dibujan distinto a proposito: una
 * sugerencia pendiente es ambar y dice "sin enviar"; una respuesta enviada es
 * verde; una falla, roja; lo descartado o salteado, gris.
 */

const DOT: Record<ActivityTone, string> = {
  success: "bg-emerald-500",
  info: "bg-sky-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
  neutral: "bg-muted-foreground/50",
};

const OUTCOME_TEXT: Record<ActivityEntry["outcome"], string> = {
  suggested: "Sugerida · sin enviar",
  executed: "Hecho",
  failed: "Falló",
  skipped: "No se hizo nada",
  pending: "En curso",
};

function formatAt(iso: string): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === new Date().toDateString() ? time : `${date.toLocaleDateString([], { day: "2-digit", month: "short" })} ${time}`;
}

export function ActivityTrigger({
  activity,
  variant,
  runsHref,
  children,
}: {
  activity: MessageActivity;
  /** `marker`: la linea bajo un mensaje del contacto. `bot`: el icono del robot de una respuesta del agente. */
  variant: "marker" | "bot";
  /** Base de la pantalla de corridas (`/dashboard/agents/runs`); null si la persona no puede verla. */
  runsHref: string | null;
  /** Lo que se dibuja dentro del boton en la variante `bot`. */
  children?: ReactNode;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const { summary } = activity;
  const runIds = [...new Set(activity.entries.map((e) => e.runId).filter((id): id is string => Boolean(id)))];

  return (
    <span ref={rootRef} className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`${summary.label}. Ver qué hizo el agente con este mensaje`}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          variant === "marker"
            ? "inline-flex min-h-6 items-center gap-1.5 rounded-full px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            : "inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-primary/20",
        )}
      >
        {variant === "marker" ? (
          <>
            <span className={cn("h-2 w-2 rounded-full", DOT[summary.tone])} aria-hidden />
            {summary.label}
          </>
        ) : (
          <>
            {children}
            <span className={cn("absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-background", DOT[summary.tone])} aria-hidden />
          </>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 sm:hidden" aria-hidden onClick={() => setOpen(false)} />
          <div
            id={panelId}
            role="dialog"
            aria-label="Qué hizo el agente con este mensaje"
            className={cn(
              "fixed inset-x-0 bottom-0 z-50 max-h-[75vh] overflow-y-auto rounded-t-2xl border border-border bg-popover p-4 text-popover-foreground shadow-xl",
              "sm:absolute sm:inset-x-auto sm:bottom-auto sm:max-h-96 sm:w-80 sm:rounded-xl sm:p-3",
              variant === "marker" ? "sm:left-0 sm:top-full sm:mt-1" : "sm:right-0 sm:top-full sm:mt-1",
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Qué hizo el agente</h3>
              <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <ol className="space-y-3">
              {activity.entries.map((entry) => (
                <li key={entry.key} className="flex gap-2.5">
                  <span className={cn("mt-1.5 h-2 w-2 flex-shrink-0 rounded-full", DOT[entry.tone])} aria-hidden />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">{entry.title}</p>
                    {entry.detail && <p className="text-xs text-muted-foreground">{entry.detail}</p>}
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {formatAt(entry.at)}
                      {entry.kind !== "action" && <> · {OUTCOME_TEXT[entry.outcome]}</>}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            {runsHref && runIds.length > 0 && (
              <div className="mt-3 border-t border-border pt-2">
                {runIds.slice(0, 3).map((id, index) => (
                  <Link key={id} href={`${runsHref}/${id}`} className="block py-1 text-xs font-medium text-primary underline-offset-2 hover:underline">
                    Ver la corrida completa{runIds.length > 1 ? ` (${index + 1})` : ""}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </span>
  );
}
