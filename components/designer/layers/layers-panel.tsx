"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Eye, EyeOff, GripVertical, Image as ImageIcon, Lock, Shapes, Type, Unlock, Code, Square } from "lucide-react";
import type { DesignElement, DesignPage, HtmlElement } from "@/lib/designer/doc/schema";
import { htmlTextRows } from "@/lib/designer/screens/html-texts";
import { SHORTCUTS } from "@/lib/designer/screens/keyboard";
import type { HtmlTextTarget } from "@/lib/designer/screens/selection";
import { bringForward, layerRows, moveToRow, renameLayer, sendBackward, toggleHidden, toggleLocked } from "@/lib/designer/screens/layers";
import { cn } from "@/lib/utils";

const TYPE_ICON = { text: Type, image: ImageIcon, shape: Shapes, html: Code } as const;

/**
 * La pestaña Capas (F20): los elementos de la página con el de más adelante ARRIBA, ↑ ↓, ocultar, bloquear, renombrar con
 * doble clic y arrastrar para reordenar (HTML5 nativo; los botones ↑ ↓ son la alternativa con teclado). Abajo y fijo,
 * el Fondo, que siempre queda atrás. Tocar una capa la selecciona aunque esté tapada.
 *
 * Un HTML cargado lleva debajo sus textos (F42): tocar uno lo marca en el lienzo; doble clic lo deja escribir.
 */
export function LayersPanel({
  page,
  pageNumber,
  selectedIds,
  selectedText,
  labelFor,
  readOnly,
  onSelect,
  onSelectText,
  onEditText,
  onChange,
}: {
  page: DesignPage;
  pageNumber: number;
  selectedIds: readonly string[];
  /** El texto elegido de adentro de un HTML cargado. */
  selectedText: HtmlTextTarget | null;
  labelFor: (key: string) => string;
  readOnly: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onSelectText: (elId: string, tx: string) => void;
  onEditText: (elId: string, tx: string) => void;
  /** Los elementos de la página en su orden nuevo (o con su cambio). */
  onChange: (elements: DesignElement[]) => void;
}) {
  const rows = layerRows(page.elements, labelFor);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overRow, setOverRow] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  /** Los bloques HTML con la lista de textos cerrada (abierta por defecto). */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const renameRef = useRef<HTMLInputElement>(null);

  const bg = page.background;
  const background = bg.type === "image" ? "Imagen · siempre atrás y bloqueado" : bg.type === "gradient" ? "Degradé" : "Color liso";

  return (
    <div className="flex flex-col gap-3 p-3.5">
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Capas de la página {pageNumber}</h3>
        <p className="mt-1 text-xs text-muted-foreground">Arriba está lo que queda adelante. Tocá una capa para seleccionarla (aunque esté tapada por otra). Arrastrala para cambiar el orden.</p>
      </div>

      <ul className="overflow-hidden rounded-[10px] border border-border" aria-label="Capas">
        {rows.length === 0 && <li className="bg-card px-3 py-3 text-xs text-muted-foreground">Esta página no tiene elementos todavía. Sumá uno desde «Agregar».</li>}
        {rows.map((row, displayIndex) => {
          const Icon = TYPE_ICON[row.type] ?? Square;
          const selected = selectedIds.includes(row.id) && selectedText?.el !== row.id;
          const html = row.type === "html" ? (page.elements.find((e): e is HtmlElement => e.id === row.id && e.type === "html") ?? null) : null;
          const open = !collapsed.has(row.id);
          return (
            <Fragment key={row.id}>
            <li
              draggable={!readOnly && renaming !== row.id}
              onDragStart={(event) => {
                setDragId(row.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", row.id);
              }}
              onDragOver={(event) => {
                if (!dragId) return;
                event.preventDefault();
                setOverRow(displayIndex);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragId) onChange(moveToRow(page.elements, dragId, displayIndex));
                setDragId(null);
                setOverRow(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverRow(null);
              }}
              className={cn("flex items-center gap-1 border-b border-border bg-card px-1.5 py-1 text-[12.5px] last:border-b-0", selected && "bg-primary/10", dragId === row.id && "opacity-50", overRow === displayIndex && dragId !== row.id && "shadow-[inset_0_2px_0_var(--primary-edge)]")}
            >
              {!readOnly && <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/60" aria-hidden />}
              {html && (
                <button
                  type="button"
                  aria-label={open ? "Cerrar la lista de textos" : "Ver los textos"}
                  aria-expanded={open}
                  title={open ? "Cerrar la lista de textos" : "Ver los textos"}
                  onClick={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      return next;
                    })
                  }
                  className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
                </button>
              )}
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              {renaming === row.id ? (
                <input
                  ref={renameRef}
                  autoFocus
                  defaultValue={row.name}
                  aria-label="Nombre de la capa"
                  maxLength={120}
                  className="h-7 min-w-0 flex-1 rounded border border-primary-edge bg-background px-1.5 text-[12.5px] outline-none"
                  onBlur={(event) => {
                    onChange(renameLayer(page.elements, row.id, event.target.value));
                    setRenaming(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className={cn("min-w-0 flex-1 truncate rounded px-1 py-1 text-left", row.hidden && "text-muted-foreground line-through")}
                  aria-pressed={selected}
                  onClick={(event) => onSelect(row.id, event.shiftKey)}
                  onDoubleClick={() => !readOnly && setRenaming(row.id)}
                  title={readOnly ? row.name : `${row.name} · doble clic para renombrar`}
                >
                  {row.name}
                </button>
              )}
              {!readOnly && (
                <>
                  <IconButton label="Traer adelante" disabled={displayIndex === 0} onClick={() => onChange(bringForward(page.elements, row.id))}>
                    <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                  </IconButton>
                  <IconButton label="Enviar atrás" disabled={displayIndex === rows.length - 1} onClick={() => onChange(sendBackward(page.elements, row.id))}>
                    <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                  </IconButton>
                  <IconButton label={row.hidden ? "Mostrar" : "Ocultar"} onClick={() => onChange(toggleHidden(page.elements, row.id))}>
                    {row.hidden ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
                  </IconButton>
                  <IconButton label={row.locked ? "Desbloquear" : "Bloquear"} onClick={() => onChange(toggleLocked(page.elements, row.id))}>
                    {row.locked ? <Lock className="h-3.5 w-3.5" aria-hidden /> : <Unlock className="h-3.5 w-3.5" aria-hidden />}
                  </IconButton>
                </>
              )}
            </li>
            {html && open && (
              <HtmlTexts el={html} selectedTx={selectedText?.el === html.id ? selectedText.tx : null} labelFor={labelFor} readOnly={readOnly} onSelect={(tx) => onSelectText(html.id, tx)} onEdit={(tx) => onEditText(html.id, tx)} />
            )}
            </Fragment>
          );
        })}
        <li className="flex items-center gap-2 bg-muted px-3 py-2 text-[12.5px]">
          <Square className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0">
            <span className="block font-medium">Fondo</span>
            <span className="block text-xs text-muted-foreground">{background}</span>
          </span>
        </li>
      </ul>

      <div>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Atajos</h3>
        <ul className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          {SHORTCUTS.map((s) => (
            <li key={s.keys}>
              <kbd className="rounded border border-border bg-muted px-1 font-mono text-[11px]">{s.keys}</kbd> {s.does}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30">
      {children}
    </button>
  );
}

/** Los textos de un HTML cargado, debajo de su capa. Se arman de nuevo solo cuando cambia el HTML. */
function HtmlTexts({ el, selectedTx, labelFor, readOnly, onSelect, onEdit }: { el: HtmlElement; selectedTx: string | null; labelFor: (key: string) => string; readOnly: boolean; onSelect: (tx: string) => void; onEdit: (tx: string) => void }) {
  const rows = useMemo(() => htmlTextRows(el, labelFor), [el, labelFor]);
  if (rows.length === 0) return <li className="border-b border-border bg-card py-1.5 pl-9 pr-2 text-xs text-muted-foreground last:border-b-0">Este bloque no tiene textos para editar.</li>;
  return (
    <li className="border-b border-border bg-card last:border-b-0">
      <ul aria-label="Textos del bloque" className="max-h-72 overflow-y-auto py-0.5">
        {rows.map((row) => (
          <li key={row.tx} className={cn("flex items-center gap-1.5 py-0.5 pl-9 pr-2 text-[12.5px]", selectedTx === row.tx && "bg-primary/10")}>
            <Type className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
            <button
              type="button"
              aria-pressed={selectedTx === row.tx}
              className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left"
              onClick={() => onSelect(row.tx)}
              onDoubleClick={() => !readOnly && onEdit(row.tx)}
              title={readOnly ? row.name : `${row.name} · doble clic para editar`}
            >
              {row.name}
            </button>
          </li>
        ))}
      </ul>
    </li>
  );
}
