/**
 * Las respuestas de un formulario que pasan los filtros: UN solo camino para la tabla y el CSV.
 *
 * 1. La consulta, con el cliente de QUIEN MIRA (la RLS `can_see_form_submission` decide qué ve),
 *    aplica estado, contacto y fecha (`applyResponseFilters`).
 * 2. `filterIndex` aplica la búsqueda, el país y las UTM (lib/forms/response-index.ts).
 *
 * Trae hasta `FORM_LIMITS.exportMaxRows` respuestas, el mismo tope del CSV: con más, avisa
 * (`truncated`) y lo que se ve son las más nuevas.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { FORM_LIMITS } from "./limits";
import { flatAttribution } from "./response-columns";
import { filterIndex } from "./response-index";
import type { ResponseFilters, StoredAnswer, SubmissionStatus } from "./responses";
import { applyResponseFilters } from "./responses-query";

export interface LoadedSubmission {
  id: string;
  created_at: string;
  status: SubmissionStatus;
  contact_id: string | null;
  answers: Record<string, StoredAnswer>;
  score: number | null;
  nps_category: string | null;
  /** La atribución tal como se guardó (el CSV la lee así). */
  rawAttribution: Record<string, unknown>;
  /** Aplanada: lo que leen las columnas, los filtros y los grupos. */
  attribution: Record<string, string>;
}

export interface LoadedResponses {
  /** Las que pasan los filtros de la consulta (estado, contacto, fecha). Sobre esto se arman las opciones de los filtros. */
  base: LoadedSubmission[];
  /** Las que además pasan búsqueda, país y UTM, de la más nueva a la más vieja. */
  matching: LoadedSubmission[];
  truncated: boolean;
  error: boolean;
}

export async function loadFormResponses(
  supabase: SupabaseClient<Database>,
  input: { workspaceId: string; formId: string; filters: ResponseFilters; timeZone: string; phoneKey: string | null },
): Promise<LoadedResponses> {
  const cap = FORM_LIMITS.exportMaxRows;
  const query = supabase
    .from("form_submissions")
    .select("id, created_at, status, contact_id, answers, score, nps_category, attribution")
    .eq("form_id", input.formId)
    .eq("workspace_id", input.workspaceId);
  const { data, error } = await applyResponseFilters(query, input.filters, input.timeZone)
    .order("created_at", { ascending: false })
    .limit(cap + 1);
  if (error) console.error("[forms] loadFormResponses fallo, code=", error.code);

  const rows = data ?? [];
  const truncated = rows.length > cap;
  const base: LoadedSubmission[] = (truncated ? rows.slice(0, cap) : rows).map((s) => {
    const rawAttribution = (s.attribution ?? {}) as Record<string, unknown>;
    return {
      id: s.id,
      created_at: s.created_at,
      status: s.status as SubmissionStatus,
      contact_id: s.contact_id,
      answers: (s.answers ?? {}) as unknown as Record<string, StoredAnswer>,
      score: s.score,
      nps_category: s.nps_category,
      rawAttribution,
      attribution: flatAttribution(rawAttribution),
    };
  });
  const matching = filterIndex(base, { q: input.filters.q ?? "", dims: input.filters.dims ?? {} }, input.phoneKey);
  return { base, matching, truncated, error: !!error };
}
