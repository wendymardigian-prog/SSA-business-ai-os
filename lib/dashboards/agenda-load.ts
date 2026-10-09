/**
 * Lee las agendas del dashboard de Agenda.
 *
 * Con el cliente del USUARIO, no el service role: la RLS de `bookings` decide
 * que ve cada quien (un Member con alcance propio solo ve las reuniones donde
 * es anfitrion, igual que en la pantalla de Agenda).
 *
 * Lee solo las columnas que usan las cuentas (`lib/dashboards/agenda.ts`), por
 * paginas de 1000 (el tope de una respuesta) hasta un techo. Si el periodo
 * tiene mas que el techo, devuelve las mas recientes y lo avisa con
 * `truncated`: la pantalla lo dice en vez de mostrar un total que parece
 * completo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { AgendaAxis, AgendaBooking } from "./agenda";
import type { ResolvedPeriod } from "./period";

type Db = SupabaseClient<Database>;

const PAGE = 1000;
/** 20 paginas = 20.000 agendas por periodo: muy por encima de lo que maneja una agencia. */
export const MAX_PAGES = 20;

const COLUMNS = "id, contact_id, status, status_group, host_user_id, origin, category_snapshot, utm";

export async function loadAgendaRows(
  supabase: Db,
  args: { workspaceId: string; range: ResolvedPeriod; axis: AgendaAxis },
): Promise<{ rows: AgendaBooking[]; truncated: boolean; failed: boolean }> {
  const column = args.axis === "start" ? "start_at" : "created_at";
  const rows: AgendaBooking[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    let q = supabase.from("bookings").select(COLUMNS).eq("workspace_id", args.workspaceId);
    if (args.range.from) q = q.gte(column, args.range.from);
    if (args.range.to) q = q.lte(column, args.range.to);

    // Orden estable (la fecha y el id) para que dos paginas no repitan ni se salteen filas.
    const { data, error } = await q
      .order(column, { ascending: false })
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);

    if (error) {
      console.error("[dashboard-agenda] no pude leer las agendas:", error.message);
      // Con una falla se avisa; mostrar lo que alcanzo a leer como si fuera todo seria mentir.
      return { rows: [], truncated: false, failed: true };
    }

    for (const r of data ?? []) {
      rows.push({
        id: r.id,
        contactId: r.contact_id,
        status: r.status,
        statusGroup: r.status_group,
        hostUserId: r.host_user_id,
        origin: r.origin,
        categorySnapshot: r.category_snapshot,
        utm: r.utm,
      });
    }

    if ((data?.length ?? 0) < PAGE) return { rows, truncated: false, failed: false };
  }

  return { rows, truncated: true, failed: false };
}
