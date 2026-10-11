/**
 * El cliente de la API de Fathom (F8). Solo habla con tres cosas:
 * `GET /meetings`, `GET /recordings/{id}/transcript` y (en el adaptador de
 * OAuth) `/users/me`.
 *
 * - Cada pedido cuesta del presupuesto de la corrida (`rate-budget.ts`).
 * - Pagina con `cursor` / `next_cursor`, pide solo lo nuevo con `created_after`
 *   y solo las llamadas de los closers con `recorded_by[]`.
 * - Un 429 o un 5xx lanzan `FathomError` TEMPORAL (nunca matan la conexion); un
 *   401 lanza `permanent` con `status 401` para que la ingesta fuerce UNA
 *   renovacion; un 404 de transcripcion es una transcripcion vacia.
 * - `fetchImpl` por parametro: en la corrida de construccion no se llama a Fathom.
 *
 * `include_transcript` NO esta disponible para apps OAuth: la transcripcion se
 * pide aparte. Nunca se pide el resumen ni los action items de Fathom.
 */

import type { CallAttendee, CallTranscriptLine } from "@/lib/types/database";
import { FATHOM_API_BASE } from "./api-constants";
import { FathomError } from "./errors";
import { retryAfterMs, type RequestBudget } from "./rate-budget";

type FetchLike = typeof fetch;

export interface FathomInvitee {
  name?: string | null;
  email?: string | null;
  email_domain?: string | null;
  is_external?: boolean | null;
}

/** Una reunion como la lista Fathom (los campos que usamos). */
export interface FathomMeeting {
  title?: string | null;
  meeting_title?: string | null;
  url?: string | null;
  share_url?: string | null;
  created_at?: string | null;
  scheduled_start_time?: string | null;
  scheduled_end_time?: string | null;
  recording_id?: number | string | null;
  recording_start_time?: string | null;
  recording_end_time?: string | null;
  transcript_language?: string | null;
  calendar_invitees?: FathomInvitee[] | null;
  recorded_by?: { name?: string | null; email?: string | null } | null;
  [key: string]: unknown;
}

export interface ApiDeps {
  accessToken: string;
  budget: RequestBudget;
  fetchImpl?: FetchLike;
  now?: () => number;
}

/** Se agoto el presupuesto de pedidos de esta corrida: no es un error, es "seguir despues". */
export class BudgetExhausted extends Error {
  constructor() {
    super("presupuesto de pedidos agotado");
    this.name = "BudgetExhausted";
  }
}

async function call(deps: ApiDeps, url: string, what: string): Promise<Response> {
  if (!deps.budget.take()) throw new BudgetExhausted();
  let response: Response;
  try {
    response = await (deps.fetchImpl ?? fetch)(url, { headers: { Authorization: `Bearer ${deps.accessToken}` } });
  } catch {
    throw new FathomError(`No pude comunicarme con Fathom (${what})`, "temporary");
  }
  if (response.status === 429) {
    throw new FathomError("Fathom pidió esperar", "temporary", 429, "rate_limited", retryAfterMs(response.headers.get("retry-after"), deps.now?.()));
  }
  if (response.status >= 500) {
    throw new FathomError(`Fathom respondió ${response.status} (${what})`, "temporary", response.status);
  }
  if (response.status === 401) {
    throw new FathomError("Fathom no aceptó el acceso", "permanent", 401, "unauthorized");
  }
  return response;
}

export interface ListParams {
  /** Solo reuniones creadas despues de este instante (ISO). */
  createdAfter?: string | null;
  /** Los correos de los closers: solo se piden sus grabaciones. */
  recordedBy: string[];
  cursor?: string | null;
}

export interface MeetingsPage {
  items: FathomMeeting[];
  nextCursor: string | null;
}

export async function listMeetings(deps: ApiDeps, params: ListParams): Promise<MeetingsPage> {
  const url = new URL(`${FATHOM_API_BASE}/meetings`);
  if (params.createdAfter) url.searchParams.set("created_after", params.createdAfter);
  for (const email of params.recordedBy) url.searchParams.append("recorded_by[]", email);
  if (params.cursor) url.searchParams.set("cursor", params.cursor);

  const response = await call(deps, url.toString(), "lista de reuniones");
  if (!response.ok) {
    throw new FathomError(`Fathom respondió ${response.status} al listar reuniones`, "permanent", response.status);
  }
  const json = (await response.json().catch(() => ({}))) as { items?: FathomMeeting[]; next_cursor?: string | null };
  return { items: Array.isArray(json.items) ? json.items : [], nextCursor: json.next_cursor || null };
}

/**
 * La transcripcion de una grabacion. Un 404 o una respuesta sin transcripcion
 * da `[]`: la llamada se guarda igual (la regla de duracion o "por revisar" decide).
 */
export async function getTranscript(deps: ApiDeps, recordingId: number | string): Promise<CallTranscriptLine[]> {
  const response = await call(deps, `${FATHOM_API_BASE}/recordings/${encodeURIComponent(String(recordingId))}/transcript`, "transcripción");
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new FathomError(`Fathom respondió ${response.status} al pedir la transcripción`, "permanent", response.status);
  }
  const json = (await response.json().catch(() => ({}))) as { transcript?: unknown };
  return normalizeTranscript(json.transcript);
}

/** La transcripcion de Fathom al formato de `calls.transcript`, tolerante a lo que falte. */
export function normalizeTranscript(raw: unknown): CallTranscriptLine[] {
  if (!Array.isArray(raw)) return [];
  const out: CallTranscriptLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as { speaker?: { display_name?: unknown; matched_calendar_invitee_email?: unknown } | null; text?: unknown; timestamp?: unknown };
    const text = typeof o.text === "string" ? o.text.trim() : "";
    if (!text) continue;
    const line: CallTranscriptLine & { speaker: CallTranscriptLine["speaker"] & { matched_calendar_invitee_email?: string } } = {
      speaker: { display_name: typeof o.speaker?.display_name === "string" ? o.speaker.display_name : "" },
      text,
      timestamp: typeof o.timestamp === "string" ? o.timestamp : "",
    };
    if (typeof o.speaker?.matched_calendar_invitee_email === "string") line.speaker.matched_calendar_invitee_email = o.speaker.matched_calendar_invitee_email;
    out.push(line);
  }
  return out;
}

/** Los invitados de una reunion al formato de `calls.attendees`. */
export function toAttendees(invitees: FathomInvitee[] | null | undefined): CallAttendee[] {
  return (Array.isArray(invitees) ? invitees : []).map((i) => ({
    name: i?.name ?? null,
    email: i?.email ?? null,
    is_external: typeof i?.is_external === "boolean" ? i.is_external : null,
  }));
}

/** Segundos entre dos instantes ISO; null si falta uno o no es positivo. */
export function secondsBetween(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null;
  const d = (new Date(end).getTime() - new Date(start).getTime()) / 1000;
  return Number.isFinite(d) && d > 0 ? Math.round(d) : null;
}
