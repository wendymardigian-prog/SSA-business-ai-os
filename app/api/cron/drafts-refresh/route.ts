import { NextResponse, after, type NextRequest } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { refreshPendingDrafts, checkRefreshHealth } from "@/lib/agent/drafts/refresh-job";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Momento 3 (F6): refresca contra Zernio las conversaciones con borrador
 * pendiente. Ack inmediato y trabajo en after(): el refresco llama a Zernio y
 * puede tardar. Lo agenda pg_cron cada 5 minutos (ssa-cron-drafts-refresh).
 */
export async function GET(request: NextRequest) {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  after(async () => {
    try {
      const supabase = await createServiceClient();
      const result = await refreshPendingDrafts(supabase);
      console.info("[drafts-refresh]", result);
      // Salud del refresco (F12): avisa una vez al día si falla mucho.
      const { data: workspaces } = await supabase.from("workspaces").select("id");
      for (const w of (workspaces ?? []) as Array<{ id: string }>) {
        await checkRefreshHealth(supabase, w.id);
      }
    } catch (err) {
      console.error("[drafts-refresh] error:", err instanceof Error ? err.message : "desconocido");
    }
  });

  return NextResponse.json({ ok: true, queued: true });
}
