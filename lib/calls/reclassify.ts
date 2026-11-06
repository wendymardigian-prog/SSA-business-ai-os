/**
 * Volver a clasificar una grabacion cuando cambia su reunion: se vinculo, se desvinculo, o
 * la reunion cambio de area o tipo.
 *
 * Reglas:
 *  - Lo que eligio una persona no se toca.
 *  - Una grabacion ya analizada conserva su analisis: cambia su clasificacion y la ficha
 *    ofrece regenerarlo. No se gasta IA sola.
 *  - Sin reunion ni regla que decida, y sin analizar todavia, vuelve a la cola de
 *    clasificacion. Ahi si puede usar la IA, igual que una grabacion nueva.
 *  - Nunca lanza: reclasificar es una consecuencia de otra accion, que ya se guardo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { classificationPatch, loadClassificationContext } from "./classify-core";
import { resolveCascade } from "./classify-cascade";
import { enqueueCallJob, enqueueClassify } from "./queue";
import { nextStatusAfterClassify } from "./status";

type Db = SupabaseClient<Database>;

const COLUMNS =
  "id, workspace_id, title, duration_seconds, attendees, transcript, booking_id, contact_id, analysis_status, imported_from_history, no_show, classification_source, call_type_source";

/** Los estados que se pueden mover: lo analizado o en curso no cambia de estado. */
const MOVABLE = ["needs_review", "pending", "not_applicable", "error"];

export type ReclassifyOutcome = "gone" | "kept_human" | "updated" | "requeued" | "cleared" | "failed";

export async function reclassifyCall(db: Db, callId: string, now: Date = new Date()): Promise<ReclassifyOutcome> {
  try {
    const { data: call } = await db.from("calls").select(COLUMNS).eq("id", callId).is("archived_at", null).maybeSingle();
    if (!call) return "gone";
    if (call.classification_source === "human" || call.call_type_source === "human") return "kept_human";

    const ctx = await loadClassificationContext(db, call);
    const result = resolveCascade({ booking: ctx.booking, rule: ctx.rule });
    const patch = classificationPatch(result, ctx, call.no_show);
    const movable = MOVABLE.includes(call.analysis_status);

    if (!result.snapshot && movable) {
      const { error } = await db.from("calls").update({ ...patch, analysis_status: "classifying", analysis_status_reason: null }).eq("id", callId);
      if (error) throw new Error(error.message);
      await enqueueClassify(db, callId, now);
      return "requeued";
    }

    const analysis = ctx.settings.call_analysis;
    const next = patch.call_type
      ? nextStatusAfterClassify(patch.call_type, {
          analyzeTypes: analysis.analyze_types,
          auto: analysis.mode === "now" && !call.imported_from_history,
          hasTranscript: Array.isArray(call.transcript) && call.transcript.length > 0,
        })
      : null;
    const { error } = await db
      .from("calls")
      .update({ ...patch, ...(movable && next ? { analysis_status: next.status, analysis_status_reason: next.reason } : {}) })
      .eq("id", callId);
    if (error) throw new Error(error.message);
    if (movable && next?.enqueueAnalysis) await enqueueCallJob(db, "call_analyze", callId, now);
    return result.snapshot ? "updated" : "cleared";
  } catch (err) {
    console.error("[llamadas] no pude volver a clasificar:", err instanceof Error ? err.message : "error");
    return "failed";
  }
}

/** La reunion cambio de area o tipo: se actualizan sus grabaciones. Nunca lanza. */
export async function reclassifyCallsOfBooking(db: Db, bookingId: string, now: Date = new Date()): Promise<void> {
  try {
    const { data } = await db.from("calls").select("id").eq("booking_id", bookingId).is("archived_at", null);
    for (const row of data ?? []) await reclassifyCall(db, row.id, now);
  } catch (err) {
    console.error("[llamadas] no pude actualizar las grabaciones de la reunión:", err instanceof Error ? err.message : "error");
  }
}
