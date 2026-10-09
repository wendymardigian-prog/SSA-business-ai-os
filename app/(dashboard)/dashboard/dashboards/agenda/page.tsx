import { requirePermission } from "@/lib/auth/guards";
import { availableDashboards } from "@/lib/dashboards/available";
import { AgendaDashboard } from "@/components/dashboards/agenda/agenda-dashboard";
import { computeCards, groupBookings, isAgendaDimension, parseAxis, DEFAULT_DIMENSION } from "@/lib/dashboards/agenda";
import { loadAgendaRows } from "@/lib/dashboards/agenda-load";
import { PERIOD_LABELS, resolvePeriod } from "@/lib/dashboards/period";
import { parsePeriodFilter } from "@/lib/agent/ai-dashboard/url-state";
import { hostNames } from "@/lib/scheduling/data/bookings";
import { formatRange, isoRangeToCivil } from "@/lib/dashboards/chat/date-range";
import { resolveViewerTimezone } from "@/lib/user-timezone";

export const dynamic = "force-dynamic";

/**
 * Dashboard de Agenda: reuniones, quien agenda y de donde viene.
 *
 * Pide `dashboards.agenda.view`. Lee con el cliente del usuario, asi la RLS de
 * `bookings` decide que ve cada quien: un Member con alcance propio ve solo
 * las reuniones donde es anfitrion.
 */
export default async function AgendaDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePermission("dashboards.agenda.view");
  const { workspace, supabase } = ctx;
  const dashboards = availableDashboards(ctx.can);
  const sp = await searchParams;

  const urlParams = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") urlParams.set(k, v);

  const filter = parsePeriodFilter(urlParams);
  const axis = parseAxis(sp.eje);
  const dimension = isAgendaDimension(sp.ver) ? sp.ver : DEFAULT_DIMENSION;

  const timeZone = await resolveViewerTimezone(workspace.timezone);
  const range = filter.from && filter.to ? { from: filter.from, to: filter.to } : resolvePeriod(filter.period, new Date(), timeZone);

  const [{ rows, truncated, failed }, hosts] = await Promise.all([
    loadAgendaRows(supabase, { workspaceId: workspace.id, range, axis }),
    hostNames(workspace.id),
  ]);

  // La etiqueta del periodo: el atajo, o el rango a medida escrito en limpio.
  const custom = filter.from && filter.to ? isoRangeToCivil(filter.from, filter.to, timeZone) : null;
  const periodLabel = custom ? formatRange(custom) : PERIOD_LABELS[filter.period];

  // Solo se conservan en los links de las pestañas el periodo y el eje.
  const preserved: Record<string, string> = {};
  for (const key of ["range", "from", "to", "eje"]) {
    const value = urlParams.get(key);
    if (value) preserved[key] = value;
  }

  return (
    <AgendaDashboard
      dashboards={dashboards}
      timezone={timeZone}
      cards={computeCards(rows)}
      rows={groupBookings(rows, dimension, hosts)}
      dimension={dimension}
      axis={axis}
      periodLabel={periodLabel}
      truncated={truncated}
      failed={failed}
      preserved={preserved}
    />
  );
}
