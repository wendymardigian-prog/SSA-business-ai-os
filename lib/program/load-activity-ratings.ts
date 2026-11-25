// @plantilla-quitar(servicios)
/**
 * Encuestas en las actividades: el resumen de cada pregunta de estrellas, solo servidor. La página del programa ya
 * comprobó su permiso; se lee con el cliente de servicio filtrando por el negocio de la sesión. Solo viajan promedios y
 * cantidades, nunca respuestas ni nombres. Un error deja el editor sin resumen (nunca rompe la pantalla).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ratingSummary, type RatingQuestionSummary, type RatingSubmission } from "./activity-survey";

type Db = SupabaseClient<any, any, any>;
type Field = { key: string; label: string; type: string; min?: unknown; max?: unknown };

export async function loadActivityRatings(
  service: Db,
  workspaceId: string,
  forms: ReadonlyArray<{ id: string; draft_definition: Record<string, unknown> }>,
): Promise<Map<string, RatingQuestionSummary[]>> {
  const out = new Map<string, RatingQuestionSummary[]>();
  const withRatings = forms
    .map((f) => ({ id: f.id, fields: (Array.isArray(f.draft_definition?.fields) ? f.draft_definition.fields : []) as Field[] }))
    .filter((f) => f.fields.some((x) => x?.type === "rating"));
  if (withRatings.length === 0) return out;
  const { data, error } = await service
    .from("form_submissions")
    .select("form_id, contact_id, answers, created_at")
    .eq("workspace_id", workspaceId)
    .eq("context", "portal")
    .eq("status", "received")
    .in("form_id", withRatings.map((f) => f.id))
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) {
    console.error("[programa] no pude leer las respuestas de estrellas:", error.code ?? "?");
    return out;
  }
  const byForm = new Map<string, RatingSubmission[]>();
  for (const r of (data ?? []) as Array<{ form_id: string; contact_id: string | null; answers: Record<string, unknown> | null; created_at: string }>) {
    const list = byForm.get(r.form_id) ?? [];
    list.push({ contactId: r.contact_id, createdAt: r.created_at, answers: r.answers ?? {} });
    byForm.set(r.form_id, list);
  }
  for (const f of withRatings) out.set(f.id, ratingSummary(f.fields, byForm.get(f.id) ?? []));
  return out;
}
