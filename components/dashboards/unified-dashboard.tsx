"use client";

import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { DashboardSwitcher } from "./dashboard-switcher";
import { DualAxisChart, type ChartSeries } from "./charts";
import { count, money } from "@/lib/dashboards/ads";
import { comparison, type UnifiedView } from "@/lib/dashboards/unified";
import { PERIOD_LABELS, PERIOD_PRESETS, type PeriodPreset } from "@/lib/dashboards/period";

/**
 * El dashboard unificado (F59).
 *
 * Lo organico y lo pago del mismo periodo, uno al lado del otro. Lo que no
 * hay es una columna "total": el alcance organico y el pago se superponen y
 * Meta no dice cuanto, asi que sumarlos daria un numero que no existe.
 */
export function UnifiedDashboard({
  view,
  period,
  currency,
}: {
  view: UnifiedView;
  period: PeriodPreset;
  currency: string | null;
}) {
  const rows = comparison(view);

  const bars: ChartSeries[] = [
    {
      key: "organic",
      label: "Alcance organico",
      color: "#10b981",
      points: view.daily.map((d) => ({ bucket: d.date, value: d.organicReach })),
    },
    {
      key: "paid",
      label: "Alcance pago",
      color: "#6366f1",
      points: view.daily.map((d) => ({ bucket: d.date, value: d.paidReach })),
    },
  ];

  const lines: ChartSeries[] = [
    {
      key: "spend",
      label: "Gasto",
      color: "#f59e0b",
      points: view.daily.map((d) => ({ bucket: d.date, value: d.spend })),
    },
  ];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/dashboards/unified"
        left={<DashboardSwitcher available={["chat", "content", "ads", "unified"]} />}
        right={
          <select
            aria-label="Periodo"
            value={period}
            onChange={(e) => {
              const url = new URL(window.location.href);
              url.searchParams.set("periodo", e.target.value);
              window.location.href = url.toString();
            }}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          >
            {PERIOD_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {PERIOD_LABELS[preset]}
              </option>
            ))}
          </select>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {view.notices.length > 0 && (
          <ul className="mb-4 space-y-1">
            {view.notices.map((notice) => (
              <li key={notice} className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-sm">
                {notice}{" "}
                <Link
                  href="/dashboard/settings/integrations"
                  className="text-primary underline underline-offset-2"
                >
                  Integraciones
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className="p-2 font-medium">Metrica</th>
                <th scope="col" className="p-2 text-right font-medium">Organico</th>
                <th scope="col" className="p-2 text-right font-medium">Pago</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-border last:border-0">
                  <td className="p-2">
                    {row.label}
                    {row.note && (
                      <span className="block text-[11px] text-muted-foreground">{row.note}</span>
                    )}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {row.label === "Gasto" ? money(row.organic, currency) : count(row.organic)}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {row.label === "Gasto" ? money(row.paid, currency) : count(row.paid)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {view.costPerLead !== null && (
          <p className="mt-3 text-sm">
            Cada lead pago costo{" "}
            <span className="font-semibold">{money(view.costPerLead, currency)}</span>.
          </p>
        )}

        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">Dia a dia</h2>
          <DualAxisChart
            bars={bars}
            lines={lines}
            emptyMessage="Todavia no hay datos de ninguna de las dos fuentes en este periodo."
          />
        </section>
      </div>
    </div>
  );
}
