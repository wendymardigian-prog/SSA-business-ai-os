// @plantilla-quitar(servicios)
/**
 * La serie de reuniones que fija quien atiende un paso de Reunión que se repite (00524, traído de RER #71). Solo
 * servidor, con el cliente de servicio: quien llama ya comprobó el permiso y saca el negocio de la sesión.
 *
 *  - `fixMeetingSeriesCore`: quien atiende eligió el primer día y la hora. Crea UN evento que se repite en su Google
 *    (con Meet e invitación al contacto), guarda la serie, cierra «Fijar reuniones…», pasa a la Agenda las fechas de
 *    las próximas semanas y corre el motor para unir cada fecha a su vuelta.
 *  - `materializeSeries`: las fechas del evento que faltan como reuniones de la plataforma, hasta `SERIES_HORIZON_DAYS`.
 *    Se guardan como las traídas de Google (`metadata.google_import`, 00510): nunca se crea otro evento, mover una
 *    mueve esa fecha en Google y no dispara «Se agendó una reunión» (Google ya mandó la invitación). Lo corre el barrido
 *    diario. Nunca agenda nada que una persona no haya fijado.
 *  - `endSeriesCleanup`: una serie que terminó (su fin, pausa, cambio de responsable, a mano): corta el evento en Google
 *    (UNTIL) y cancela las reuniones futuras. Lo corre el trabajo `meeting_series_end`. Lanza ante un error de Google.
 *  - `changeSeriesTimeCore`: «Cambiar día y hora»: corta la serie desde ahora y fija una nueva (las pasadas no cambian).
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { svcRpc, svcSchema } from "@/lib/services/db";
import type { Recurrence } from "@/lib/services/engine-rules";
import { createRecurringEvent, cutRecurringEvent, deleteEvent, listInstances } from "@/lib/google-calendar/client";
import { GoogleCalendarError } from "@/lib/google-calendar/errors";
import { destinationFor } from "@/lib/jobs/handlers/booking-sync";
import { planManualBooking } from "@/lib/scheduling/booking/manual-input";
import { createManualBooking } from "@/lib/scheduling/booking/manual";
import { firstDateProblem, rruleFor } from "./rrule";

type Db = SupabaseClient<Database>;

/** Hasta cuántos días por delante existen las reuniones de la serie en la plataforma. */
export const SERIES_HORIZON_DAYS = 60;
const DAY_MS = 86_400_000;

export type SeriesErrorCode = "not_found" | "not_series" | "not_started" | "already" | "no_host" | "no_google" | "bad_date" | "google";
export type FixSeriesResult = { ok: true; seriesId: string; booked: number } | { ok: false; code: SeriesErrorCode; message: string };

export const NO_GOOGLE_MESSAGE = "Para fijar una serie, quien atiende tiene que tener Google Calendar conectado. Conectalo en Agenda → Configuración → Calendarios.";

/** Fecha y hora de pared de un instante en una zona: { date: "2026-11-24", time: "10:00" }. */
export function localParts(iso: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(iso))
    .reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

interface StepRow {
  id: string;
  service_id: string;
  workspace_id: string;
  name: string;
  kind: string;
  ref: Record<string, unknown> | null;
  recurrence: unknown;
  assignee: string;
  assignee_user_id: string | null;
  is_recurring_template: boolean;
  series_ended_at: string | null;
  status: string;
}
interface ServiceRow {
  id: string;
  workspace_id: string;
  contact_id: string;
  owner_user_id: string | null;
  status: string;
}
interface SeriesRow {
  id: string;
  workspace_id: string;
  service_id: string;
  service_item_id: string;
  host_user_id: string | null;
  event_type_id: string | null;
  rrule: string;
  first_start_at: string;
  duration_minutes: number;
  timezone: string;
  google_connection_id: string | null;
  google_calendar_id: string | null;
  google_event_id: string | null;
  meet_url: string | null;
  status: string;
  google_cleanup: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Quien atiende la serie: la persona del paso, o el responsable del servicio. */
export function seriesHost(step: Pick<StepRow, "assignee" | "assignee_user_id">, svc: Pick<ServiceRow, "owner_user_id">): string | null {
  return step.assignee === "user" ? step.assignee_user_id : svc.owner_user_id;
}

/** El paso de Reunión y su servicio, del negocio dado. */
export async function loadSeriesStep(service: Db, workspaceId: string, itemId: string): Promise<{ step: StepRow; svc: ServiceRow; hostUserId: string | null } | null> {
  const { data: step } = await svcSchema(service)
    .from("service_items")
    .select("id, service_id, workspace_id, name, kind, ref, recurrence, assignee, assignee_user_id, is_recurring_template, series_ended_at, status")
    .eq("id", itemId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!step) return null;
  const s = step as StepRow;
  const { data: svc } = await svcSchema(service).from("services").select("id, workspace_id, contact_id, owner_user_id, status").eq("id", s.service_id).maybeSingle();
  if (!svc) return null;
  const v = svc as ServiceRow;
  return { step: s, svc: v, hostUserId: seriesHost(s, v) };
}

async function seriesTitle(service: Db, serviceId: string, eventTitle: string | null): Promise<string> {
  const label = await svcRpc<string>(service, "svc_client_label", { p_service_id: serviceId });
  return `${eventTitle ?? "Reunión"} con ${label.ok && label.data ? label.data : "el cliente"}`.slice(0, 200);
}

async function categoryOf(service: Db, eventTypeId: string | null): Promise<string | null> {
  if (!eventTypeId) return null;
  const { data } = await service.from("event_types").select("category_id").eq("id", eventTypeId).maybeSingle();
  return (data as { category_id: string | null } | null)?.category_id ?? null;
}

export async function fixMeetingSeriesCore(
  service: Db,
  input: { workspaceId: string; itemId: string; date: string; time: string; timezone: string; actorUserId: string },
  now: Date = new Date(),
): Promise<FixSeriesResult> {
  const found = await loadSeriesStep(service, input.workspaceId, input.itemId);
  if (!found) return { ok: false, code: "not_found", message: "No encontré ese paso." };
  const { step, svc, hostUserId } = found;
  if (!step.is_recurring_template || step.kind !== "booking" || step.ref?.schedule !== "series") {
    return { ok: false, code: "not_series", message: "Este paso no es una serie de reuniones que fija quien atiende." };
  }
  if (step.series_ended_at || step.status !== "pending") return { ok: false, code: "not_series", message: "La serie de este paso ya terminó." };
  if (svc.status !== "active") return { ok: false, code: "not_series", message: "El servicio no está activo." };
  if (!hostUserId) return { ok: false, code: "no_host", message: "El paso no tiene a nadie a cargo." };
  const { data: active } = await svcSchema(service).from("meeting_series").select("id").eq("service_item_id", step.id).eq("status", "active").maybeSingle();
  if (active) return { ok: false, code: "already", message: "Este paso ya tiene su serie fijada." };

  const rep = isObj(step.recurrence) ? (step.recurrence as unknown as Recurrence) : null;
  if (!rep) return { ok: false, code: "not_series", message: "El paso no se repite." };
  const dateProblem = firstDateProblem(rep, input.date);
  if (dateProblem) return { ok: false, code: "bad_date", message: dateProblem };

  const eventTypeId = typeof step.ref?.event_type_id === "string" ? step.ref.event_type_id : null;
  const { data: ev } = eventTypeId
    ? await service.from("event_types").select("id, title, duration_minutes, category_id").eq("id", eventTypeId).eq("workspace_id", input.workspaceId).maybeSingle()
    : { data: null };
  if (!ev) return { ok: false, code: "not_series", message: "El paso no tiene tipo de reunión." };
  const title = await seriesTitle(service, svc.id, ev.title);
  const { data: contact } = await service.from("contacts").select("display_name, email").eq("id", svc.contact_id).maybeSingle();

  const planned = planManualBooking({
    title,
    hostUserId,
    categoryId: ev.category_id,
    date: input.date,
    time: input.time,
    durationMinutes: ev.duration_minutes,
    timezone: input.timezone,
    contactId: svc.contact_id,
    location: { kind: "google_meet" },
  });
  if (!planned.ok) return { ok: false, code: "bad_date", message: planned.error };
  if (new Date(planned.plan.startUtc).getTime() <= now.getTime()) return { ok: false, code: "bad_date", message: "La primera reunión tiene que ser en el futuro." };

  // Sin Google conectado no se puede fijar una serie.
  const destination = await destinationFor(service, { workspace_id: input.workspaceId, host_user_id: hostUserId, event_type_id: ev.id });
  if (!destination) return { ok: false, code: "no_google", message: NO_GOOGLE_MESSAGE };

  const rrule = rruleFor(rep, input.date);
  let created;
  try {
    created = await createRecurringEvent({ supabase: service }, destination.connectionId, destination.externalId, {
      bookingUid: randomUUID(),
      summary: title,
      description: `Reuniones que se repiten («${step.name}»). Si una no puede hacerse, se mueve a otro día.`,
      startUtc: planned.plan.startUtc,
      endUtc: planned.plan.endUtc,
      timeZone: input.timezone,
      attendeeEmail: (contact as { email: string | null } | null)?.email ?? null,
      attendeeName: (contact as { display_name: string | null } | null)?.display_name ?? null,
      location: { kind: "google_meet" },
      rrule,
    });
  } catch (err) {
    // Un error permanente (permiso revocado, calendario sin acceso) pide reconectar Google; uno temporal, reintentar.
    const permanent = err instanceof GoogleCalendarError && err.kind === "permanent";
    return { ok: false, code: permanent ? "no_google" : "google", message: permanent ? NO_GOOGLE_MESSAGE : "Google no pudo crear la serie. Probá de nuevo en un rato." };
  }

  const { data: row, error } = await svcSchema(service)
    .from("meeting_series")
    .insert({
      workspace_id: input.workspaceId,
      service_id: svc.id,
      service_item_id: step.id,
      host_user_id: hostUserId,
      event_type_id: ev.id,
      rrule,
      first_start_at: planned.plan.startUtc,
      duration_minutes: ev.duration_minutes,
      timezone: input.timezone,
      google_connection_id: destination.connectionId,
      google_calendar_id: destination.calendarRowId,
      google_event_id: created.eventId,
      meet_url: created.meetUrl,
      created_by: input.actorUserId,
    })
    .select("id")
    .single();
  if (error || !row) {
    // Otra persona la fijó a la vez: el evento que se acaba de crear sobra.
    await deleteEvent({ supabase: service }, destination.connectionId, destination.externalId, created.eventId, "none").catch(() => undefined);
    return { ok: false, code: "already", message: "Este paso ya tiene su serie fijada." };
  }
  const seriesId = (row as { id: string }).id;

  await service
    .from("tasks")
    .update({ status: "completed", completed_at: now.toISOString() })
    .eq("workspace_id", input.workspaceId)
    .eq("source", "cx")
    .eq("source_ref", `svc_series_fix:${step.id}`)
    .neq("status", "completed");
  await service.from("audit_log").insert({
    workspace_id: input.workspaceId,
    entity_type: "service_item",
    entity_id: step.id,
    action: "svc.meeting_series_fixed",
    changes: { service_id: svc.id, series_id: seriesId, rrule, first_start_at: planned.plan.startUtc },
    performed_by: input.actorUserId,
    actor_type: "user",
  } as never);

  let booked = 0;
  try {
    booked = await materializeSeries(service, seriesId, now);
  } catch (e) {
    // Las reuniones se pasan igual mañana, en el barrido diario.
    console.warn("[series] no pude pasar las fechas de la serie todavía:", e instanceof Error ? e.name : "error");
  }
  await svcRpc(service, "svc_generate_occurrences", { p_service_id: svc.id });
  return { ok: true, seriesId, booked };
}

/** Las fechas del evento que todavía no son reuniones de la plataforma, hasta `SERIES_HORIZON_DAYS`. */
export async function materializeSeries(service: Db, seriesId: string, now: Date = new Date()): Promise<number> {
  const { data } = await svcSchema(service).from("meeting_series").select("*").eq("id", seriesId).maybeSingle();
  const series = data as SeriesRow | null;
  if (!series || series.status !== "active" || !series.google_event_id || !series.google_connection_id || !series.google_calendar_id || !series.host_user_id) return 0;
  const [{ data: cal }, { data: svc }] = await Promise.all([
    service.from("calendars").select("external_calendar_id").eq("id", series.google_calendar_id).maybeSingle(),
    svcSchema(service).from("services").select("id, contact_id").eq("id", series.service_id).maybeSingle(),
  ]);
  if (!cal || !svc) return 0;
  const instances = await listInstances({ supabase: service }, series.google_connection_id, (cal as { external_calendar_id: string }).external_calendar_id, series.google_event_id, {
    timeMin: now.toISOString(),
    timeMax: new Date(now.getTime() + SERIES_HORIZON_DAYS * DAY_MS).toISOString(),
  });
  const { data: have } = await service.from("bookings").select("google_event_id").eq("workspace_id", series.workspace_id).eq("metadata->>series_id", series.id);
  const known = new Set(((have ?? []) as Array<{ google_event_id: string | null }>).map((b) => b.google_event_id));
  const { data: ev } = series.event_type_id ? await service.from("event_types").select("title").eq("id", series.event_type_id).maybeSingle() : { data: null };
  const title = await seriesTitle(service, series.service_id, (ev as { title: string } | null)?.title ?? null);
  const categoryId = await categoryOf(service, series.event_type_id);

  let created = 0;
  const pending = instances
    .filter((i) => i.status !== "cancelled" && i.startUtc && !known.has(i.id) && new Date(i.startUtc).getTime() > now.getTime())
    .sort((a, b) => (a.startUtc ?? "").localeCompare(b.startUtc ?? ""));
  for (const inst of pending) {
    const start = inst.startUtc as string;
    const parts = localParts(start, series.timezone);
    const minutes = inst.endUtc ? Math.max(5, Math.round((Date.parse(inst.endUtc) - Date.parse(start)) / 60_000)) : series.duration_minutes;
    const planned = planManualBooking({
      title,
      hostUserId: series.host_user_id,
      categoryId,
      date: parts.date,
      time: parts.time,
      durationMinutes: minutes,
      timezone: series.timezone,
      contactId: (svc as { contact_id: string }).contact_id,
      location: { kind: "text", text: series.meet_url ?? "Google Meet" },
    });
    if (!planned.ok) continue;
    const res = await createManualBooking(
      service,
      {
        workspaceId: series.workspace_id,
        workspaceTimezone: series.timezone,
        actorUserId: series.host_user_id,
        plan: planned.plan,
        extraMetadata: {
          series_id: series.id,
          service_id: series.service_id,
          // La fecha ya existe en Google: se vincula, nunca se crea otro evento (booking_google_sync, 00510).
          google_import: { calendar_id: series.google_calendar_id, connection_id: series.google_connection_id, event_id: inst.id, ical_uid: null, organizer_self: true },
        },
      },
      now,
    );
    if (!res.ok) {
      console.warn("[series] una fecha de la serie no se pudo pasar a la Agenda:", res.error);
      continue;
    }
    created++;
  }
  return created;
}

/**
 * Una serie terminada: corta el evento en Google desde ahora y cancela las reuniones futuras (Google avisa a los
 * invitados). Lanza ante un error de Google: el trabajo reintenta.
 */
export async function endSeriesCleanup(service: Db, seriesId: string, now: Date = new Date()): Promise<{ cancelled: number }> {
  const { data } = await svcSchema(service).from("meeting_series").select("*").eq("id", seriesId).maybeSingle();
  const series = data as SeriesRow | null;
  if (!series || series.status !== "ended" || series.google_cleanup === "done") return { cancelled: 0 };
  const { data: cal } = series.google_calendar_id ? await service.from("calendars").select("external_calendar_id").eq("id", series.google_calendar_id).maybeSingle() : { data: null };
  const { data: future } = await service
    .from("bookings")
    .select("id, google_event_id")
    .eq("workspace_id", series.workspace_id)
    .eq("metadata->>series_id", series.id)
    .eq("status_group", "active")
    .gt("start_at", now.toISOString());
  const external = (cal as { external_calendar_id: string } | null)?.external_calendar_id ?? null;
  if (series.google_event_id && series.google_connection_id && external) {
    await cutRecurringEvent({ supabase: service }, series.google_connection_id, external, series.google_event_id, series.rrule, now.toISOString());
    // Una fecha movida más allá del corte es una excepción del evento: se borra aparte (Google ya avisó al cortar).
    for (const b of (future ?? []) as Array<{ google_event_id: string | null }>) {
      if (b.google_event_id) await deleteEvent({ supabase: service }, series.google_connection_id, external, b.google_event_id, "none");
    }
  }
  const ids = ((future ?? []) as Array<{ id: string }>).map((b) => b.id);
  if (ids.length > 0) {
    await service
      .from("bookings")
      .update({ status: "cancelled_other", status_changed_at: now.toISOString(), cancelled_at: now.toISOString(), cancelled_by_type: "system", cancellation_reason: "Terminó la serie" })
      .in("id", ids);
  }
  await svcSchema(service).from("meeting_series").update({ google_cleanup: "done" }).eq("id", series.id);
  return { cancelled: ids.length };
}

/** «Cambiar día y hora»: la serie cambia desde la próxima reunión; las pasadas no se tocan. */
export async function changeSeriesTimeCore(
  service: Db,
  input: { workspaceId: string; itemId: string; date: string; time: string; timezone: string; actorUserId: string },
  now: Date = new Date(),
): Promise<FixSeriesResult> {
  const { data: active } = await svcSchema(service).from("meeting_series").select("id").eq("service_item_id", input.itemId).eq("workspace_id", input.workspaceId).eq("status", "active").maybeSingle();
  if (!active) return { ok: false, code: "not_found", message: "Este paso no tiene una serie fijada." };
  const ended = await svcRpc<string | null>(service, "svc_end_meeting_series", { p_template_id: input.itemId, p_reason: "rescheduled" });
  if (!ended.ok) return { ok: false, code: "google", message: ended.error.message };
  try {
    await endSeriesCleanup(service, (active as { id: string }).id, now);
  } catch {
    // Si Google no respondió, el trabajo `meeting_series_end` lo reintenta.
  }
  return fixMeetingSeriesCore(service, input, now);
}

/** Las series activas de un negocio: sus fechas de las próximas semanas, como reuniones. Para el barrido diario. */
export async function syncWorkspaceSeries(service: Db, workspaceId: string, now: Date = new Date()): Promise<string[]> {
  const { data } = await svcSchema(service).from("meeting_series").select("id").eq("workspace_id", workspaceId).eq("status", "active");
  const problems: string[] = [];
  for (const s of (data ?? []) as Array<{ id: string }>) {
    try {
      await materializeSeries(service, s.id, now);
    } catch (e) {
      problems.push(`meeting_series: ${e instanceof GoogleCalendarError ? e.kind : e instanceof Error ? e.name : "error"}`);
    }
  }
  return problems;
}
