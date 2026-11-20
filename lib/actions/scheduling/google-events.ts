"use server";

/**
 * Usar la Agenda como Google Calendar (00510): mover, cambiar la duración, editar, crear y borrar eventos de Google,
 * y «Actualizar» la copia.
 *
 * Reglas:
 *   - Todo lo que toca una cuenta de Google es SOLO de su dueña (`scheduling.use` y el calendario es suyo): ni un
 *     Admin toca el Google de otra persona.
 *   - Solo se escribe en calendarios donde se puede (dueño o escritura) y en eventos que organiza quien escribe.
 *   - Con el etag que se vio (If-Match): si el evento cambió en Google después, no se pisa (412 → «actualizá»).
 *   - Después de escribir se actualiza la copia con lo que devolvió Google, para que la Agenda lo muestre ya.
 */
import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { canCreateEvents } from "@/lib/social/google-calendar";
import { deleteEvent, getEvent, insertEvent, isEtagConflict, patchEvent, type GoogleEventChange, type GoogleEventWrite } from "@/lib/google-calendar/client";
import { GoogleCalendarError } from "@/lib/google-calendar/errors";
import { toMirrorRow } from "@/lib/google-calendar/mirror";
import { canEditGoogleEvent, shiftSeries } from "@/lib/google-calendar/agenda";
import { syncCalendarInbound } from "@/lib/jobs/handlers/google-calendar-inbound";

const AGENDA_PATH = "/dashboard/agenda";

export type GoogleEventActionResult = { ok: true } | { ok: false; error: string; conflict?: boolean };

const MSG = {
  noPermission: "No tenés permiso para tener una agenda",
  notYours: "Ese evento no es de tu Google Calendar",
  readOnly: "Ese evento no se puede cambiar desde acá: no lo organizás vos o el calendario es de solo lectura.",
  conflict: "Cambió en Google mientras lo mirabas. Tocá «Actualizar» y probá de nuevo.",
  reconnect: "Google ya no da acceso a esta cuenta. Reconectala en Ajustes de calendarios.",
  temporary: "Google no respondió. Probá de nuevo en un rato.",
  badRange: "La hora de fin tiene que ser después de la de inicio.",
} as const;

type Service = Awaited<ReturnType<typeof createServiceClient>>;

interface OwnEvent {
  id: string;
  calendar_id: string;
  external_event_id: string;
  recurring_event_id: string | null;
  etag: string | null;
  organizer_self: boolean;
  google_event_type: string;
  start_at: string;
  end_at: string;
  time_zone: string | null;
  calendar: { id: string; workspace_id: string; user_id: string; connection_id: string; external_calendar_id: string; access_role: string };
}

function errorMessage(err: unknown): GoogleEventActionResult {
  if (isEtagConflict(err)) return { ok: false, error: MSG.conflict, conflict: true };
  if (err instanceof GoogleCalendarError) {
    if (err.status === 401 || err.reason === "invalid_grant") return { ok: false, error: MSG.reconnect };
    if (err.kind === "not_found") return { ok: false, error: "Ese evento ya no está en Google. Tocá «Actualizar».", conflict: true };
    if (err.kind === "permanent") return { ok: false, error: MSG.readOnly };
  }
  return { ok: false, error: MSG.temporary };
}

async function ownCalendar(service: Service, workspaceId: string, userId: string, calendarId: string) {
  const { data: cal } = await service
    .from("calendars")
    .select("id, workspace_id, user_id, connection_id, external_calendar_id, access_role, is_active, show_in_agenda")
    .eq("id", calendarId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!cal || cal.user_id !== userId || !cal.is_active) return null;
  const { data: conn } = await service.from("oauth_connections").select("status, granted_scopes").eq("id", cal.connection_id).maybeSingle();
  if (!conn || conn.status === "revoked" || conn.status === "error" || !canCreateEvents(conn.granted_scopes ?? [])) return null;
  return cal;
}

/** El evento de la copia, si es de quien pide y se puede escribir. */
async function loadOwnEvent(service: Service, workspaceId: string, userId: string, id: string): Promise<{ event: OwnEvent } | { error: string }> {
  const { data: ev } = await service
    .from("google_calendar_events")
    .select("id, calendar_id, user_id, workspace_id, external_event_id, recurring_event_id, etag, organizer_self, google_event_type, start_at, end_at, time_zone, booking_id")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!ev || ev.user_id !== userId) return { error: MSG.notYours };
  if (ev.booking_id) return { error: "Ese evento es de una reunión: cambialo desde la reunión." };
  const cal = await ownCalendar(service, workspaceId, userId, ev.calendar_id);
  if (!cal) return { error: MSG.notYours };
  if (!canEditGoogleEvent({ accessRole: cal.access_role, organizerSelf: ev.organizer_self, eventType: ev.google_event_type })) return { error: MSG.readOnly };
  return { event: { ...ev, calendar: cal } };
}

/** Guarda en la copia lo que devolvió Google (o lo borra si ya no corresponde). */
async function saveMirror(service: Service, cal: OwnEvent["calendar"], ev: GoogleEventChange): Promise<void> {
  const d = toMirrorRow(ev, { id: cal.id, workspace_id: cal.workspace_id, user_id: cal.user_id, connection_id: cal.connection_id }, new Date());
  if (d.kind === "delete") {
    await service.from("google_calendar_events").delete().eq("calendar_id", cal.id).eq("external_event_id", ev.id);
    return;
  }
  await service.from("google_calendar_events").upsert(d.row as never, { onConflict: "calendar_id,external_event_id" });
}

/** Después de cambiar una serie, las instancias cambian en Google: se relee el calendario (incremental). */
async function resyncCalendar(service: Service, calendarId: string): Promise<void> {
  try {
    await syncCalendarInbound({ supabase: service }, calendarId);
  } catch (err) {
    console.warn(`[agenda] no pude releer el calendario después de un cambio: ${err instanceof Error ? err.message : "error"}`);
  }
}

function deps(service: Service) {
  return { supabase: service };
}

// ── Actualizar ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Relee mis calendarios con «Mostrar en Agenda» si la última lectura tiene más de un minuto. Tope de 5 segundos. */
export async function refreshMyGoogleEvents(options: { force?: boolean } = {}): Promise<{ ok: boolean; refreshed: number }> {
  const ctx = await getPermissionAction("scheduling.use");
  if (!ctx) return { ok: false, refreshed: 0 };
  const service = await createServiceClient();
  const cutoff = Date.now() - (options.force ? 5_000 : 60_000);
  const { data: cals } = await service
    .from("calendars")
    .select("id, events_synced_at")
    .eq("workspace_id", ctx.workspace.id)
    .eq("user_id", ctx.user.id)
    .eq("is_active", true)
    .eq("show_in_agenda", true);
  const due = (cals ?? []).filter((c) => !c.events_synced_at || Date.parse(c.events_synced_at) < cutoff);
  if (due.length === 0) return { ok: true, refreshed: 0 };

  let refreshed = 0;
  const work = Promise.all(
    due.map(async (c) => {
      const r = await syncCalendarInbound({ supabase: service }, c.id).catch(() => null);
      if (r && !r.error) refreshed++;
    }),
  );
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  return { ok: true, refreshed };
}

// ── Mover y cambiar la duración ───────────────────────────────────────────────────────────────────────────────────

export async function moveGoogleEvent(input: {
  id: string;
  startUtc: string;
  durationMinutes: number;
  scope: "instance" | "series";
  notify: boolean;
}): Promise<GoogleEventActionResult> {
  const ctx = await getPermissionAction("scheduling.use");
  if (!ctx) return { ok: false, error: MSG.noPermission };
  if (!Number.isFinite(Date.parse(input.startUtc)) || !(input.durationMinutes >= 5 && input.durationMinutes <= 24 * 60)) {
    return { ok: false, error: MSG.badRange };
  }
  const service = await createServiceClient();
  const loaded = await loadOwnEvent(service, ctx.workspace.id, ctx.user.id, input.id);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { event } = loaded;
  const sendUpdates = input.notify ? "all" : "none";

  try {
    if (input.scope === "series" && event.recurring_event_id) {
      // El evento madre se corre lo mismo que la instancia. Una serie con hora necesita su zona.
      const master = await getEvent(deps(service), event.calendar.connection_id, event.calendar.external_calendar_id, event.recurring_event_id);
      if (!master.startUtc) return { ok: false, error: MSG.readOnly };
      const next = shiftSeries({
        masterStartUtc: master.startUtc,
        instanceStartUtc: event.start_at,
        newInstanceStartUtc: input.startUtc,
        newDurationMinutes: input.durationMinutes,
      });
      const tz = master.timeZone ?? event.time_zone ?? "UTC";
      await patchEvent(
        deps(service),
        event.calendar.connection_id,
        event.calendar.external_calendar_id,
        master.id,
        { start: { dateTime: next.startUtc, timeZone: tz }, end: { dateTime: next.endUtc, timeZone: tz } },
        { sendUpdates, ifMatch: master.etag },
      );
      await resyncCalendar(service, event.calendar.id);
    } else {
      const endUtc = new Date(Date.parse(input.startUtc) + input.durationMinutes * 60_000).toISOString();
      const tz = event.time_zone ?? undefined;
      const updated = await patchEvent(
        deps(service),
        event.calendar.connection_id,
        event.calendar.external_calendar_id,
        event.external_event_id,
        { start: { dateTime: input.startUtc, ...(tz ? { timeZone: tz } : {}) }, end: { dateTime: endUtc, ...(tz ? { timeZone: tz } : {}) } },
        { sendUpdates, ifMatch: event.etag },
      );
      await saveMirror(service, event.calendar, updated);
    }
  } catch (err) {
    return errorMessage(err);
  }
  revalidatePath(AGENDA_PATH);
  return { ok: true };
}

// ── Editar ───────────────────────────────────────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function updateGoogleEvent(input: {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  /** La lista completa de invitados (emails). Sin la clave, no se tocan. */
  guests?: string[];
  scope: "instance" | "series";
  notify: boolean;
}): Promise<GoogleEventActionResult> {
  const ctx = await getPermissionAction("scheduling.use");
  if (!ctx) return { ok: false, error: MSG.noPermission };
  const service = await createServiceClient();
  const loaded = await loadOwnEvent(service, ctx.workspace.id, ctx.user.id, input.id);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { event } = loaded;

  const patch: GoogleEventWrite = {};
  if (input.summary !== undefined) patch.summary = input.summary.trim().slice(0, 500);
  if (input.description !== undefined) patch.description = input.description.slice(0, 8000);
  if (input.location !== undefined) patch.location = input.location.trim().slice(0, 500);

  try {
    const target = input.scope === "series" && event.recurring_event_id ? event.recurring_event_id : event.external_event_id;
    if (input.guests) {
      const emails = [...new Set(input.guests.map((g) => g.trim().toLowerCase()).filter(Boolean))];
      const bad = emails.find((e) => !EMAIL_RE.test(e));
      if (bad) return { ok: false, error: `«${bad}» no parece un email.` };
      if (emails.length > 100) return { ok: false, error: "Hasta 100 invitados." };
      // Se conserva lo que Google ya sabía de cada invitado (su respuesta, si es una sala) y se suma o saca el resto.
      const current = await getEvent(deps(service), event.calendar.connection_id, event.calendar.external_calendar_id, target);
      const keep = current.attendees.filter((a) => a.self || a.resource || emails.includes(a.email.toLowerCase()));
      const known = new Set(keep.map((a) => a.email.toLowerCase()));
      patch.attendees = [
        ...keep.map((a) => ({ email: a.email, displayName: a.displayName, responseStatus: a.responseStatus, optional: a.optional })),
        ...emails.filter((e) => !known.has(e)).map((email) => ({ email })),
      ];
    }
    const updated = await patchEvent(deps(service), event.calendar.connection_id, event.calendar.external_calendar_id, target, patch, {
      sendUpdates: input.notify ? "all" : "none",
      ifMatch: target === event.external_event_id ? event.etag : null,
    });
    if (target === event.external_event_id) await saveMirror(service, event.calendar, updated);
    else await resyncCalendar(service, event.calendar.id);
  } catch (err) {
    return errorMessage(err);
  }
  revalidatePath(AGENDA_PATH);
  return { ok: true };
}

// ── Borrar ───────────────────────────────────────────────────────────────────────────────────────────────────────

export async function deleteGoogleEvent(input: { id: string; scope: "instance" | "series"; notify: boolean }): Promise<GoogleEventActionResult> {
  const ctx = await getPermissionAction("scheduling.use");
  if (!ctx) return { ok: false, error: MSG.noPermission };
  const service = await createServiceClient();
  const loaded = await loadOwnEvent(service, ctx.workspace.id, ctx.user.id, input.id);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { event } = loaded;
  const series = input.scope === "series" && !!event.recurring_event_id;
  try {
    await deleteEvent(
      deps(service),
      event.calendar.connection_id,
      event.calendar.external_calendar_id,
      series ? (event.recurring_event_id as string) : event.external_event_id,
      input.notify ? "all" : "none",
      { ifMatch: series ? null : event.etag },
    );
  } catch (err) {
    return errorMessage(err);
  }
  if (series) {
    await service.from("google_calendar_events").delete().eq("calendar_id", event.calendar.id).eq("recurring_event_id", event.recurring_event_id as string);
    await resyncCalendar(service, event.calendar.id);
  } else {
    await service.from("google_calendar_events").delete().eq("id", event.id);
  }
  revalidatePath(AGENDA_PATH);
  return { ok: true };
}

// ── Crear ────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function createGoogleEvent(input: {
  calendarId: string;
  summary: string;
  description?: string;
  location?: string;
  /** Con hora: inicio en UTC y duración. De todo el día: la fecha civil. */
  startUtc?: string;
  durationMinutes?: number;
  allDayDate?: string;
  timeZone: string;
  guests?: string[];
  addMeet?: boolean;
  /** «Ocupado» (default) o «Disponible». */
  busy?: boolean;
  notify: boolean;
}): Promise<GoogleEventActionResult & { id?: string }> {
  const ctx = await getPermissionAction("scheduling.use");
  if (!ctx) return { ok: false, error: MSG.noPermission };
  const summary = input.summary.trim().slice(0, 500);
  if (!summary) return { ok: false, error: "Ponele un título." };
  const service = await createServiceClient();
  const cal = await ownCalendar(service, ctx.workspace.id, ctx.user.id, input.calendarId);
  if (!cal) return { ok: false, error: "Elegí uno de tus calendarios de Google." };
  if (cal.access_role !== "owner" && cal.access_role !== "writer") return { ok: false, error: "En ese calendario no se pueden crear eventos." };

  const write: GoogleEventWrite = { summary };
  if (input.allDayDate && /^\d{4}-\d{2}-\d{2}$/.test(input.allDayDate)) {
    const next = new Date(`${input.allDayDate}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    write.start = { date: input.allDayDate };
    write.end = { date: next.toISOString().slice(0, 10) };
  } else {
    const startMs = Date.parse(input.startUtc ?? "");
    const minutes = input.durationMinutes ?? 0;
    if (!Number.isFinite(startMs) || !(minutes >= 5 && minutes <= 24 * 60)) return { ok: false, error: MSG.badRange };
    write.start = { dateTime: new Date(startMs).toISOString(), timeZone: input.timeZone };
    write.end = { dateTime: new Date(startMs + minutes * 60_000).toISOString(), timeZone: input.timeZone };
  }
  if (input.description?.trim()) write.description = input.description.slice(0, 8000);
  if (input.location?.trim()) write.location = input.location.trim().slice(0, 500);
  if (input.busy === false) write.transparency = "transparent";
  if (input.guests?.length) {
    const emails = [...new Set(input.guests.map((g) => g.trim().toLowerCase()).filter(Boolean))];
    const bad = emails.find((e) => !EMAIL_RE.test(e));
    if (bad) return { ok: false, error: `«${bad}» no parece un email.` };
    write.attendees = emails.slice(0, 100).map((email) => ({ email }));
  }
  if (input.addMeet) write.addMeet = { requestId: crypto.randomUUID() };

  try {
    const created = await insertEvent(deps(service), cal.connection_id, cal.external_calendar_id, write, { sendUpdates: input.notify ? "all" : "none" });
    // Solo se copia si ese calendario se ve en la Agenda (si no, nadie mantendría la copia).
    if (!cal.show_in_agenda) {
      revalidatePath(AGENDA_PATH);
      return { ok: true };
    }
    await saveMirror(service, cal, created);
    const { data: row } = await service.from("google_calendar_events").select("id").eq("calendar_id", cal.id).eq("external_event_id", created.id).maybeSingle();
    revalidatePath(AGENDA_PATH);
    return { ok: true, id: row?.id };
  } catch (err) {
    return errorMessage(err);
  }
}
