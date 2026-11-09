// @plantilla-quitar(servicios)
/**
 * Lo que espera a una persona en Portal › Por revisar (el contador de la pestaña): las entregas del portal sin
 * revisar (la misma regla que el filtro «Pendientes» de `lib/program/review.ts`: actividades con `review_status` vacío o `pending`) y,
 * con `community.view`, los comentarios sin contestar de la comunidad y de las clases.
 *
 * Solo servidor. Las entregas se cuentan con el cliente de servicio DESPUÉS del permiso, filtrando por el negocio de
 * la sesión (igual que `loadReviewItems`); los comentarios, con la sesión. Un error cuenta 0: el contador nunca rompe
 * la página.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { svcRpc } from "@/lib/services/db";

type Db = SupabaseClient<any, any, any>;

export interface UnansweredByProgram {
  id: string;
  name: string;
  unanswered: number;
}

/** Comentarios sin contestar por programa con portal (solo los que tienen alguno). */
export async function loadUnansweredComments(supabase: Db, workspaceId: string): Promise<UnansweredByProgram[]> {
  const { data: programs, error } = await supabase
    .from("products")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .eq("portal_enabled" as never, true as never)
    .is("archived_at", null);
  if (error) {
    console.error("[portal] no pude leer los programas para contar comentarios:", error.code ?? "?");
    return [];
  }
  const counted = await Promise.all(
    ((programs ?? []) as Array<{ id: string; name: string }>).map(async (pr) => {
      const c = await svcRpc<{ unanswered?: number }>(supabase, "community_item_counts", { p_product_id: pr.id });
      return { id: pr.id, name: pr.name, unanswered: c.ok ? Number(c.data?.unanswered ?? 0) || 0 : 0 };
    }),
  );
  return counted.filter((c) => c.unanswered > 0);
}

/** Entregas del portal esperando revisión. */
export async function countPendingSubmissions(service: Db, workspaceId: string): Promise<number> {
  const { count, error } = await service
    .from("form_submissions")
    .select("id, forms!inner(type)", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("context", "portal")
    .eq("status", "received")
    // Solo actividades: una evaluación se corrige sola (el filtro «Pendientes» tampoco la muestra).
    .eq("forms.type", "activity")
    .or("review_status.is.null,review_status.eq.pending");
  if (error) {
    console.error("[portal] no pude contar las entregas por revisar:", error.code ?? "?");
    return 0;
  }
  return count ?? 0;
}

/** El total del contador: entregas + (si corresponde) comentarios sin contestar. */
export function pendingReviewTotal(submissions: number, comments: readonly UnansweredByProgram[] | null): number {
  return Math.max(0, submissions) + (comments ?? []).reduce((sum, c) => sum + Math.max(0, c.unanswered), 0);
}
