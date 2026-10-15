"use client";

import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { saveStatusView, type SaveStatusInput } from "@/lib/content/save-status";
import { cn } from "@/lib/utils";

/**
 * El estado de guardado del drawer, siempre a la vista (cabecera).
 *
 * Guardado / Guardando… / Cambios sin guardar / No se pudo guardar. No es un
 * destello: se queda hasta que cambia la realidad. `role="status"` con
 * `aria-live="polite"` para que un lector de pantalla anuncie el cambio sin
 * interrumpir lo que se escribe. Lo que dice cada estado sale de
 * `saveStatusView` (puro, con su test).
 */
export function SaveIndicator({ status, onRetry }: { status: SaveStatusInput; onRetry: () => void }) {
  const view = saveStatusView(status);

  return (
    <span
      role="status"
      aria-live="polite"
      title={view.title}
      data-save-state={view.state}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium",
        view.state === "saved" && "text-muted-foreground",
        view.state === "saving" && "bg-muted text-muted-foreground",
        view.state === "unsaved" && "bg-amber-500/10 text-amber-700 dark:text-amber-300",
        view.state === "error" && "bg-red-500/10 text-red-700 dark:text-red-400",
      )}
    >
      {view.state === "saved" && <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />}
      {view.state === "saving" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
      {view.state === "unsaved" && <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />}
      {view.state === "error" && <AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
      <span className="hidden sm:inline">{view.label}</span>
      <span className="sr-only sm:hidden">{view.label}</span>
      {view.canRetry && (
        <button type="button" onClick={onRetry} className="underline underline-offset-2 hover:no-underline">
          Reintentar
        </button>
      )}
    </span>
  );
}
