"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, Image as ImageIcon, Lock, Shapes, Type, Unlock, Code, Square } from "lucide-react";
import type { DesignElement, DesignPage } from "@/lib/designer/doc/schema";
import { SHORTCUTS } from "@/lib/designer/screens/keyboard";
import { bringForward, layerRows, moveToRow, renameLayer, sendBackward, toggleHidden, toggleLocked } from "@/lib/designer/screens/layers";
import { cn } from "@/lib/utils";

const TYPE_ICON = { text: Type, image: ImageIcon, shape: Shapes, html: Code } as const;

/**
 * La pestaña Capas (F20): los elementos de la página con el de más adelante ARRIBA, ↑ ↓, ocultar, bloquear, renombrar con
 * doble clic y arrastrar para reordenar (HTML5 nativo; los botones ↑ ↓ son la alternativa con teclado). Abajo y fijo,
 * el Fondo, que siempre queda atrás. Tocar una capa la selecciona aunque esté tapada.
 */
export function LayersPanel({
  page,
  pageNumber,
  selectedIds,
  labelFor,
  readOnly,
  onSelect,
  onChange,
}: {
  page: DesignPage;
  pageNumber: number;
  selectedIds: readonly string[];
  labelFor: (key: string) => string;
  readOnly: boolean;
  onSelect: (id: string, additive: boolean) => void;
  /** Los elementos de la página en su orden nuevo (o con su cambio). */
  onChange: (elements: DesignElement[]) => void;
}) {
  const rows = layerRows(page.elements, labelFor);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overRow, setOverRow] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
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
          const selected = selectedIds.includes(row.id);
          return (
            <li
              key={row.id}
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
