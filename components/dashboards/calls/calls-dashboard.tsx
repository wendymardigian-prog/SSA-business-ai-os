import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { DashboardSwitcher } from "@/components/dashboards/dashboard-switcher";
import { BarList } from "@/components/dashboards/charts";
import { CallsControls } from "./calls-controls";
import { callBadgeClass, scoreBadgeTone } from "@/lib/calls/badges";
import { humanize } from "@/lib/calls/format";
import type { DashboardOption } from "@/lib/dashboards/available";
import type { CloserSummary, CriterionAverage, Headline, ObjectionRow, QualificationMatrix, WeekPoint } from "@/lib/dashboards/calls";
import { NO_DATA_KEY, NO_DATA_LABEL } from "@/lib/dashboards/calls";

/**
 * El dashboard de Llamadas: como le va al equipo y a cada closer en las
 * llamadas analizadas. Solo pinta: todas las cuentas salen de
 * `lib/dashboards/calls.ts`. Es un Server Component: sin estado en el cliente.
 *
 * Cada seccion dice por que esta vacia y nunca muestra un cero inventado.
 */

const NUMBER = new Intl.NumberFormat("es-AR");
const QUAL_LABELS: Record<string, string> = { calificado: "Calificado", con_reservas: "Con reservas", no_calificado: "No calificado", [NO_DATA_KEY]: NO_DATA_LABEL };

const score = (v: number | null) => (v === null ? "—" : String(Math.round(v)));

export function CallsDashboard({
  dashboards,
  timezone,
  closers,
  headline,
  teamCriteria,
  closerRows,
  objections,
  matrix,
  weeks,
  periodLabel,
  closerFilterName,
  truncated,
  failed,
}: {
  dashboards: DashboardOption[];
  timezone: string;
  closers: Array<{ id: string; name: string }>;
  headline: Headline;
  teamCriteria: CriterionAverage[];
  closerRows: CloserSummary[];
  objections: ObjectionRow[];
  matrix: QualificationMatrix;
  weeks: WeekPoint[];
  periodLabel: string;
  closerFilterName: string | null;
  truncated: boolean;
  failed: boolean;
}) {
  const empty = headline.analyzed === 0;
  const cards: Array<{ label: string; value: string; hint?: string; tone?: Parameters<typeof scoreBadgeTone>[0] }> = [
    { label: "Llamadas analizadas", value: NUMBER.format(headline.analyzed) },
    { label: "Puntaje del closer", value: score(headline.avgCloserScore), hint: "Promedio de 0 a 100", tone: headline.avgCloserScore },
    { label: "Puntaje del lead", value: score(headline.avgLeadScore), hint: "Promedio de 0 a 100", tone: headline.avgLeadScore },
    { label: "Leads calificados", value: headline.qualifiedPct === null ? "—" : `${headline.qualifiedPct}%`, hint: "De los que tienen calificación" },
    { label: "Con alertas abiertas", value: NUMBER.format(headline.openAlerts) },
  ];

  return (
    <div className="flex h-full flex-col">
      <PageHeader route="/dashboard/dashboards/llamadas" left={<DashboardSwitcher options={dashboards} />} filters={<CallsControls timezone={timezone} closers={closers} />} />
      <div className="flex-1 space-y-6 overflow-auto px-4 py-6 md:px-8">
        <p className="text-sm text-muted-foreground">
          {periodLabel}
          {closerFilterName ? ` · ${closerFilterName}` : ""} · solo llamadas analizadas, por la fecha de la llamada
        </p>

        {failed && (
          <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            No pude leer las llamadas. Probá de nuevo en un rato; si sigue, avisá.
          </p>
        )}
        {truncated && (
          <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Este período tiene muchísimas llamadas y muestro las más recientes. Elegí uno más corto para ver todas.
          </p>
        )}

        {!failed && empty && (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Todavía no hay llamadas analizadas en este período. Probá con uno más largo, o analizá llamadas desde <Link href="/dashboard/llamadas" className="underline underline-offset-2">Llamadas</Link>.
          </p>
        )}

        {!failed && !empty && (
          <>
            <section aria-label="Resumen" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              {cards.map((c) => (
                <div key={c.label} className="rounded-xl border border-border p-3">
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                  <p className={`mt-1 inline-flex text-2xl font-semibold tabular-nums ${c.tone === undefined ? "" : callBadgeClass(scoreBadgeTone(c.tone))}`}>{c.value}</p>
                  {c.hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{c.hint}</p>}
                </div>
              ))}
            </section>

            <section aria-labelledby="criterios-title" className="space-y-2">
              <h2 id="criterios-title" className="text-sm font-semibold">Promedio por criterio (1 a 5)</h2>
              <BarList
                items={teamCriteria.map((c) => ({ key: c.code, label: c.name, value: c.avg, hint: `${c.calls} ${c.calls === 1 ? "llamada" : "llamadas"}` }))}
                emptyMessage="Todavía no hay criterios puntuados en este período."
              />
            </section>

            <section aria-labelledby="closers-title" className="space-y-2">
              <h2 id="closers-title" className="text-sm font-semibold">Cada closer y en qué enfocarse</h2>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[40rem] text-sm">
                  <caption className="sr-only">Llamadas analizadas, puntajes y el criterio más bajo de cada closer</caption>
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th scope="col" className="p-2 font-medium">Closer</th>
                      <th scope="col" className="p-2 text-right font-medium">Llamadas</th>
                      <th scope="col" className="p-2 text-right font-medium">Puntaje closer</th>
                      <th scope="col" className="p-2 text-right font-medium">Puntaje lead</th>
                      <th scope="col" className="p-2 font-medium">Foco</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closerRows.map((r) => (
                      <tr key={r.closerId} className="border-b border-border last:border-0">
                        <th scope="row" className="p-2 text-left font-normal">{r.name}</th>
                        <td className="p-2 text-right tabular-nums">{NUMBER.format(r.calls)}</td>
                        <td className="p-2 text-right tabular-nums">{score(r.avgCloserScore)}</td>
                        <td className="p-2 text-right tabular-nums">{score(r.avgLeadScore)}</td>
                        <td className="p-2">
                          {r.focus ? (
                            <span>
                              {r.focus.name} <span className="text-xs text-muted-foreground">· promedio {r.focus.avg} de 5 en {r.focus.calls} llamadas</span>
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Pocas llamadas para decir</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">El foco es el criterio más bajo con al menos 3 llamadas medidas: con menos sería opinar con un solo dato.</p>
            </section>

            <section aria-labelledby="objeciones-title" className="space-y-2">
              <h2 id="objeciones-title" className="text-sm font-semibold">Objeciones principales</h2>
              {objections.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">Ninguna llamada de este período tiene una objeción registrada.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full min-w-[24rem] text-sm">
                    <caption className="sr-only">Objeciones, cuántas llamadas y cuántas terminaron en venta</caption>
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th scope="col" className="p-2 font-medium">Objeción</th>
                        <th scope="col" className="p-2 text-right font-medium">Llamadas</th>
                        <th scope="col" className="p-2 text-right font-medium">Terminaron en venta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {objections.map((o) => (
                        <tr key={o.key} className="border-b border-border last:border-0">
                          <th scope="row" className="p-2 text-left font-normal">{o.label}</th>
                          <td className="p-2 text-right tabular-nums">{NUMBER.format(o.calls)}</td>
                          <td className="p-2 text-right tabular-nums">{NUMBER.format(o.sales)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section aria-labelledby="matriz-title" className="space-y-2">
              <h2 id="matriz-title" className="text-sm font-semibold">Calificación del lead × resultado</h2>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[30rem] text-sm">
                  <caption className="sr-only">Cuántas llamadas hay de cada calificación y cada resultado</caption>
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th scope="col" className="p-2 font-medium">Calificación</th>
                      {matrix.outcomes.map((o) => (
                        <th key={o} scope="col" className="p-2 text-right font-medium">{o === NO_DATA_KEY ? NO_DATA_LABEL : humanize(o)}</th>
                      ))}
                      <th scope="col" className="p-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.rows.map((r) => (
                      <tr key={r.qualification} className="border-b border-border last:border-0">
                        <th scope="row" className="p-2 text-left font-normal">{QUAL_LABELS[r.qualification] ?? humanize(r.qualification)}</th>
                        {matrix.outcomes.map((o) => (
                          <td key={o} className="p-2 text-right tabular-nums">{r.cells[o] ? NUMBER.format(r.cells[o]) : "—"}</td>
                        ))}
                        <td className="p-2 text-right font-medium tabular-nums">{NUMBER.format(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section aria-labelledby="semanas-title" className="space-y-2">
              <h2 id="semanas-title" className="text-sm font-semibold">Evolución del puntaje del closer, por semana</h2>
              <BarList
                items={weeks.map((w) => ({ key: w.weekStart, label: `Semana del ${w.weekStart.split("-").reverse().join("/")}`, value: w.avgCloserScore, hint: `${w.calls} ${w.calls === 1 ? "llamada" : "llamadas"}` }))}
                emptyMessage="Todavía no hay semanas con puntaje."
              />
              <p className="text-xs text-muted-foreground">Las semanas empiezan el lunes, en la zona horaria del negocio.</p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
