/**
 * El job `eod_reminder_sweep` (E13): el recordatorio del reporte de fin de día.
 *
 * Lo encola `private.enqueue_eod_reminders()` (00185, pg_cron cada 15 minutos) UNA vez por
 * reporte publicado con recordatorio y por franja de 15 minutos. Acá, para ese reporte:
 * quién está en la audiencia, qué hora es en SU zona, si ya envió el de hoy y si ya se le
 * avisó (`lib/eod/reminder.ts`, puro). El aviso va SOLO a esa persona, en la campana.
 *
 * Un error de la base lanza (la cola reintenta): no hay proveedores externos. Un aviso que
 * no se pudo crear no frena a los demás (`createNotification` no lanza).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { createNotification } from "@/lib/notifications/create";
import { isValidTimeZone } from "@/lib/timezone";
import { isInAudience } from "@/lib/eod/audience";
import { parseStoredEodConfig } from "@/lib/eod/config";
import { remindersToSend } from "@/lib/eod/reminder";
import { loadTeam } from "@/lib/eod/server-ports";

type Db = SupabaseClient<Database>;

export const EOD_REMINDER_JOB = "eod_reminder_sweep";

export async function runEodReminders(db: Db, formId: string, now = new Date()): Promise<number> {
  const { data: form, error } = await db.from("forms").select("id, workspace_id, name, type, status, eod_config").eq("id", formId).maybeSingle();
  if (error) throw new Error(`no pude leer el reporte: ${error.message}`);
  if (!form || form.type !== "eod" || form.status !== "published") return 0;
  const config = parseStoredEodConfig(form.eod_config);
  if (!config?.reminder.enabled) return 0;

  const [team, { data: ws }] = await Promise.all([loadTeam(db, form.workspace_id), db.from("workspaces").select("timezone").eq("id", form.workspace_id).maybeSingle()]);
  const audience = team.filter((m) => isInAudience(config, m));
  if (audience.length === 0) return 0;
  const ids = audience.map((m) => m.userId);
  const fallback = ws?.timezone && isValidTimeZone(ws.timezone) ? ws.timezone : "UTC";
  const { data: prefs } = await db.from("user_preferences").select("user_id, timezone").in("user_id", ids);
  const tzOf = new Map((prefs ?? []).map((p) => [p.user_id, p.timezone]));
  const people = audience.map((m) => {
    const tz = tzOf.get(m.userId);
    return { userId: m.userId, timeZone: tz && isValidTimeZone(tz) ? tz : fallback };
  });

  // Los envíos y los avisos de estos días (como mucho dos fechas: ayer y hoy, según la zona).
  const since = new Date(now.getTime() - 48 * 3600 * 1000).toISOString().slice(0, 10);
  const [{ data: reports, error: rError }, { data: notes, error: nError }] = await Promise.all([
    db.from("eod_reports").select("user_id, report_date").eq("form_id", form.id).eq("status", "submitted").gte("report_date", since).in("user_id", ids),
    db.from("notifications").select("recipient_id, metadata").eq("workspace_id", form.workspace_id).eq("type", "eod_reminder").eq("entity_id", form.id).gte("created_at", `${since}T00:00:00Z`),
  ]);
  if (rError) throw new Error(`no pude leer los reportes: ${rError.message}`);
  if (nError) throw new Error(`no pude leer los avisos: ${nError.message}`);
  const submitted = new Set((reports ?? []).map((r) => `${r.user_id}:${r.report_date}`));
  const reminded = new Set((notes ?? []).map((n) => `${n.recipient_id}:${String((n.metadata as { report_date?: unknown } | null)?.report_date ?? "")}`));

  const due = remindersToSend({ config, now, people, submitted, reminded });
  for (const { userId, date } of due) {
    await createNotification({
      supabase: db,
      workspaceId: form.workspace_id,
      type: "eod_reminder",
      title: "Te falta el reporte del día",
      body: form.name,
      entityType: "eod_form",
      entityId: form.id,
      recipientId: userId,
      metadata: { form_id: form.id, report_date: date },
    });
  }
  return due.length;
}

export async function handleEodReminderSweep(ctx: JobContext): Promise<void> {
  const formId = (ctx.job.payload as { form_id?: unknown } | null)?.form_id;
  if (typeof formId !== "string") return;
  await runEodReminders(ctx.supabase, formId);
}

export function registerEodReminderHandler(): void {
  registerJobHandler(EOD_REMINDER_JOB, handleEodReminderSweep);
}
