/**
 * Las llamadas de un contacto y de una agenda (F34), para la ficha del contacto
 * y el detalle de la agenda. Se leen con el cliente de QUIEN MIRA: la RLS
 * (`can_see_call`) decide cuales ve; el resto es como si no existieran. Nunca
 * leen la transcripcion ni el analisis entero.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

/** Cuantas llamadas se muestran en la ficha del contacto antes de "Ver todas". */
export const CONTACT_CALLS_LIMIT = 10;

const COLUMNS = "id, recorded_at, call_type, recorded_by_user_id, outcome, closer_score, lead_score, analysis_status";

export interface CallSectionRow {
  id: string;
  recordedAt: string;
  callType: string | null;
  closerName: string | null;
  outcome: string | null;
  closerScore: number | null;
  leadScore: number | null;
  status: string;
}

export function toCallSectionRows(
  rows: Array<{ id: string; recorded_at: string; call_type: string | null; recorded_by_user_id: string | null; outcome: string | null; closer_score: number | null; lead_score: number | null; analysis_status: string }>,
  names: Map<string, string>,
): CallSectionRow[] {
  return rows.map((r) => ({
    id: r.id,
    recordedAt: r.recorded_at,
    callType: r.call_type,
    closerName: r.recorded_by_user_id ? (names.get(r.recorded_by_user_id) ?? null) : null,
    outcome: r.outcome,
    closerScore: r.closer_score,
    leadScore: r.lead_score,
    status: r.analysis_status,
  }));
}

/** "Ver todas" lleva a la lista de Llamadas filtrada por ese contacto. */
export function viewAllCallsHref(contactId: string): string {
  return `/dashboard/llamadas?contacto=${encodeURIComponent(contactId)}`;
}

/** Las llamadas del contacto que quien mira puede ver (las mas recientes, hasta el limite) y cuantas hay en total. */
export async function loadContactCalls(
  supabase: Db,
  args: { workspaceId: string; contactId: string; names: Map<string, string> },
): Promise<{ rows: CallSectionRow[]; total: number }> {
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
    return { rows: [], total: 0 };
  }
  return { rows: toCallSectionRows(data ?? [], args.names), total: count ?? (data ?? []).length };
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
