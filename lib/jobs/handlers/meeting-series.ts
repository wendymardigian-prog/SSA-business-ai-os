// @plantilla-quitar(servicios)
/**
 * El trabajo `meeting_series_end` (00524): una serie de reuniones que terminó (su fin, pausa, cambio de responsable, a
 * mano). Corta el evento en Google y cancela las reuniones futuras (`endSeriesCleanup`). Lo encola la base
 * (`app_servicio.svc_end_meeting_series`).
 *
 * Nunca lanza por Google: reagenda a 1, 5 y 15 minutos (la cola reintentaría a los 10 s encima de la espera propia) y,
 * si sigue fallando, deja la serie con `google_cleanup = 'failed'` y le avisa a quien atiende.
 */
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { scheduleJob } from "@/lib/scheduler";
import { svcSchema } from "@/lib/services/db";
import { createNotification } from "@/lib/notifications/create";
import { endSeriesCleanup } from "@/lib/scheduling/series/run";

export const MEETING_SERIES_END_JOB = "meeting_series_end";
const RETRY_MINUTES = [1, 5, 15] as const;

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Cuándo se reintenta el intento `attempt` (0 = el primero falló), o null si ya no se reintenta. Pura. */
export function seriesRetryAt(attempt: number, now: Date): Date | null {
  const minutes = RETRY_MINUTES[attempt];
  return minutes === undefined ? null : new Date(now.getTime() + minutes * 60_000);
}

export async function runMeetingSeriesEnd({ supabase, job }: JobContext): Promise<void> {
  const p = (job.payload ?? {}) as { series_id?: unknown; workspace_id?: unknown; attempt?: unknown };
  if (!isUuid(p.series_id)) return;
  const attempt = typeof p.attempt === "number" ? p.attempt : 0;
  try {
    await endSeriesCleanup(supabase, p.series_id);
  } catch (error) {
    console.warn("[series] no pude cortar la serie en Google:", error instanceof Error ? error.name : "error");
    const retryAt = seriesRetryAt(attempt, new Date());
    if (retryAt) {
      await scheduleJob(supabase, MEETING_SERIES_END_JOB, { series_id: p.series_id, workspace_id: p.workspace_id, attempt: attempt + 1 }, retryAt);
      return;
    }
    const { data } = await svcSchema(supabase).from("meeting_series").update({ google_cleanup: "failed" }).eq("id", p.series_id).select("workspace_id, host_user_id").maybeSingle();
    const s = data as { workspace_id: string; host_user_id: string | null } | null;
    if (s?.host_user_id) {
      await createNotification({
        supabase,
        workspaceId: s.workspace_id,
        recipientId: s.host_user_id,
        type: "booking_cancelled",
        title: "No pude cortar una serie de reuniones en Google",
        body: "Las reuniones futuras pueden seguir en tu Google Calendar: borralas desde ahí.",
      });
    }
  }
}

export function registerMeetingSeriesHandler(): void {
  registerJobHandler(MEETING_SERIES_END_JOB, runMeetingSeriesEnd);
}
