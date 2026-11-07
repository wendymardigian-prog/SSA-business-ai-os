"use client";

/**
 * Menú Exportar / Exportar prueba de la barra del editor (F46).
 *
 * PDF · Imágenes (ZIP) · Solo esta página (PNG). El archivo lo arma el servicio de render, así que se pide con
 * `requestExport` y se pregunta con `exportStatus` hasta que está; entonces se baja solo. Si tarda más de 3 s,
 * aviso «Preparando tu archivo…». Si falla, se dice el motivo (nunca queda esperando para siempre). Una página web
 * no se exporta: el botón queda deshabilitado con el motivo. En plantillas es «Exportar prueba», con datos de
 * ejemplo, y no crea ninguna generación ni link. Las decisiones salen de `exportMenuView` (puro, con su test).
 */

import { useEffect, useRef, useState } from "react";
import { Popover } from "@/components/ui/popover";
import { exportStatus, requestExport } from "@/lib/actions/designer/publish";
import type { ExportMenuProps } from "@/lib/designer/contracts";
import { PREPARING_NOTICE, PREPARING_NOTICE_MS, exportMenuView, exportProgress, pollDelayMs, type ExportItem } from "@/lib/designer/screens/export-menu";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const triggerClass =
  "inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/** Baja el archivo del link firmado de corta duración. */
function download(url: string, fileName: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function ExportMenu(props: ExportMenuProps) {
  const view = exportMenuView({ format: props.format, isTemplate: props.isTemplate, pageCount: props.pageCount, currentPage: props.currentPage });
  const [working, setWorking] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const running = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function start(item: ExportItem) {
    if (running.current) return;
    running.current = true;
    setError(null);
    setWorking(true);
    const startedAt = Date.now();
    const timer = setTimeout(() => setShowNotice(true), PREPARING_NOTICE_MS);
    const target = { ...props.target, exportKind: item.kind, ...(item.page !== undefined ? { page: item.page } : {}) };
    try {
      let result = await requestExport(target);
      let attempt = 0;
      for (;;) {
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (result.data.status === "ready") {
          download(result.data.url, result.data.fileName);
          return;
        }
        if (exportProgress(Date.now() - startedAt).giveUp) {
          setError("Está tardando más de lo normal. Probá de nuevo en unos minutos.");
          return;
        }
        await sleep(pollDelayMs(attempt++));
        if (!alive.current) return;
        result = await exportStatus({ ...target, stamp: result.data.stamp });
      }
    } catch {
      if (alive.current) setError("No se pudo preparar el archivo. Revisá tu conexión y probá de nuevo.");
    } finally {
      clearTimeout(timer);
      running.current = false;
      if (alive.current) {
        setWorking(false);
        setShowNotice(false);
      }
    }
  }

  return (
    <>
      {view.disabledReason ? (
        <button type="button" disabled title={view.disabledReason} aria-label={`${view.label}: ${view.disabledReason}`} className={triggerClass}>
          {view.label}
        </button>
      ) : (
        <Popover label={view.label} align="end" closeOnSelect panelClassName="w-72 p-2" triggerClassName={triggerClass} trigger={<>{working ? "Preparando…" : view.label} ▾</>}>
          <div className="flex flex-col gap-1">
            <h3 className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{view.header}</h3>
            {view.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void start(item)}
                disabled={working}
                className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {item.label}
              </button>
            ))}
            {view.note && <p className="px-2 pt-1 text-xs text-muted-foreground">{view.note}</p>}
          </div>
        </Popover>
      )}
      <div className="pointer-events-none fixed inset-x-3 top-3 z-[60] flex flex-col items-end gap-2 sm:left-auto sm:right-4 sm:w-80">
        {working && showNotice && (
          <p role="status" aria-live="polite" className="pointer-events-auto w-full rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg">
            {PREPARING_NOTICE}
          </p>
        )}
        {error && (
          <div role="alert" className="pointer-events-auto flex w-full items-start gap-2 rounded-lg border border-red-500/50 bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg">
            <span className="min-w-0 flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} className="shrink-0 text-xs font-medium underline">
              Cerrar
            </button>
          </div>
        )}
      </div>
    </>
  );
}
