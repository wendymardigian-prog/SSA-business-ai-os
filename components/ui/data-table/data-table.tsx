"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { columnWidth, resetColumnWidth, setColumnWidth, visibleColumns, type ColumnMeta } from "@/lib/ui/data-table/prefs";
import { selectionState, toggleAllVisible, toggleRow } from "@/lib/ui/data-table/selection";
import { splitPinned, stickyOffsets } from "@/lib/ui/data-table/sticky";
import { ClickableTr } from "@/components/ui/clickable-row";
import { cn } from "@/lib/utils";
import { ariaSort, type TableSort } from "@/lib/ui/data-table/sort";
import { ResizeHandle } from "./resize-handle";
import type { TablePrefsState } from "./use-table-prefs";
import { Tip } from "@/components/ui/tooltip";

/**
 * LA tabla del sistema. Toda tabla con columnas nueva se arma con esto (ver docs/tablas.md): da, sin que la pantalla
 * programe nada, columnas que se prenden y apagan, se reordenan, se fijan a la izquierda y se ensanchan arrastrando el
 * borde, y una fila de totales al final.
 *
 * Qué columnas se ven, su orden, sus anchos y cuáles están fijas sale de `state` (`useTablePrefs`), que comparte la
 * pantalla con el menú «Columnas» y el menú de vistas. La tabla solo dibuja.
 *
 * El ancho de cada columna es exacto (`table-layout: fixed`): así las columnas fijas saben dónde empiezan sin medir nada.
 */

export interface DataColumn<Row> extends ColumnMeta {
  align?: "left" | "right";
  /** El contenido de la celda. */
  render: (row: Row) => ReactNode;
  /** Clases extra de la celda (por ejemplo el tono del texto). */
  cellClassName?: string;
  /** Aclaración del encabezado (al pasar el mouse). */
  hint?: string;
  /** Se ordena con un clic en el título. Solo tiene efecto si la tabla recibe `onSortChange`. */
  sortable?: boolean;
  /** El contenido puede ocupar varias líneas (nombre con insignias, etiquetas, dos datos). Por defecto, una línea con «…». */
  wrap?: boolean;
}

/** Filas agrupadas: cada grupo con su título (y un dato a la derecha, por ejemplo el subtotal) adentro de la misma tabla. */
export interface DataTableGroup<Row> {
  key: string;
  label: ReactNode;
  aside?: ReactNode;
  rows: readonly Row[];
}

/**
 * Elegir filas (opcional, apagado por defecto): una columna de casillas a la izquierda, fuera de las preferencias de
 * columnas. La pantalla guarda lo elegido y decide qué hacer con eso (por ejemplo «Eliminar seleccionadas»).
 */
export interface DataTableSelection<Row> {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** Cómo se nombra la fila para un lector de pantalla («Elegir la venta de Ana»). */
  rowLabel?: (row: Row) => string;
  /** Una fila que no se puede elegir (su casilla queda apagada y la del encabezado no la cuenta). Por defecto, todas se pueden. */
  isSelectable?: (row: Row) => boolean;
  /** Por qué no se puede elegir (al pasar el mouse). */
  disabledReason?: (row: Row) => string | null;
}

const SELECT_WIDTH = 40;

const HEADER_BG = "bg-[color-mix(in_srgb,var(--color-muted)_40%,var(--color-card))]";
const PIN_EDGE = "shadow-[6px_0_6px_-6px_rgba(0,0,0,0.35)]";

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  state,
  totals,
  totalsLabel = "Total",
  className = "",
  caption,
  selection,
  rowHref,
  onRowClick,
  beforeRowNavigate,
  sort,
  onSortChange,
  rowClassName,
  groups,
}: {
  columns: readonly DataColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  state: TablePrefsState;
  /** El contenido del pie por clave de columna. Una columna sin entrada queda vacía. Calculado sobre TODO el filtro, no sobre la página. */
  totals?: Record<string, ReactNode>;
  totalsLabel?: string;
  /** Para ocultarla en el celular (`hidden md:block`) cuando la pantalla arma tarjetas aparte. */
  className?: string;
  caption?: string;
  /** Casillas para elegir filas. Sin esto, la tabla es exactamente la de siempre. */
  selection?: DataTableSelection<Row>;
  /** La dirección que abre la fila entera (Cmd/Ctrl + clic: otra pestaña). Sin esto ni `onRowClick`, la fila no se abre. */
  rowHref?: (row: Row) => string | null;
  /** Lo que hace un clic en la fila cuando no es una dirección (abrir un diálogo). Gana sobre `rowHref`. */
  onRowClick?: (row: Row) => void;
  /** Antes de navegar a `rowHref` (recordar la fila que abrió un modal por URL, para devolverle el foco). */
  beforeRowNavigate?: (element: HTMLElement) => void;
  /** El orden actual (lo decide la pantalla: en la consulta, en la URL…). */
  sort?: TableSort | null;
  /** Clic en el título de una columna `sortable`. Sin esto, ningún título se ordena y la tabla es la de siempre. */
  onSortChange?: (key: string) => void;
  /** Clases extra de una fila (atenuar una archivada o anulada, marcar la elegida). */
  rowClassName?: (row: Row) => string | undefined;
  /** Filas agrupadas con su título; reemplaza a `rows` (que entonces puede ir vacío). Los grupos sin filas no se dibujan. */
  groups?: readonly DataTableGroup<Row>[];
}) {
  const { prefs } = state;
  const [live, setLive] = useState<{ key: string; width: number } | null>(null);

  const ordered = useMemo(() => visibleColumns(columns, prefs), [columns, prefs]);
  const { pinned, rest } = useMemo(() => splitPinned(ordered, prefs.pinned), [ordered, prefs.pinned]);
  const shown = useMemo(() => [...pinned, ...rest], [pinned, rest]);

  const widthOf = (column: DataColumn<Row>) => (live && live.key === column.key ? live.width : columnWidth(column, prefs));
  const widths = shown.map(widthOf);
  const selectWidth = selection ? SELECT_WIDTH : 0;
  const total = widths.reduce((sum, width) => sum + width, selectWidth);
  const offsets = stickyOffsets(widths.slice(0, pinned.length), selectWidth);
  const sections = useMemo(() => (groups ? groups.filter((g) => g.rows.length > 0) : [{ key: "", label: null, aside: undefined, rows }]), [groups, rows]);
  const isSelectable = selection?.isSelectable;
  const visibleIds = useMemo(() => sections.flatMap((s) => s.rows.filter((r) => !isSelectable || isSelectable(r)).map(rowKey)), [sections, rowKey, isSelectable]);
  const allState = selection ? selectionState(selection.selected, visibleIds) : "none";
  // La casilla de la columna de casillas queda pegada a la izquierda solo si hay columnas fijas.
  const selectSticky = pinned.length > 0 ? "sticky left-0 z-[2]" : "";

  const stickyStyle = (index: number): CSSProperties | undefined => (index < pinned.length ? { left: offsets[index] } : undefined);
  const pinClass = (index: number, bg: string) => (index < pinned.length ? `sticky z-[1] ${bg} ${index === pinned.length - 1 ? PIN_EDGE : ""}` : "");

  const hasTotals = !!totals && shown.some((c) => totals[c.key] !== undefined);
  // «Total» va en la primera columna, salvo que esa columna tenga su propio total.
  const labelKey = hasTotals && totals && shown[0] && totals[shown[0].key] === undefined ? shown[0].key : null;

  return (
    <div className={`overflow-x-auto rounded-xl border border-border ${className}`}>
      <table className="text-sm" style={{ tableLayout: "fixed", width: "100%", minWidth: total }}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <colgroup>
          {selection && <col style={{ width: SELECT_WIDTH }} />}
          {shown.map((column, index) => (
            <col key={column.key} style={{ width: widths[index] }} />
          ))}
        </colgroup>
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            {selection && (
              <th scope="col" className={`px-3 py-2 ${HEADER_BG} ${selectSticky}`}>
                <HeaderCheckbox
                  state={allState}
                  disabled={visibleIds.length === 0}
                  onToggle={() => selection.onChange(toggleAllVisible(selection.selected, visibleIds))}
                />
              </th>
            )}
            {shown.map((column, index) => (
              <Tip key={column.key} asChild content={column.hint}>
                <th
                  scope="col"
                  aria-sort={onSortChange && column.sortable ? ariaSort(sort, column.key) : undefined}
                  style={stickyStyle(index)}
                  className={`whitespace-nowrap px-3 py-2 font-medium ${HEADER_BG} ${column.align === "right" ? "text-right" : ""} ${index < pinned.length ? `sticky z-[2] ${index === pinned.length - 1 ? PIN_EDGE : ""}` : "relative"}`}
                >
                  {onSortChange && column.sortable ? (
                    <SortButton column={column} sort={sort} onClick={() => onSortChange(column.key)} />
                  ) : (
                    <span className="block truncate">{column.label}</span>
                  )}
                  {column.resizable !== false && (
                    <ResizeHandle
                      label={column.label || "la columna"}
                      width={widths[index]}
                      onLive={(px) => setLive(px === null ? null : { key: column.key, width: px })}
                      onCommit={(px) => {
                        setLive(null);
                        state.update((current) => setColumnWidth(columns, current, column.key, px));
                      }}
                      onReset={() => {
                        setLive(null);
                        state.update((current) => resetColumnWidth(current, column.key));
                      }}
                    />
                  )}
                </th>
              </Tip>
            ))}
          </tr>
        </thead>
        {sections.map((section) => (
          <tbody key={section.key} className="divide-y divide-border border-t border-border first-of-type:border-t-0">
            {groups && (
              <tr>
                <th scope="rowgroup" colSpan={shown.length + (selection ? 1 : 0)} className={`px-3 py-2 text-left text-xs font-semibold ${HEADER_BG}`}>
                  <span className="sticky left-3 inline-flex max-w-full items-center gap-3">
                    <span className="truncate">{section.label}</span>
                    {section.aside !== undefined && <span className="shrink-0 font-normal text-muted-foreground">{section.aside}</span>}
                  </span>
                </th>
              </tr>
            )}
            {section.rows.map((row) => (
              <BodyRow key={rowKey(row)} href={rowHref?.(row) ?? null} onOpen={onRowClick ? () => onRowClick(row) : undefined} beforeNavigate={beforeRowNavigate} className={rowClassName?.(row)}>
                {selection && (
                  <td className={`px-3 py-2 ${pinned.length > 0 ? "sticky left-0 z-[1] bg-card group-hover:bg-muted" : ""}`} onClick={(e) => e.stopPropagation()}>
                    <SelectBox row={row} id={rowKey(row)} selection={selection} />
                  </td>
                )}
                {shown.map((column, index) => (
                  <td
                    key={column.key}
                    style={stickyStyle(index)}
                    className={cn(
                      "px-3 py-2",
                      column.wrap ? "whitespace-normal break-words" : "overflow-hidden text-ellipsis whitespace-nowrap",
                      column.align === "right" && "text-right tabular-nums",
                      pinClass(index, "bg-card group-hover:bg-muted"),
                      column.cellClassName,
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </BodyRow>
            ))}
          </tbody>
        ))}
        {hasTotals && (
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              {selection && <td className={`${HEADER_BG} ${pinned.length > 0 ? "sticky left-0 z-[1]" : ""}`} />}
              {shown.map((column, index) => (
                <td
                  key={column.key}
                  style={stickyStyle(index)}
                  className={`overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 ${HEADER_BG} ${column.align === "right" ? "text-right tabular-nums" : ""} ${index < pinned.length ? `sticky z-[1] ${index === pinned.length - 1 ? PIN_EDGE : ""}` : ""}`}
                >
                  {column.key === labelKey ? totalsLabel : (totals?.[column.key] ?? null)}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** Una fila del cuerpo: con `href` u `onOpen`, toda la fila abre el registro (ver `useRowOpen`). */
function BodyRow({ href, onOpen, beforeNavigate, className, children }: { href: string | null; onOpen?: () => void; beforeNavigate?: (element: HTMLElement) => void; className?: string; children: ReactNode }) {
  return (
    <ClickableTr href={href} onOpen={onOpen} beforeNavigate={beforeNavigate} className={cn("group hover:bg-muted/30", className)}>
      {children}
    </ClickableTr>
  );
}

/** La casilla de una fila: apagada (con el motivo) si la fila no se puede elegir. */
function SelectBox<Row>({ row, id, selection }: { row: Row; id: string; selection: DataTableSelection<Row> }) {
  const selectable = !selection.isSelectable || selection.isSelectable(row);
  const reason = selectable ? null : (selection.disabledReason?.(row) ?? null);
  return (
    // Sin `asChild`: el motivo explica por qué la casilla está apagada, y una casilla apagada no recibe eventos.
    <Tip content={reason}>
      <span>
        <input
          type="checkbox"
          className="h-4 w-4 cursor-pointer align-middle disabled:cursor-not-allowed"
          checked={selection.selected.has(id)}
          disabled={!selectable}
          onChange={() => selection.onChange(toggleRow(selection.selected, id))}
          aria-label={reason ? `No se puede elegir: ${reason}` : (selection.rowLabel?.(row) ?? "Elegir la fila")}
        />
      </span>
    </Tip>
  );
}

/** La casilla del encabezado: elige o suelta todas las filas a la vista; a medias se ve «indeterminada». */
function HeaderCheckbox({ state, disabled, onToggle }: { state: "none" | "some" | "all"; disabled: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="h-4 w-4 cursor-pointer align-middle"
      checked={state === "all"}
      disabled={disabled}
      onChange={onToggle}
      aria-label={state === "all" ? "Soltar todas las filas de esta página" : "Elegir todas las filas de esta página"}
    />
  );
}

/** El título de una columna ordenable: la etiqueta y una flechita con el sentido (tenue si no es la columna del orden). */
function SortButton({ column, sort, onClick }: { column: ColumnMeta & { align?: "left" | "right" }; sort: TableSort | null | undefined; onClick: () => void }) {
  const active = sort?.key === column.key;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Ordenar por ${column.label}`}
      className={`inline-flex max-w-full items-center gap-1 rounded hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${column.align === "right" ? "flex-row-reverse" : ""} ${active ? "text-foreground" : ""}`}
    >
      <span className="truncate">{column.label}</span>
      <Icon className={`h-3 w-3 shrink-0 ${active ? "" : "opacity-40"}`} aria-hidden />
    </button>
  );
}
