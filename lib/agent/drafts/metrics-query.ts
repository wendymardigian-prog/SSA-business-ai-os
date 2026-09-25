import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { BUSINESS_TIMEZONE, startOfZonedDay } from "@/lib/dates";

/**
 * La franja de medicion de la cola (Bloque 2c). Lee draft_queue_metrics y
 * draft_queue_metrics_by_person (00071) con el cliente del USUARIO: las dos
 * funciones se defienden solas (un Member siempre recibe sus numeros; el
 * desglose por persona rebota si no es Owner/Admin). No va por ai_cost_report:
 * esto es operacion, no costos.
 *
 * Tres tiempos que son tres cosas distintas y se muestran separados:
 *   - respuesta: lo unico que percibe el lead, desde su ULTIMO mensaje;
 *   - del agente: incluye la espera de la rafaga, no es "latencia del modelo";
 *   - de aprobacion: solo sobre borradores; es el unico que se puede mejorar.
 */

type Db = SupabaseClient<Database>;

export interface DraftMetrics {
  responseMedianS: number | null;
  agentMedianS: number | null;
  approvalMedianS: number | null;
  sent: number;
  sentUnedited: number;
  discarded: number;
  windowsMissed: number;
}

export interface PersonMetrics extends Omit<DraftMetrics, "responseMedianS" | "agentMedianS"> {
  /** null = "sin asignar" (ventanas perdidas de borradores que no eran de nadie). */
  userId: string | null;
}

export interface DraftMetricsView {
  /** Hoy (zona del negocio): los tres tiempos. */
  today: DraftMetrics | null;
  /** Ultimos 7 dias: ventanas perdidas y aprobados sin editar. */
  week: DraftMetrics | null;
  /** Solo Owner/Admin. */
  byPerson: PersonMetrics[] | null;
  scope: "team" | "person";
}

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function toMetrics(raw: unknown): DraftMetrics | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    responseMedianS: numOrNull(r.response_median_s),
    agentMedianS: numOrNull(r.agent_median_s),
    approvalMedianS: numOrNull(r.approval_median_s),
    sent: num(r.sent),
    sentUnedited: num(r.sent_unedited),
    discarded: num(r.discarded),
    windowsMissed: num(r.windows_missed),
  };
}

export async function loadDraftMetrics(
  user: Db,
  args: { workspaceId: string; isAdmin: boolean; userId: string; onlyMine: boolean; now?: Date },
): Promise<DraftMetricsView> {
  const now = args.now ?? new Date();
  const soon = new Date(now.getTime() + 60_000).toISOString();
  const dayStart = startOfZonedDay(now, BUSINESS_TIMEZONE).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  // Para un Member la base ignora el parametro y usa su id: se manda igual.
  const person = !args.isAdmin || args.onlyMine ? args.userId : null;

  const call = (from: string) =>
    user.rpc("draft_queue_metrics", { p_workspace_id: args.workspaceId, p_from: from, p_to: soon, p_user_id: person });

  const [todayRes, weekRes, byPersonRes] = await Promise.all([
    call(dayStart),
    call(weekStart),
    args.isAdmin
      ? user.rpc("draft_queue_metrics_by_person", { p_workspace_id: args.workspaceId, p_from: weekStart, p_to: soon })
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const res of [todayRes, weekRes, byPersonRes]) {
    if (res.error) console.error("[drafts] no pude leer las metricas de la cola:", res.error.message);
  }

  const byPerson = Array.isArray(byPersonRes.data)
    ? (byPersonRes.data as Array<Record<string, unknown>>).map((r) => ({
        userId: (r.user_id as string | null) ?? null,
        approvalMedianS: numOrNull(r.approval_median_s),
        sent: num(r.sent),
        sentUnedited: num(r.sent_unedited),
        discarded: num(r.discarded),
        windowsMissed: num(r.windows_missed),
      }))
    : null;

  return {
    today: toMetrics(todayRes.data),
    week: toMetrics(weekRes.data),
    byPerson,
    scope: person ? "person" : "team",
  };
}

/** "38 s", "4 min", "2 h 10 min", "—". */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "7 de 10 (70 %)" o "—" sin enviados. */
export function formatUnedited(m: Pick<DraftMetrics, "sent" | "sentUnedited"> | null): string {
  if (!m || m.sent === 0) return "—";
  return `${m.sentUnedited} de ${m.sent} (${Math.round((m.sentUnedited / m.sent) * 100)} %)`;
}
