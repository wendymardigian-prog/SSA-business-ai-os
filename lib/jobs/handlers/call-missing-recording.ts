// @plantilla-quitar(servicios)
/**
 * El job `call_missing_recording_sweep` (Servicios A4, F139): el barrido horario de UN negocio. Lo encola la base
 * (`private.enqueue_call_missing_recording`, cron `call-missing-recording` por SQL directo, minuto 41), uno por hora
 * y por negocio con el módulo prendido.
 *
 * Junta las agendas que terminaron hace entre 2 y 26 horas y la regla pura (`lib/calls/missing-recording.ts`) decide
 * a cuáles avisar. A cada una, UNA vez (la marca va en `audit_log`, `svc.call_missing_recording`): el aviso
 * `call_missing_recording` al anfitrión y al responsable del servicio. Correrlo dos veces en la misma hora no avisa dos
 * veces. Un error de la base lanza (la cola reintenta; la marca evita repetir).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { bookingsToNotify, missingRecordingWindow, type MissingRecordingCandidate } from "@/lib/calls/missing-recording";
import { svcSchema } from "@/lib/services/db";

export const CALL_MISSING_RECORDING_JOB = "call_missing_recording_sweep";
const AUDIT_ACTION = "svc.call_missing_recording";

type Db = SupabaseClient<Database>;

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

type BookingRow = { id: string; end_at: string; status: string; category_id: string | null; host_user_id: string | null; contact_id: string | null; title: string | null };

export async function sweepMissingRecordings(db: Db, workspaceId: string, now: Date = new Date()): Promise<{ notified: number }> {
  const window = missingRecordingWindow(now);
  const { data: bookings, error } = await db
    .from("bookings")
    .select("id, end_at, status, category_id, host_user_id, contact_id, title")
    .eq("workspace_id", workspaceId)
    .gte("end_at", window.from)
    .lte("end_at", window.to)
    .not("contact_id", "is", null)
    .limit(500);
  if (error) throw new Error(`no pude leer las agendas: ${error.message}`);
  const rows = (bookings ?? []) as BookingRow[];
  if (rows.length === 0) return { notified: 0 };

  const ids = rows.map((b) => b.id);
  const contactIds = [...new Set(rows.map((b) => b.contact_id!).filter(Boolean))];
  const hostIds = [...new Set(rows.map((b) => b.host_user_id).filter((v): v is string => Boolean(v)))];
  const catIds = [...new Set(rows.map((b) => b.category_id).filter((v): v is string => Boolean(v)))];

  const [cats, calls, fathom, notified, services] = await Promise.all([
    catIds.length ? db.from("booking_categories").select("id, parent_id, system_key").eq("workspace_id", workspaceId) : Promise.resolve({ data: [], error: null }),
    db.from("calls").select("booking_id").eq("workspace_id", workspaceId).in("booking_id", ids),
    hostIds.length
      ? db.from("oauth_connections").select("user_id").eq("workspace_id", workspaceId).eq("provider", "fathom").eq("status", "active").in("user_id", hostIds)
      : Promise.resolve({ data: [], error: null }),
    db.from("audit_log").select("entity_id").eq("workspace_id", workspaceId).eq("action", AUDIT_ACTION).in("entity_id", ids),
    svcSchema(db).from("services").select("id, contact_id, owner_user_id, status").eq("workspace_id", workspaceId).in("contact_id", contactIds).in("status", ["active", "paused"]),
  ]);
  for (const r of [cats, calls, fathom, notified, services]) {
    if (r.error) throw new Error(`no pude leer lo necesario para el barrido: ${r.error.message}`);
  }

  const catById = new Map(((cats.data ?? []) as Array<{ id: string; parent_id: string | null; system_key: string | null }>).map((c) => [c.id, c]));
  const keysOf = (categoryId: string | null) => {
    const c = categoryId ? catById.get(categoryId) : undefined;
    if (!c) return { areaKey: null, typeKey: null };
    if (c.parent_id) return { areaKey: catById.get(c.parent_id)?.system_key ?? null, typeKey: c.system_key };
    return { areaKey: c.system_key, typeKey: null };
  };
  const recorded = new Set(((calls.data ?? []) as Array<{ booking_id: string | null }>).map((c) => c.booking_id));
  const withFathom = new Set(((fathom.data ?? []) as Array<{ user_id: string | null }>).map((f) => f.user_id));
  const done = new Set(((notified.data ?? []) as Array<{ entity_id: string | null }>).map((n) => n.entity_id));
  const svcRows = (services.data ?? []) as Array<{ id: string; contact_id: string; owner_user_id: string | null }>;

  const candidates: MissingRecordingCandidate[] = rows.map((b) => ({
    bookingId: b.id,
    endAt: b.end_at,
    status: b.status,
    ...keysOf(b.category_id),
    contactHasActiveService: svcRows.some((s) => s.contact_id === b.contact_id),
    hasRecording: recorded.has(b.id),
    hostHasFathom: Boolean(b.host_user_id && withFathom.has(b.host_user_id)),
    alreadyNotified: done.has(b.id),
  }));

  let count = 0;
  for (const bookingId of bookingsToNotify(candidates, now)) {
    const b = rows.find((r) => r.id === bookingId)!;
    // La marca primero: si dos barridos corren a la vez, el segundo ve la marca (y el índice de la cola ya los separa).
    const { error: markErr } = await db.from("audit_log").insert({
      workspace_id: workspaceId,
      entity_type: "booking",
      entity_id: bookingId,
      action: AUDIT_ACTION,
      changes: { end_at: b.end_at } as never,
      actor_type: "system",
    } as never);
    if (markErr) throw new Error(`no pude anotar el aviso: ${markErr.message}`);
    const recipients = new Set<string>();
    if (b.host_user_id) recipients.add(b.host_user_id);
    for (const s of svcRows) if (s.contact_id === b.contact_id && s.owner_user_id) recipients.add(s.owner_user_id);
    for (const recipientId of recipients) {
      const { error: nErr } = await db.from("notifications").insert({
        workspace_id: workspaceId,
        type: "call_missing_recording",
        title: "Una reunión terminó sin grabación",
        body: b.title ? `«${b.title}» terminó hace más de 2 horas y no llegó su grabación.` : "Una reunión de servicio terminó hace más de 2 horas y no llegó su grabación.",
        entity_type: "booking",
        entity_id: bookingId,
        recipient_id: recipientId,
        metadata: {},
      });
      if (nErr) console.error("[reuniones sin grabación] no pude avisar:", nErr.message);
    }
    count += 1;
  }
  return { notified: count };
}

export async function runCallMissingRecording({ supabase, job }: JobContext): Promise<void> {
  const p = (job.payload ?? {}) as { workspace_id?: unknown };
  if (!isUuid(p.workspace_id)) return;
  const out = await sweepMissingRecordings(supabase, p.workspace_id);
  if (out.notified > 0) console.log(`[reuniones sin grabación] ${out.notified} aviso(s)`);
}

export function registerCallMissingRecordingHandler(): void {
  registerJobHandler(CALL_MISSING_RECORDING_JOB, runCallMissingRecording);
}
