/**
 * Lee las llamadas analizadas del dashboard de Llamadas (F33).
 *
 * Con el cliente del USUARIO, no el service role: la RLS de `calls`
 * (`can_see_call`) decide que ve cada quien. Un Member con alcance propio ve los
 * numeros de lo suyo, igual que en la lista de Llamadas.
 *
 * Lee solo las columnas que usan las cuentas, mas la rama `analysis.rubrica` (no
 * la transcripcion ni el resto del analisis), por paginas de 1000 hasta un
 * techo. Si el periodo tiene mas que el techo, devuelve las mas recientes y lo
 * avisa con `truncated`: la pantalla lo dice en vez de mostrar un total que
 * parece completo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { parseCriteria, type DashboardCall } from "./calls";
import type { ResolvedPeriod } from "./period";

type Db = SupabaseClient<Database>;

const PAGE = 1000;
/** 10 paginas = 10.000 llamadas por periodo: muy por encima de lo que maneja una agencia. */
export const MAX_PAGES = 10;

const COLUMNS = "id, recorded_at, recorded_by_user_id, call_type, closer_score, lead_score, lead_qualification, outcome, main_objection, has_open_alerts, rubrica:analysis->rubrica";

export async function loadCallRows(
  supabase: Db,
  args: { workspaceId: string; range: ResolvedPeriod; closerId?: string | null },
): Promise<{ calls: DashboardCall[]; truncated: boolean; failed: boolean }> {
  const calls: DashboardCall[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    let q = supabase
      .from("calls")
      .select(COLUMNS)
      .eq("workspace_id", args.workspaceId)
      .eq("analysis_status", "analyzed")
      .is("archived_at", null);
    if (args.range.from) q = q.gte("recorded_at", args.range.from);
    if (args.range.to) q = q.lte("recorded_at", args.range.to);
    if (args.closerId) q = q.eq("recorded_by_user_id", args.closerId);

    const { data, error } = await q
      .order("recorded_at", { ascending: false })
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);

    if (error) {
      console.error("[dashboard-llamadas] no pude leer las llamadas:", error.message);
      // Con una falla se avisa; mostrar lo que alcanzo a leer como si fuera todo seria mentir.
      return { calls: [], truncated: false, failed: true };
    }

    for (const r of (data ?? []) as unknown as Array<Record<string, unknown>>) {
      calls.push({
        id: r.id as string,
        recordedAt: r.recorded_at as string,
        closerId: (r.recorded_by_user_id as string | null) ?? null,
        callType: (r.call_type as string | null) ?? null,
        closerScore: (r.closer_score as number | null) ?? null,
        leadScore: (r.lead_score as number | null) ?? null,
        qualification: (r.lead_qualification as string | null) ?? null,
        outcome: (r.outcome as string | null) ?? null,
        mainObjection: (r.main_objection as string | null) ?? null,
        hasOpenAlerts: r.has_open_alerts === true,
        criteria: parseCriteria(r.rubrica),
      });
    }

    if ((data?.length ?? 0) < PAGE) return { calls, truncated: false, failed: false };
  }

  return { calls, truncated: true, failed: false };
}
