"use client";

import { useMemo } from "react";
import { CalendarDays } from "lucide-react";
import { count, ctrTone, leadsTone, money, percent, type AdsRow, type AdsTotals } from "@/lib/dashboards/ads";
import { dailyTableRows, type DailyRow } from "@/lib/dashboards/ads-view";
import { SortableTh, useSortable } from "./sortable";

/**
 * Metricas por dia: una fila por dia, ordenable por cualquier columna, con
 * la fila de total del periodo.
 *
 * El total de Frec., CTR, CPM, CPC y el alcance sale de `totals` (las cuentas
 * hechas sobre los totales del periodo y con el alcance unico), no de sumar ni
 * promediar las filas de arriba.
 */

const TD = "px-2 py-2 text-right text-foreground";

const COLUMNS: Array<{ label: string; key: keyof DailyRow }> = [
  { label: "Gasto", key: "spend" },
  { label: "Impr.", key: "impressions" },
  { label: "Alcance", key: "reach" },
  { label: "Frec.", key: "frequency" },
  { label: "Clics", key: "clicks" },
  { label: "CTR", key: "ctr" },
  { label: "CPM", key: "cpm" },
  { label: "CPC", key: "cpc" },
  { label: "Leads", key: "leads" },
];

/** "2026-10-09" → "09/10/2026". */
const showDate = (iso: string) => iso.split("-").reverse().join("/");

export function DailyTableCard({
  rows,
  totals,
  currency,
}: {
  /** Las filas diarias del objeto (cuenta, campaña, conjunto o anuncio). */
  rows: AdsRow[];
  totals: AdsTotals;
  currency: string | null;
}) {
  const data = useMemo(() => dailyTableRows(rows), [rows]);
  const { sorted, sortKey, sortDir, handleSort } = useSortable<DailyRow>(data, "date", "desc");
  const m = (value: number | null) => money(value, currency, { narrow: true });

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-3" aria-label="Métricas por día">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <CalendarDays className="h-4 w-4 text-primary" aria-hidden /> Métricas por día
      </h3>
      {sorted.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Sin datos para el período seleccionado</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <SortableTh<DailyRow> label="Fecha" sortKey="date" activeKey={sortKey} dir={sortDir} onSort={handleSort} right={false} />
                {COLUMNS.map((c) => (
                  <SortableTh<DailyRow> key={c.key} label={c.label} sortKey={c.key} activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => (
                <tr key={d.date} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-2 py-2 text-foreground">{showDate(d.date)}</td>
                  <td className={TD}>{m(d.spend)}</td>
                  <td className={TD}>{count(d.impressions)}</td>
                  <td className={TD}>{count(d.reach)}</td>
                  <td className={TD}>{d.frequency?.toFixed(2) ?? "—"}</td>
                  <td className={TD}>{count(d.clicks)}</td>
                  <td
                    className={`px-2 py-2 text-right ${
                      ctrTone(d.ctr) === "good" ? "text-green-600" : ctrTone(d.ctr) === "bad" ? "text-destructive" : "text-foreground"
                    }`}
                  >
                    {percent(d.ctr)}
                  </td>
                  <td className={TD}>{m(d.cpm)}</td>
                  <td className={TD}>{m(d.cpc)}</td>
                  <td className={`px-2 py-2 text-right ${leadsTone(d.leads) === "bad" ? "text-muted-foreground" : "font-semibold text-foreground"}`}>
                    {count(d.leads)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td className="px-2 py-2 text-foreground">Total</td>
                <td className={TD}>{m(totals.spend)}</td>
                <td className={TD}>{count(totals.impressions)}</td>
                <td className={TD}>{count(totals.reach)}</td>
                <td className={TD}>{totals.frequency?.toFixed(2) ?? "—"}</td>
                <td className={TD}>{count(totals.clicks)}</td>
                <td className={TD}>{percent(totals.ctr)}</td>
                <td className={TD}>{m(totals.cpm)}</td>
                <td className={TD}>{m(totals.cpc)}</td>
                <td className={TD}>{count(totals.leads)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
