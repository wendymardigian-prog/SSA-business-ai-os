"use client";

import { memo, useDeferredValue, useMemo, useState } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import { LiveThumb } from "@/components/designer/list/live-thumb";
import { Popover } from "@/components/ui/popover";
import type { DesignDoc, DesignPage } from "@/lib/designer/doc/schema";
import type { UploadedFont } from "@/lib/designer/fonts";
import { canAddPage, pageLabel, pageMenuActions, type PageMenuAction } from "@/lib/designer/screens/pages";
import { qaBadge, type QaBadge } from "@/lib/designer/screens/thumbs";
import type { CustomVar } from "@/lib/designer/variables/catalog";
import { cn } from "@/lib/utils";

/** La miniatura de UNA página, en vivo; se vuelve a dibujar solo cuando esa página cambia (con una pequeña demora al arrastrar). */
const StripThumb = memo(function StripThumb({ page, format, assetUrls, uploadedFonts, customVars, label, qa }: { page: DesignPage; format: DesignDoc["format"]; assetUrls: Readonly<Record<string, string>>; uploadedFonts: readonly UploadedFont[]; customVars: readonly CustomVar[]; label: string; qa: QaBadge | null }) {
  const deferred = useDeferredValue(page);
  const single = useMemo<DesignDoc>(() => ({ v: 1, format, pages: [deferred] }), [deferred, format]);
  return <LiveThumb doc={single} box={{ width: 90, height: 64 }} assetUrls={assetUrls} uploadedFonts={uploadedFonts} customVars={customVars} label={label} qa={qa} />;
});

/**
 * La tira de páginas de abajo del lienzo (F25): seleccionar, arrastrar para reordenar (HTML5; el menú «⋯» con «Mover a la
 * izquierda / derecha» es la alternativa con teclado), «+» (una página en blanco con el fondo de la anterior) y el menú de
 * cada página (duplicar, mover, eliminar). Máximo 20 páginas. Una página web no tiene tira.
 */
export function PageStrip({
  doc,
  current,
  assetUrls,
  uploadedFonts,
  customVars,
  lastQa,
  readOnly,
  onSelect,
  onAdd,
  onMenu,
  onMove,
}: {
  doc: DesignDoc;
  current: number;
  assetUrls: Readonly<Record<string, string>>;
  uploadedFonts: readonly UploadedFont[];
  customVars: readonly CustomVar[];
  /** `designs.last_qa` (lo que dejó la revisión automática de la IA): la página con algo para mirar lleva un punto ámbar. */
  lastQa?: unknown;
  readOnly: boolean;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onMenu: (action: PageMenuAction["id"], index: number) => void;
  onMove: (from: number, to: number) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  return (
    <nav aria-label="Páginas" className="flex shrink-0 items-center gap-2.5 overflow-x-auto border-t border-border bg-card px-3 py-2.5">
      {doc.pages.map((page, index) => (
        <div
          key={page.id}
          draggable={!readOnly}
          onDragStart={(event) => {
            setDragIndex(index);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", String(index));
          }}
          onDragOver={(event) => {
            if (dragIndex === null) return;
            event.preventDefault();
            setOverIndex(index);
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (dragIndex !== null && dragIndex !== index) onMove(dragIndex, index);
            setDragIndex(null);
            setOverIndex(null);
          }}
          onDragEnd={() => {
            setDragIndex(null);
            setOverIndex(null);
          }}
          className={cn("group relative shrink-0 rounded-md border-2 p-0.5", index === current ? "border-primary-edge" : "border-transparent", dragIndex === index && "opacity-50", overIndex === index && dragIndex !== index && "shadow-[-3px_0_0_var(--primary-edge)]")}
        >
          <button type="button" onClick={() => onSelect(index)} aria-current={index === current} aria-label={pageLabel(doc, index)} className="block">
            <span className="absolute left-1 top-0.5 z-10 rounded bg-black/55 px-1 text-[10px] font-bold text-white">{index + 1}</span>
            <StripThumb page={page} format={doc.format} assetUrls={assetUrls} uploadedFonts={uploadedFonts} customVars={customVars} label={pageLabel(doc, index)} qa={qaBadge(lastQa, index)} />
          </button>
          {!readOnly && (
            <div className="absolute right-0.5 top-0.5 z-10 opacity-0 focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100">
              <Popover label={`Acciones de la página ${index + 1}`} trigger={<MoreHorizontal className="h-3.5 w-3.5" aria-hidden />} panelClassName="w-48 p-1" triggerClassName="grid h-5 w-5 place-items-center rounded bg-card/90 text-foreground shadow hover:bg-accent" closeOnSelect>
                <div className="flex flex-col text-sm">
                  {pageMenuActions(doc, index).map((action) => (
                    <button key={action.id} type="button" disabled={!action.enabled} title={action.reason ?? undefined} onClick={() => onMenu(action.id, index)} className={cn("rounded-md px-2.5 py-1.5 text-left hover:bg-accent disabled:opacity-40", action.id === "delete" && "text-bad")}>
                      {action.label}
                    </button>
                  ))}
                </div>
              </Popover>
            </div>
          )}
        </div>
      ))}
      {!readOnly && canAddPage(doc) && (
        <button type="button" onClick={onAdd} aria-label="Agregar una página" title="Agregar una página" className="grid h-[54px] w-[54px] shrink-0 place-items-center rounded-lg border border-dashed border-border text-muted-foreground hover:bg-accent">
          <Plus className="h-5 w-5" aria-hidden />
        </button>
      )}
    </nav>
  );
}
