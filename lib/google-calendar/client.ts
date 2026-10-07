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
}

async function call(
  deps: GoogleDeps,
  connectionId: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  options: { query?: Record<string, string>; body?: unknown; fallback: string },
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
  const { json } = await call(
    deps,
    connectionId,
    "PATCH",
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { query: { sendUpdates: "all" }, body, fallback: "No pude actualizar el evento en Google Calendar" },
  );
  const ev = json as { hangoutLink?: string };
  return { meetUrl: ev.hangoutLink ?? null };
}

/** Borra el evento. 404 y 410 (ya no estaba) cuentan como exito. */
export async function deleteEvent(
  deps: GoogleDeps,
  connectionId: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  try {
    await call(
      deps,
      connectionId,
      "DELETE",
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { query: { sendUpdates: "all" }, fallback: "No pude borrar el evento en Google Calendar" },
    );
  } catch (err) {
    if (err instanceof GoogleCalendarError && err.kind === "not_found") return;
    throw err;
  }
}
