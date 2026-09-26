import { NextResponse, after, type NextRequest } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveBackgroundSettings } from "@/lib/background/settings";
import { planDispatch } from "@/lib/background/plan";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Despacho de tareas de IA en segundo plano (F24). Cada 15 min: por cada
 * workspace, mira qué tareas en modo Económico tienen una ventana vencida y
 * deja una corrida por ventana (idempotente por dedupe_key). La ejecución real
 * del clasificador por lote/agrupado se completa en la recolección (ver
 * docs/PENDIENTE.md: el pipeline de lote real está pendiente).
 */
export async function GET(request: NextRequest) {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  after(async () => {
    try {
      const supabase = await createServiceClient();
      const { data: workspaces } = await supabase.from("workspaces").select("id, timezone, ai_background_settings");
      for (const w of (workspaces ?? []) as Array<{ id: string; timezone: string | null; ai_background_settings: unknown }>) {
        const settings = resolveBackgroundSettings(w.ai_background_settings);
        const planned = planDispatch(w.id, settings, new Date(), w.timezone ?? "America/Costa_Rica");
        for (const p of planned) {
          // Un scheduled_job por ventana; el índice único de dedupe_key descarta el duplicado.
          await supabase.from("scheduled_jobs").insert({ type: "bg_task", dedupe_key: p.dedupeKey, payload: { workspaceId: w.id, task: p.task, window: p.window }, run_at: new Date().toISOString(), status: "pending" });
        }
      }
    } catch (err) {
      console.error("[bg-dispatch] error:", err instanceof Error ? err.message : "desconocido");
    }
  });

  return NextResponse.json({ ok: true, queued: true });
}
