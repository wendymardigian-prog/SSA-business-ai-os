import { NextResponse, after, type NextRequest } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveBackgroundSettings } from "@/lib/background/settings";
import { planDispatch } from "@/lib/background/plan";
import { enqueuePlanned } from "@/lib/background/enqueue";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Despacho de tareas de IA en segundo plano (F24). Cada 15 min: por cada
 * workspace, mira qué tareas en modo Económico tienen una ventana vencida y
 * deja una corrida por ventana.
 *
 * La idempotencia la sostiene `uq_scheduled_jobs_bg_task_dedupe` (00101), que
 * es único sobre TODA la vida del job. El índice de la 00061 no alcanzaba: era
 * único solo entre los `pending`, así que en cuanto el job se completaba la
 * misma ventana se volvía a encolar a los 15 minutos, para siempre.
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
        const planned = planDispatch(w.id, settings, new Date(), w.timezone ?? "UTC");
        await enqueuePlanned(supabase, w.id, planned);
      }
    } catch (err) {
      console.error("[bg-dispatch] error:", err instanceof Error ? err.message : "desconocido");
    }
  });

  return NextResponse.json({ ok: true, queued: true });
}
