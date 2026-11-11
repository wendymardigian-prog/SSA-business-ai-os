"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { columnWidth, resetColumnWidth, setColumnWidth, visibleColumns, type ColumnMeta } from "@/lib/ui/data-table/prefs";
import { splitPinned, stickyOffsets } from "@/lib/ui/data-table/sticky";
import { ResizeHandle } from "./resize-handle";
import type { TablePrefsState } from "./use-table-prefs";

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
}

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
}) {
  const { prefs } = state;
  const [live, setLive] = useState<{ key: string; width: number } | null>(null);

  const ordered = useMemo(() => visibleColumns(columns, prefs), [columns, prefs]);
  const { pinned, rest } = useMemo(() => splitPinned(ordered, prefs.pinned), [ordered, prefs.pinned]);
  const shown = useMemo(() => [...pinned, ...rest], [pinned, rest]);

  const widthOf = (column: DataColumn<Row>) => (live && live.key === column.key ? live.width : columnWidth(column, prefs));
  const widths = shown.map(widthOf);
  const total = widths.reduce((sum, width) => sum + width, 0);
  const offsets = stickyOffsets(widths.slice(0, pinned.length));

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
          {shown.map((column, index) => (
            <col key={column.key} style={{ width: widths[index] }} />
          ))}
        </colgroup>
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            {shown.map((column, index) => (
              <th
                key={column.key}
                scope="col"
                title={column.hint}
                style={stickyStyle(index)}
                className={`whitespace-nowrap px-3 py-2 font-medium ${HEADER_BG} ${column.align === "right" ? "text-right" : ""} ${index < pinned.length ? `sticky z-[2] ${index === pinned.length - 1 ? PIN_EDGE : ""}` : "relative"}`}
              >
                <span className="block truncate">{column.label}</span>
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
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="group hover:bg-muted/30">
              {shown.map((column, index) => (
                <td
                  key={column.key}
                  style={stickyStyle(index)}
                  className={`overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 ${column.align === "right" ? "text-right tabular-nums" : ""} ${pinClass(index, "bg-card group-hover:bg-muted")} ${column.cellClassName ?? ""}`}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {hasTotals && (
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
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
