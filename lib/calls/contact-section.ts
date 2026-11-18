/**
 * Las llamadas de un contacto y de una agenda (F34), para la ficha del contacto
 * y el detalle de la agenda. Se leen con el cliente de QUIEN MIRA: la RLS
 * (`can_see_call`) decide cuales ve; el resto es como si no existieran. Nunca
 * leen la transcripcion ni el analisis entero.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { callDisplayLabel } from "./catalog";
import { churnReasonLabel, readChurnCause } from "./churn";
import { resolveCallTaskSettings } from "./task-settings";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

/** Cuantas llamadas se muestran en la ficha del contacto antes de "Ver todas". */
export const CONTACT_CALLS_LIMIT = 10;

// De todo el análisis, solo la causa de baja (un objeto chico): nunca el análisis entero.
const COLUMNS = "id, recorded_at, category_snapshot, no_show, recorded_by_user_id, outcome, closer_score, lead_score, analysis_status, causa_baja:analysis->causa_baja";

export interface CallSectionRow {
  id: string;
  recordedAt: string;
  categoryLabel: string;
  closerName: string | null;
  outcome: string | null;
  closerScore: number | null;
  leadScore: number | null;
  status: string;
  /** La clave de la causa de baja de esa reunión, si la tiene. */
  churnKey: string | null;
}

/** La causa de baja más reciente entre esas reuniones (ya vienen de la más nueva a la más vieja). */
export interface LatestChurn {
  callId: string;
  at: string;
  label: string;
}

export function toCallSectionRows(
  rows: Array<{ id: string; recorded_at: string; category_snapshot?: unknown; no_show?: boolean; recorded_by_user_id: string | null; outcome: string | null; closer_score: number | null; lead_score: number | null; analysis_status: string; causa_baja?: unknown }>,
  names: Map<string, string>,
): CallSectionRow[] {
  return rows.map((r) => ({
    id: r.id,
    recordedAt: r.recorded_at,
    categoryLabel: callDisplayLabel(r.category_snapshot, r.no_show === true),
    closerName: r.recorded_by_user_id ? (names.get(r.recorded_by_user_id) ?? null) : null,
    outcome: r.outcome,
    closerScore: r.closer_score,
    leadScore: r.lead_score,
    status: r.analysis_status,
    churnKey: readChurnCause({ causa_baja: r.causa_baja })?.clave ?? null,
  }));
}

/** La más reciente con causa de baja, con el nombre de la lista del negocio (o la clave legible, sin lista). */
export function latestChurn(rows: readonly Pick<CallSectionRow, "id" | "recordedAt" | "churnKey">[], reasons: Parameters<typeof churnReasonLabel>[1]): LatestChurn | null {
  const row = rows.find((r) => r.churnKey);
  if (!row?.churnKey) return null;
  return { callId: row.id, at: row.recordedAt, label: churnReasonLabel(row.churnKey, reasons) ?? row.churnKey };
}

/** "Ver todas" lleva a la lista de Llamadas filtrada por ese contacto. */
export function viewAllCallsHref(contactId: string): string {
  return `/dashboard/llamadas?contacto=${encodeURIComponent(contactId)}`;
}

/** Las llamadas del contacto que quien mira puede ver (las mas recientes, hasta el limite) y cuantas hay en total. */
export async function loadContactCalls(
  supabase: Db,
  args: { workspaceId: string; contactId: string; names: Map<string, string> },
): Promise<{ rows: CallSectionRow[]; total: number; churn: LatestChurn | null }> {
  const { data, count, error } = await supabase
    .from("calls")
    .select(COLUMNS, { count: "exact" })
    .eq("workspace_id", args.workspaceId)
    .eq("contact_id", args.contactId)
    .is("archived_at", null)
    .order("recorded_at", { ascending: false })
    .limit(CONTACT_CALLS_LIMIT);
  if (error) {
    console.error("[llamadas] no pude leer las llamadas del contacto:", error.message);
    return { rows: [], total: 0, churn: null };
  }
  const rows = toCallSectionRows(data ?? [], args.names);
  let churn: LatestChurn | null = null;
  if (rows.some((r) => r.churnKey)) {
    const { data: ws } = await supabase.from("workspaces").select("ai_background_settings").eq("id", args.workspaceId).maybeSingle();
    churn = latestChurn(rows, resolveCallTaskSettings(ws?.ai_background_settings).call_analysis.churn_reasons);
  }
  return { rows, total: count ?? (data ?? []).length, churn };
}

/**
 * La causa de baja más reciente de las reuniones de un servicio (la ficha del cliente). Con la sesión de quien mira:
 * la RLS de `calls` decide qué reuniones ve. Nunca lanza: ante un problema, null.
 */
export async function loadServiceChurn(supabase: Db, args: { workspaceId: string; serviceId: string }): Promise<LatestChurn | null> {
  try {
    const { data, error } = await supabase
      .from("calls")
      .select("id, recorded_at, causa_baja:analysis->causa_baja")
      .eq("workspace_id", args.workspaceId)
      .eq("service_id", args.serviceId)
      .is("archived_at", null)
      .not("analysis->causa_baja", "is", null)
      .order("recorded_at", { ascending: false })
      .limit(1);
    if (error || !data?.length) return null;
    const row = data[0] as { id: string; recorded_at: string; causa_baja: unknown };
    const key = readChurnCause({ causa_baja: row.causa_baja })?.clave ?? null;
    if (!key) return null;
    const { data: ws } = await supabase.from("workspaces").select("ai_background_settings").eq("id", args.workspaceId).maybeSingle();
    return latestChurn([{ id: row.id, recordedAt: row.recorded_at, churnKey: key }], resolveCallTaskSettings(ws?.ai_background_settings).call_analysis.churn_reasons);
  } catch {
    return null;
  }
}

/** Las llamadas vinculadas a una agenda que quien mira puede ver (puede haber varias). */
export async function loadBookingCalls(supabase: Db, args: { workspaceId: string; bookingId: string; names: Map<string, string> }): Promise<CallSectionRow[]> {
  const { data, error } = await supabase
    .from("calls")
    .select(COLUMNS)
    .eq("workspace_id", args.workspaceId)
    .eq("booking_id", args.bookingId)
    .is("archived_at", null)
    .order("recorded_at", { ascending: false });
  if (error) {
    console.error("[llamadas] no pude leer las llamadas de la agenda:", error.message);
    return [];
  }
  return toCallSectionRows(data ?? [], args.names);
}
