"use client";

/**
 * El panel de una grabación sobre la lista de Grabaciones: abre en el momento (la lista no se vuelve a pedir al
 * servidor) y se cierra con la X, Esc o un clic afuera. Dentro va la misma ficha de la página (`CallDetail`), en una
 * sola columna. Mientras llega el detalle se ve un esqueleto; si no existe o no hay acceso, un aviso.
 */
import { useEffect } from "react";
import { X } from "lucide-react";
import { CallDetail, type CallPanelNav } from "@/components/calls/call-detail";
import type { LoadedCallDetail } from "@/lib/calls/load-detail";

const BACKDROP = "fixed inset-0 z-40 bg-black/40";
const PANEL = "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-card shadow-xl md:w-[min(52rem,92vw)]";

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

export function CallPanelSkeleton({ missing, onClose }: { missing: boolean; onClose: () => void }) {
  useEscape(onClose);
  return (
    <>
      <div className={BACKDROP} onClick={onClose} aria-hidden />
      <aside role="dialog" aria-label="Detalle de la grabación" aria-busy={!missing} className={PANEL}>
        <header className="flex items-start gap-2 border-b border-border p-4">
          <div className="min-w-0 flex-1 space-y-2">
            {missing ? <p className="font-semibold">No encontré esa grabación</p> : <div className="h-4 w-40 animate-pulse rounded bg-muted" />}
            {!missing && <div className="h-3 w-56 animate-pulse rounded bg-muted" />}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>
        <div className="flex flex-col gap-3 p-4">
          {missing ? (
            <p className="text-sm text-muted-foreground">Puede que se haya eliminado o que no tengas acceso a ella.</p>
          ) : (
            Array.from({ length: 6 }, (_, i) => <div key={i} className="h-4 animate-pulse rounded bg-muted" style={{ width: `${90 - i * 8}%` }} />)
          )}
        </div>
      </aside>
    </>
  );
}

export function CallPanel({ detail, nav }: { detail: LoadedCallDetail; nav: CallPanelNav }) {
  useEscape(nav.onClose);
  return (
    <>
      <div className={BACKDROP} onClick={nav.onClose} aria-hidden />
      <aside role="dialog" aria-label="Detalle de la grabación" className={PANEL}>
        <CallDetail key={detail.data.callId} data={detail.data} view={detail.view} canEdit={detail.canEdit} panel={nav} />
      </aside>
    </>
  );
}
