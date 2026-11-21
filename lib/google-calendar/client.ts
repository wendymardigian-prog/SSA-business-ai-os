/**
 * Cliente de Google Calendar (F6): ocupado, calendarios y eventos.
 *
 * Adaptado de Cal.diy (https://github.com/calcom/cal.diy), MIT License,
 * Copyright (c) 2020-present Cal.com, Inc. (CalendarService), con `fetch`
 * directo en vez de googleapis y sobre nuestras tablas.
 *
 * Documentacion consultada el 27/9/2026:
 *   - freeBusy.query: POST /calendar/v3/freeBusy, {timeMin, timeMax, items[]}.
 *     Se parte en tramos de 90 dias, como hace Cal.diy.
 *   - events.insert/patch/delete: conferenceDataVersion=1 para Meet
 *     (createRequest.requestId idempotente, conferenceSolutionKey.type =
 *     hangoutsMeet), sendUpdates=all para que Google mande la invitacion.
 *   - calendarList.list: pagina con nextPageToken (hasta 250 por pagina).
 */

import type { FetchLike } from "@/lib/oauth/types";
import { getAccessToken, type GoogleDeps } from "./auth";
import { GoogleCalendarError, toGoogleCalendarError } from "./errors";

const BASE = "https://www.googleapis.com/calendar/v3";

/** Google limita freebusy a 90 dias por consulta (Cal.diy). */
export const FREEBUSY_CHUNK_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface BusyInterval {
  startUtc: string;
  endUtc: string;
}

export interface GoogleCalendarItem {
  id: string;
  summary: string;
  backgroundColor: string | null;
  accessRole: "owner" | "writer" | "reader" | "freeBusyReader";
  primary: boolean;
  deleted: boolean;
}

export interface CreateEventInput {
  /** El uid de la agenda: es el requestId de Meet y la propiedad privada. */
  bookingUid: string;
  summary: string;
  description: string;
  startUtc: string;
  endUtc: string;
  /** Zona del anfitrion: Google la usa para mostrar el evento bien. */
  timeZone: string;
  attendeeEmail?: string | null;
  attendeeName?: string | null;
  location: { kind: "google_meet" } | { kind: "manual"; text: string | null };
}

export interface CreatedEvent {
  eventId: string;
  iCalUID: string | null;
  meetUrl: string | null;
}

export interface UpdateEventInput {
  startUtc?: string;
  endUtc?: string;
  timeZone?: string;
  description?: string;
  locationText?: string | null;
  /**
   * Agenda v2 (liberar espacio y reasignar). "transparent" = "Disponible":
   * freeBusy.query deja de verlo como ocupado. "opaque" = "Ocupado", el
   * default de Google si nunca se toca.
   */
  transparency?: "opaque" | "transparent";
  /** Agenda v2 (reasignar): reemplaza la lista de invitados del evento. */
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: "accepted" | "declined" | "needsAction" | "tentative" }>;
  /** Agenda v2 (reasignar): deja que un invitado sume o saque invitados del evento. */
  guestsCanModify?: boolean;
  /**
   * A quién le avisa Google. Default "all", como siempre. "none" es para
   * liberar espacio o reasignar sin que el invitado se entere del cambio
   * interno.
   */
  sendUpdates?: "all" | "none" | "externalOnly";
}

async function call(
  deps: GoogleDeps,
  connectionId: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  options: { query?: Record<string, string>; body?: unknown; fallback: string; headers?: Record<string, string> },
): Promise<{ status: number; json: unknown }> {
  const token = await getAccessToken(deps, connectionId);
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, v);

  const fetchImpl: FetchLike = deps.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(options.headers ?? {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (err) {
    throw new GoogleCalendarError(
      err instanceof Error ? err.message : "No pude hablar con Google",
      "temporary",
      null,
      "network",
    );
  }

  const text = await response.text().catch(() => "");
  const json = text ? safeJson(text) : null;
  if (!response.ok) {
    throw toGoogleCalendarError({ status: response.status, body: json, fallbackMessage: options.fallback });
  }
  return { status: response.status, json };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Los tramos de hasta 90 dias que cubren [from, to). */
export function freeBusyChunks(fromUtc: string, toUtc: string): Array<{ timeMin: string; timeMax: string }> {
  const from = new Date(fromUtc).getTime();
  const to = new Date(toUtc).getTime();
  if (!(to > from)) return [];
  const chunkMs = FREEBUSY_CHUNK_DAYS * DAY_MS;
  const chunks: Array<{ timeMin: string; timeMax: string }> = [];
  for (let start = from; start < to; start += chunkMs) {
    const end = Math.min(start + chunkMs, to);
    chunks.push({ timeMin: new Date(start).toISOString(), timeMax: new Date(end).toISOString() });
  }
  return chunks;
}

/**
 * Ocupado en esos calendarios entre dos instantes (freeBusy.query).
 *
 * Un calendario que Google no pudo leer (`errors[]`) es un error temporal:
 * ofrecer horarios sin haber leido un calendario de conflicto es arriesgar
 * una doble reserva.
 */
export async function getBusy(
  deps: GoogleDeps,
  connectionId: string,
  calendarIds: string[],
  fromUtc: string,
  toUtc: string,
): Promise<BusyInterval[]> {
  if (calendarIds.length === 0) return [];
  const busy: BusyInterval[] = [];

  for (const chunk of freeBusyChunks(fromUtc, toUtc)) {
    const { json } = await call(deps, connectionId, "POST", "/freeBusy", {
      body: { timeMin: chunk.timeMin, timeMax: chunk.timeMax, items: calendarIds.map((id) => ({ id })) },
      fallback: "No pude leer los horarios ocupados",
    });
    const calendars = ((json as { calendars?: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: unknown[] }> })?.calendars) ?? {};
    for (const id of calendarIds) {
      const entry = calendars[id];
      if (!entry) continue;
      if (entry.errors && entry.errors.length > 0) {
        throw new GoogleCalendarError(`Google no pudo leer el calendario ${id}`, "temporary", 200, "calendar_error");
      }
      for (const b of entry.busy ?? []) {
        busy.push({ startUtc: new Date(b.start).toISOString(), endUtc: new Date(b.end).toISOString() });
      }
    }
  }
  return busy;
}

/** Los calendarios de la cuenta (calendarList.list), todas las paginas. */
export async function listCalendars(deps: GoogleDeps, connectionId: string): Promise<GoogleCalendarItem[]> {
  const items: GoogleCalendarItem[] = [];
  let pageToken: string | undefined;
  do {
    const { json } = await call(deps, connectionId, "GET", "/users/me/calendarList", {
      query: { maxResults: "250", ...(pageToken ? { pageToken } : {}) },
      fallback: "No pude listar los calendarios",
    });
    const page = json as {
      items?: Array<{ id?: string; summary?: string; summaryOverride?: string; backgroundColor?: string; accessRole?: string; primary?: boolean; deleted?: boolean }>;
      nextPageToken?: string;
    };
    for (const it of page.items ?? []) {
      if (!it.id) continue;
      items.push({
        id: it.id,
        summary: it.summaryOverride ?? it.summary ?? it.id,
        backgroundColor: it.backgroundColor ?? null,
        accessRole: (["owner", "writer", "reader", "freeBusyReader"].includes(it.accessRole ?? "") ? it.accessRole : "reader") as GoogleCalendarItem["accessRole"],
        primary: Boolean(it.primary),
        deleted: Boolean(it.deleted),
      });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return items;
}

/** El cuerpo de events.insert. Expuesto para los tests. */
export function buildEventBody(input: CreateEventInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.startUtc, timeZone: input.timeZone },
    end: { dateTime: input.endUtc, timeZone: input.timeZone },
    extendedProperties: { private: { bookingUid: input.bookingUid } },
  };
  if (input.attendeeEmail) {
    body.attendees = [{ email: input.attendeeEmail, ...(input.attendeeName ? { displayName: input.attendeeName } : {}) }];
  }
  if (input.location.kind === "google_meet") {
    body.conferenceData = {
      createRequest: { requestId: input.bookingUid, conferenceSolutionKey: { type: "hangoutsMeet" } },
    };
  } else if (input.location.text) {
    body.location = input.location.text;
  }
  return body;
}

export async function createEvent(
  deps: GoogleDeps,
  connectionId: string,
  calendarId: string,
  input: CreateEventInput,
): Promise<CreatedEvent> {
  const { json } = await call(deps, connectionId, "POST", `/calendars/${encodeURIComponent(calendarId)}/events`, {
    query: { sendUpdates: "all", ...(input.location.kind === "google_meet" ? { conferenceDataVersion: "1" } : {}) },
    body: buildEventBody(input),
    fallback: "No pude crear el evento en Google Calendar",
  });
  const ev = json as { id?: string; iCalUID?: string; hangoutLink?: string; conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> } };
  if (!ev.id) throw new GoogleCalendarError("Google no devolvio el id del evento", "temporary", 200, "no_event_id");
  const meet = ev.hangoutLink ?? ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ?? null;
  return { eventId: ev.id, iCalUID: ev.iCalUID ?? null, meetUrl: meet };
}

export async function updateEvent(
  deps: GoogleDeps,
  connectionId: string,
  calendarId: string,
  eventId: string,
  input: UpdateEventInput,
): Promise<{ meetUrl: string | null }> {
  const body: Record<string, unknown> = {};
  if (input.startUtc) body.start = { dateTime: input.startUtc, timeZone: input.timeZone };
  if (input.endUtc) body.end = { dateTime: input.endUtc, timeZone: input.timeZone };
  if (input.description !== undefined) body.description = input.description;
  if (input.locationText !== undefined) body.location = input.locationText ?? "";
  if (input.transparency) body.transparency = input.transparency;
  if (input.attendees) body.attendees = input.attendees.map((a) => ({ email: a.email, ...(a.displayName ? { displayName: a.displayName } : {}), ...(a.responseStatus ? { responseStatus: a.responseStatus } : {}) }));
  if (input.guestsCanModify !== undefined) body.guestsCanModify = input.guestsCanModify;
  const { json } = await call(
    deps,
    connectionId,
    "PATCH",
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { query: { sendUpdates: input.sendUpdates ?? "all" }, body, fallback: "No pude actualizar el evento en Google Calendar" },
  );
  const ev = json as { hangoutLink?: string };
  return { meetUrl: ev.hangoutLink ?? null };
}

export type GoogleResponseStatus = "needsAction" | "declined" | "tentative" | "accepted";

export interface GoogleEventAttendee {
  email: string;
  displayName: string | null;
  responseStatus: GoogleResponseStatus;
  self: boolean;
  organizer: boolean;
  optional: boolean;
  /** Una sala o un recurso, no una persona. */
  resource: boolean;
}

/**
 * Un evento tal como lo devuelve events.list / events.get. `id`, `status`, `startUtc` y `endUtc` son lo que usa la
 * ida y vuelta de las reuniones (00430); el resto lo usa la copia de la Agenda (00510).
 */
export interface GoogleEventChange {
  id: string;
  status: "confirmed" | "tentative" | "cancelled";
  /** null = evento de dia entero (o borrado, que viene sin hora). */
  startUtc: string | null;
  endUtc: string | null;
  /** De todo el día: la fecha civil (fin exclusivo, como en Google). */
  allDay: boolean;
  startDate: string | null;
  endDate: string | null;
  timeZone: string | null;
  summary: string | null;
  description: string | null;
  location: string | null;
  htmlLink: string | null;
  meetUrl: string | null;
  etag: string | null;
  iCalUID: string | null;
  recurringEventId: string | null;
  /** Solo en el evento madre de una serie. */
  recurrence: string[] | null;
  organizerEmail: string | null;
  organizerSelf: boolean;
  attendees: GoogleEventAttendee[];
  transparency: "opaque" | "transparent";
  /** default | outOfOffice | focusTime | workingLocation | fromGmail | birthday… */
  eventType: string;
  guestsCanModify: boolean;
  /** El uid de la reunión de la plataforma que creó el evento (extendedProperties.private.bookingUid). */
  bookingUid: string | null;
  updated: string | null;
}

export interface ListEventsResult {
  items: GoogleEventChange[];
  nextSyncToken: string | null;
  /** true = el syncToken caduco (410) y se hizo una lectura completa desde `fullSyncFrom`. */
  fullSync: boolean;
}

function toUtc(v: { dateTime?: string } | undefined): string | null {
  if (!v?.dateTime) return null;
  const ms = Date.parse(v.dateTime);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RESPONSES = new Set(["needsAction", "declined", "tentative", "accepted"]);

interface RawGoogleEvent {
  id?: string;
  status?: string;
  etag?: string;
  iCalUID?: string;
  recurringEventId?: string;
  recurrence?: string[];
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  organizer?: { email?: string; self?: boolean };
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string; self?: boolean; organizer?: boolean; optional?: boolean; resource?: boolean }>;
  transparency?: string;
  eventType?: string;
  guestsCanModify?: boolean;
  extendedProperties?: { private?: Record<string, string> };
  updated?: string;
}

/** Un evento de la API de Google a nuestra forma. null si no trae id. Pura (expuesta para los tests). */
export function parseGoogleEvent(raw: unknown): GoogleEventChange | null {
  const it = (raw ?? {}) as RawGoogleEvent;
  if (!it.id) return null;
  const status = it.status === "cancelled" || it.status === "tentative" ? it.status : "confirmed";
  const startDate = it.start?.date && DATE_RE.test(it.start.date) ? it.start.date : null;
  const endDate = it.end?.date && DATE_RE.test(it.end.date) ? it.end.date : null;
  const attendees: GoogleEventAttendee[] = (it.attendees ?? [])
    .filter((a) => typeof a.email === "string" && a.email.length > 0)
    .map((a) => ({
      email: a.email as string,
      displayName: a.displayName ?? null,
      responseStatus: (RESPONSES.has(a.responseStatus ?? "") ? a.responseStatus : "needsAction") as GoogleResponseStatus,
      self: Boolean(a.self),
      organizer: Boolean(a.organizer),
      optional: Boolean(a.optional),
      resource: Boolean(a.resource),
    }));
  const meet = it.hangoutLink ?? it.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ?? null;
  return {
    id: it.id,
    status,
    startUtc: toUtc(it.start),
    endUtc: toUtc(it.end),
    allDay: Boolean(startDate) && !it.start?.dateTime,
    startDate,
    endDate,
    timeZone: it.start?.timeZone ?? null,
    summary: it.summary ?? null,
    description: it.description ?? null,
    location: it.location ?? null,
    htmlLink: it.htmlLink ?? null,
    meetUrl: meet,
    etag: it.etag ?? null,
    iCalUID: it.iCalUID ?? null,
    recurringEventId: it.recurringEventId ?? null,
    recurrence: Array.isArray(it.recurrence) ? it.recurrence : null,
    organizerEmail: it.organizer?.email ?? null,
    organizerSelf: Boolean(it.organizer?.self),
    attendees,
    transparency: it.transparency === "transparent" ? "transparent" : "opaque",
    eventType: it.eventType ?? "default",
    guestsCanModify: Boolean(it.guestsCanModify),
    bookingUid: it.extendedProperties?.private?.bookingUid ?? null,
    updated: it.updated ?? null,
  };
}

/**
 * Los cambios del calendario desde la ultima lectura, con events.list:
 *   - con `syncToken`: solo lo que cambio (incluye los borrados con status "cancelled");
 *   - sin token, o si Google responde 410 (token caducado): lectura completa desde `fullSyncFrom`, con
 *     showDeleted y singleEvents, y el token nuevo para la proxima.
 * Pagina con nextPageToken; el nextSyncToken llega en la ultima pagina.
 */
export async function listEvents(
  deps: GoogleDeps,
  connectionId: string,
  calendarId: string,
  options: { syncToken: string | null; fullSyncFrom: string; maxPages?: number; fullSyncMaxPages?: number },
): Promise<ListEventsResult> {
  const path = `/calendars/${encodeURIComponent(calendarId)}/events`;
  const read = async (syncToken: string | null): Promise<Omit<ListEventsResult, "fullSync">> => {
    const items: GoogleEventChange[] = [];
    let pageToken: string | null = null;
    let nextSyncToken: string | null = null;
    const maxPages = syncToken ? (options.maxPages ?? 20) : (options.fullSyncMaxPages ?? options.maxPages ?? 20);
    for (let page = 0; page < maxPages; page++) {
      const query: Record<string, string> = { maxResults: "250", showDeleted: "true", singleEvents: "true" };
      if (syncToken) query.syncToken = syncToken;
      else query.timeMin = options.fullSyncFrom;
      if (pageToken) query.pageToken = pageToken;
      const { json } = await call(deps, connectionId, "GET", path, { query, fallback: "No pude leer los cambios de Google Calendar" });
      const body = json as { items?: unknown[]; nextPageToken?: string; nextSyncToken?: string } | null;
      for (const raw of body?.items ?? []) {
        const ev = parseGoogleEvent(raw);
        if (ev) items.push(ev);
      }
      nextSyncToken = body?.nextSyncToken ?? nextSyncToken;
      pageToken = body?.nextPageToken ?? null;
      if (!pageToken) break;
    }
    return { items, nextSyncToken };
  };

  if (options.syncToken) {
    try {
      return { ...(await read(options.syncToken)), fullSync: false };
    } catch (err) {
      // 410 Gone = el token ya no vale: Google pide una lectura completa.
      if (!(err instanceof GoogleCalendarError && err.status === 410)) throw err;
    }
  }
  return { ...(await read(null)), fullSync: true };
}

/** Borra el evento. 404 y 410 (ya no estaba) cuentan como exito. */
export async function deleteEvent(
  deps: GoogleDeps,
  connectionId: string,
  calendarId: string,
  eventId: string,
  /** «all» avisa a los invitados (cancelar). Eliminar una agenda (Papelera) pasa «none»: no se le avisa a nadie. */
  sendUpdates: "all" | "none" = "all",
  /** 00510: con el etag que se vio, Google responde 412 si el evento cambió después (no se borra a ciegas). */
  options: { ifMatch?: string | null } = {},
): Promise<void> {
  try {
    await call(
      deps,
      connectionId,
      "DELETE",
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        query: { sendUpdates },
        fallback: "No pude borrar el evento en Google Calendar",
        ...(options.ifMatch ? { headers: { "If-Match": options.ifMatch } } : {}),
      },
    );
  } catch (err) {
    if (err instanceof GoogleCalendarError && err.kind === "not_found") return;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 00510: usar la Agenda como Google Calendar (leer uno, crear, editar con If-Match).
// ---------------------------------------------------------------------------

export type GoogleEventTime = { dateTime: string; timeZone?: string } | { date: string };

/** Lo que se puede escribir de un evento suelto de Google (no de una reunión de la plataforma). */
export interface GoogleEventWrite {
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  attendees?: Array<{ email: string; displayName?: string | null; responseStatus?: GoogleResponseStatus; optional?: boolean }>;
  transparency?: "opaque" | "transparent";
  /** Pedirle a Google que cree un link de Meet (solo al crear o si todavía no tiene). */
  addMeet?: { requestId: string };
}

/** El cuerpo de events.insert / events.patch para un evento suelto. Pura (expuesta para los tests). */
export function buildEventWriteBody(input: GoogleEventWrite, mode: "insert" | "patch" = "patch"): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  // En un PATCH, pasar de «todo el día» a «con hora» (o al revés) exige vaciar el otro campo con null.
  const time = (t: GoogleEventTime) =>
    "date" in t
      ? { date: t.date, ...(mode === "patch" ? { dateTime: null } : {}) }
      : { dateTime: t.dateTime, ...(t.timeZone ? { timeZone: t.timeZone } : {}), ...(mode === "patch" ? { date: null } : {}) };
  if (input.summary !== undefined) body.summary = input.summary;
  if (input.description !== undefined) body.description = input.description;
  if (input.location !== undefined) body.location = input.location;
  if (input.start) body.start = time(input.start);
  if (input.end) body.end = time(input.end);
  if (input.attendees) {
    body.attendees = input.attendees.map((a) => ({
      email: a.email,
      ...(a.displayName ? { displayName: a.displayName } : {}),
      ...(a.responseStatus ? { responseStatus: a.responseStatus } : {}),
      ...(a.optional ? { optional: true } : {}),
    }));
  }
  if (input.transparency) body.transparency = input.transparency;
  if (input.addMeet) {
    body.conferenceData = { createRequest: { requestId: input.addMeet.requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } };
  }
  return body;
}

function eventPath(calendarId: string, eventId?: string): string {
  return `/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ""}`;
}

function parsedOrThrow(json: unknown): GoogleEventChange {
  const ev = parseGoogleEvent(json);
  if (!ev) throw new GoogleCalendarError("Google no devolvio el evento", "temporary", 200, "no_event_id");
  return ev;
}

export async function getEvent(deps: GoogleDeps, connectionId: string, calendarId: string, eventId: string): Promise<GoogleEventChange> {
  const { json } = await call(deps, connectionId, "GET", eventPath(calendarId, eventId), { fallback: "No pude leer el evento de Google Calendar" });
  return parsedOrThrow(json);
}

export async function insertEvent(
  deps: GoogleDeps,
  connectionId: string,
  calendarId: string,
  input: GoogleEventWrite,
  options: { sendUpdates: "all" | "none" },
): Promise<GoogleEventChange> {
  const { json } = await call(deps, connectionId, "POST", eventPath(calendarId), {
    query: { sendUpdates: options.sendUpdates, ...(input.addMeet ? { conferenceDataVersion: "1" } : {}) },
    body: buildEventWriteBody(input, "insert"),
    fallback: "No pude crear el evento en Google Calendar",
  });
  return parsedOrThrow(json);
}

/**
 * Cambia un evento suelto. Con `ifMatch` (el etag que se vio) Google responde 412 si el evento cambió después: no se
 * pisa lo que alguien cambió en Google mientras tanto.
 */
export async function patchEvent(
  deps: GoogleDeps,
  connectionId: string,
  calendarId: string,
  eventId: string,
  input: GoogleEventWrite,
  options: { sendUpdates: "all" | "none"; ifMatch?: string | null },
): Promise<GoogleEventChange> {
  const { json } = await call(deps, connectionId, "PATCH", eventPath(calendarId, eventId), {
    query: { sendUpdates: options.sendUpdates, ...(input.addMeet ? { conferenceDataVersion: "1" } : {}) },
    body: buildEventWriteBody(input, "patch"),
    fallback: "No pude cambiar el evento en Google Calendar",
    ...(options.ifMatch ? { headers: { "If-Match": options.ifMatch } } : {}),
  });
  return parsedOrThrow(json);
}

/** true si Google respondió 412: el evento cambió desde que se leyó. */
export function isEtagConflict(err: unknown): boolean {
  return err instanceof GoogleCalendarError && err.status === 412;
}
