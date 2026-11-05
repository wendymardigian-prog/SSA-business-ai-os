import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

/** Cuanto se guarda el detalle de pasos: lo mismo que los mensajes. */
export const FLOW_STEP_RETENTION_MONTHS = 12;

export function flowStepRetentionCutoff(now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - FLOW_STEP_RETENTION_MONTHS);
  return cutoff;
}

/**
 * Borra el detalle de pasos viejo, una vez por dia. Solo los pasos: la fila de `flow_sessions` queda, porque «Una sola
 * vez por contacto» mira esa fila para saber quien ya paso por el flujo. Nunca lanza: la limpieza no tumba el cron.
 */
export async function sweepFlowStepHistory(supabase: SupabaseClient<Database>, now: Date): Promise<number> {
  try {
    const { count, error } = await supabase
      .from("flow_session_steps")
      .delete({ count: "exact" })
      .lt("started_at", flowStepRetentionCutoff(now).toISOString());
    if (error) {
      console.error(`[flow-engine] no pude limpiar el detalle de pasos (code=${error.code ?? "?"})`);
      return 0;
    }
    return count ?? 0;
  } catch (err) {
    console.error("[flow-engine] no pude limpiar el detalle de pasos:", err instanceof Error ? err.name : "error");
    return 0;
  }
}
