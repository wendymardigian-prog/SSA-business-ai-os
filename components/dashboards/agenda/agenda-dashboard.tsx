import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { DashboardSwitcher } from "@/components/dashboards/dashboard-switcher";
import { AgendaControls } from "./agenda-controls";
import type { DashboardOption } from "@/lib/dashboards/available";
import {
  AGENDA_AXES,
  AGENDA_DIMENSIONS,
  type AgendaAxis,
  type AgendaCards,
  type AgendaDimension,
  type AgendaGroupRow,
} from "@/lib/dashboards/agenda";

/**
 * El dashboard de Agenda: reuniones, quien agenda y de donde viene.
 *
 * Solo pinta: todas las cuentas salen de `lib/dashboards/agenda.ts`. Es un
 * Server Component: la tabla que se ve la elige el parametro `ver` de la URL
 * (cada pestaña es un link), asi no hace falta estado en el cliente.
 *
 * Cada seccion dice por que esta vacia, y la tabla aclara que cuenta: una
 * persona que agenda dos veces son dos agendas y un contacto.
 */

const NUMBER = new Intl.NumberFormat("es-AR");

export function AgendaDashboard({
  dashboards,
  timezone,
  cards,
  rows,
  dimension,
  axis,
  periodLabel,
  truncated,
  failed,
  preserved,
}: {
  dashboards: DashboardOption[];
  timezone: string;
  cards: AgendaCards;
  rows: AgendaGroupRow[];
  dimension: AgendaDimension;
  axis: AgendaAxis;
  periodLabel: string;
  truncated: boolean;
  failed: boolean;
  /** Los parametros de la URL que se conservan al cambiar de pestaña (periodo y eje). */
  preserved: Record<string, string>;
}) {
  const axisInfo = AGENDA_AXES.find((a) => a.value === axis)!;
  const dimensionLabel = AGENDA_DIMENSIONS.find((d) => d.value === dimension)!.label;
  const empty = cards.bookings === 0;

  const tabHref = (value: AgendaDimension) => {
    const params = new URLSearchParams(preserved);
    if (value !== "status") params.set("ver", value);
    const qs = params.toString();
    return qs ? `?${qs}` : "?";
  };

  const cardItems: Array<{ label: string; value: number; hint?: string }> = [
    { label: "Agendas", value: cards.bookings },
    { label: "Contactos que agendaron", value: cards.contacts, hint: "Personas distintas" },
    { label: "Canceladas", value: cards.cancelled },
    { label: "No asistieron", value: cards.noShow },
    { label: "Con resultado", value: cards.outcome, hint: "Venta, seguimiento o no califica" },
    { label: "Ventas", value: cards.sales },
  ];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/dashboards/agenda"
        left={<DashboardSwitcher options={dashboards} />}
        filters={<AgendaControls timezone={timezone} />}
      />
      <div className="flex-1 space-y-6 overflow-auto px-4 py-6 md:px-8">
        <p className="text-sm text-muted-foreground">
          {periodLabel} · {axisInfo.hint}
        </p>

        {failed && (
          <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            No pude leer las agendas. Probá de nuevo en un rato; si sigue, avisá.
          </p>
        )}

        {truncated && (
          <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Este período tiene muchísimas agendas y muestro las más recientes. Elegí uno más corto para ver todas.
          </p>
        )}

        {!failed && empty && (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No hay agendas en este período. Probá con uno más largo, o cambiá cómo se cuentan arriba.
          </p>
        )}

        {!failed && !empty && (
          <>
            <section aria-label="Resumen" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {cardItems.map((c) => (
                <div key={c.label} className="rounded-xl border border-border p-3">
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{NUMBER.format(c.value)}</p>
                  {c.hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{c.hint}</p>}
                </div>
              ))}
            </section>

            <section aria-label="Desglose" className="space-y-3">
              <nav aria-label="Desglosar por" className="flex flex-wrap gap-1.5">
                {AGENDA_DIMENSIONS.map((d) => (
                  <Link
                    key={d.value}
                    href={tabHref(d.value)}
                    scroll={false}
                    aria-current={d.value === dimension ? "page" : undefined}
                    className={
                      d.value === dimension
                        ? "rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
                        : "rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
                    }
                  >
                    {d.label}
                  </Link>
                ))}
              </nav>

              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[34rem] text-sm">
                  <caption className="sr-only">Agendas por {dimensionLabel.toLowerCase()}</caption>
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th scope="col" className="p-2 font-medium">{dimensionLabel}</th>
                      <th scope="col" className="p-2 text-right font-medium">Agendas</th>
                      <th scope="col" className="p-2 text-right font-medium">Contactos</th>
                      <th scope="col" className="p-2 text-right font-medium">Canceladas</th>
                      <th scope="col" className="p-2 text-right font-medium">No asistieron</th>
                      <th scope="col" className="p-2 text-right font-medium">Con resultado</th>
                      <th scope="col" className="p-2 text-right font-medium">Ventas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key} className="border-b border-border last:border-0">
                        <th scope="row" className="p-2 text-left font-normal">{r.label}</th>
                        <td className="p-2 text-right tabular-nums">{NUMBER.format(r.bookings)}</td>
                        <td className="p-2 text-right tabular-nums">{NUMBER.format(r.contacts)}</td>
                        <td className="p-2 text-right tabular-nums">{NUMBER.format(r.cancelled)}</td>
                        <td className="p-2 text-right tabular-nums">{NUMBER.format(r.noShow)}</td>
                        <td className="p-2 text-right tabular-nums">{NUMBER.format(r.outcome)}</td>
                        <td className="p-2 text-right tabular-nums">{NUMBER.format(r.sales)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border bg-muted/40 font-medium">
                      <th scope="row" className="p-2 text-left">Total</th>
                      <td className="p-2 text-right tabular-nums">{NUMBER.format(cards.bookings)}</td>
                      <td className="p-2 text-right tabular-nums">{NUMBER.format(cards.contacts)}</td>
                      <td className="p-2 text-right tabular-nums">{NUMBER.format(cards.cancelled)}</td>
                      <td className="p-2 text-right tabular-nums">{NUMBER.format(cards.noShow)}</td>
                      <td className="p-2 text-right tabular-nums">{NUMBER.format(cards.outcome)}</td>
                      <td className="p-2 text-right tabular-nums">{NUMBER.format(cards.sales)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                Cada fila cuenta agendas. «Contactos» son personas distintas en esa fila: una persona que agendó dos veces en
                dos orígenes aparece en las dos, por eso esa columna no suma al total. Lo que no tiene dato va a «Sin asignar».
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
