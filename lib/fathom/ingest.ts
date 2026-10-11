/**
 * La ingesta de una conexion de Fathom (F8): trae las llamadas NUEVAS de los
 * closers, las vincula a su contacto y su agenda, las guarda y las manda a
 * clasificar.
 *
 * Reglas que no se rompen:
 *  - Pagina (`cursor`), pide solo lo nuevo (`created_after` con 2 h de
 *    solapamiento sobre la marca de agua) y solo lo de los closers
 *    (`recorded_by[]`), con un doble control en codigo.
 *  - Presupuesto de 9 pedidos por corrida; si queda trabajo, guarda el cursor y
 *    se REENCOLA a +70 s. La marca de agua solo avanza al terminar una pasada.
 *  - Un 429 o un 5xx NUNCA pasan la conexion a `error`.
 *  - Un 401 fuerza UNA renovacion; si vuelve el 401, la conexion cae y se avisa
 *    a la persona.
 *  - NUNCA crea contactos. La misma llamada dos veces es una sola fila
 *    (unico por `external_id`).
 *  - Una llamada borrada en Fathom no se borra aca.
 *
 * Todo lo que habla con afuera entra por `deps` (`fetchImpl`, `now`): en la
 * corrida de construccion no se llama a Fathom.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { auditAsWebhook } from "@/lib/audit";
import { countPeople } from "@/lib/calls/classification";
import { computeAutoLink, externalEmailsOf, type BookingCandidate, type ContactCandidate } from "@/lib/calls/linking";
import { scheduleJob } from "@/lib/scheduler";
import { BudgetExhausted, getTranscript, listMeetings, secondsBetween, toAttendees, type FathomMeeting } from "./api";
import {
  forceFathomRefresh,
  getFathomAccessToken,
  loadFathomConnection,
  markFathomConnectionError,
  type FathomConnection,
  type FathomDeps,
} from "./auth";
import { buildCloserByEmail, closerEmails, normalizeFathomEmail, type CloserCandidate } from "./closers";
import { FathomError } from "./errors";
import { CONTINUATION_DELAY_MS, createRequestBudget } from "./rate-budget";
import { requeueFathomSync } from "./queue";

type Db = SupabaseClient<Database>;

/** Cuanto se mira hacia atras la primera vez, y cuanto se solapa la marca de agua. */
export const INITIAL_WINDOW_MS = 14 * 24 * 3600_000;
export const WATERMARK_OVERLAP_MS = 2 * 3600_000;
/** `sync_cursor` = esto significa "estoy a mitad de una pasada, en la primera pagina". */
export const FIRST_PAGE = "start";

export interface IngestDeps extends FathomDeps {
  /** Para los tests: reemplaza la lectura/renovacion del token. */
  tokenProvider?: { get: (connectionId: string) => Promise<string>; force: (connectionId: string) => Promise<string> };
  /** Encola la clasificacion de una llamada nueva. */
  enqueueClassify?: (callId: string) => Promise<void>;
  /** Se llama cuando una llamada nueva queda vinculada a un contacto (L3: dispara `call_linked`). */
  onLinked?: (info: { callId: string; contactId: string; workspaceId: string }) => Promise<void>;
}

export type SyncOutcome = "complete" | "continued" | "rate_limited" | "temporary_error" | "reconnect" | "inactive" | "no_closers";

export interface SyncResult {
  outcome: SyncOutcome;
  ingested: number;
  skippedExisting: number;
  skippedNotCloser: number;
  requests: number;
  error?: string;
}

const empty = (outcome: SyncOutcome): SyncResult => ({ outcome, ingested: 0, skippedExisting: 0, skippedNotCloser: 0, requests: 0 });

// ── Los closers del workspace ─────────────────────────────────────────────

export async function loadCloserCandidates(supabase: Db, workspaceId: string): Promise<CloserCandidate[]> {
  const [{ data: profiles }, { data: rows }] = await Promise.all([
    supabase.rpc("workspace_member_profiles", { p_workspace_id: workspaceId }),
    supabase.from("workspace_members").select("user_id, is_closer, closer_emails").eq("workspace_id", workspaceId),
  ]);
  const emailByUser = new Map((profiles ?? []).map((p) => [p.user_id, p.email ?? null]));
  return (rows ?? []).map((r) => ({
    userId: r.user_id,
    email: emailByUser.get(r.user_id) ?? null,
    isCloser: r.is_closer === true,
    closerEmails: r.closer_emails ?? [],
  }));
}

// ── Candidatos para vincular (dos consultas por llamada) ──────────────────

/** Solo caracteres que pueden ser parte de un correo: este texto va dentro de un filtro `or` de PostgREST. */
function safeEmail(e: string): string | null {
  const n = normalizeFathomEmail(e);
  return n && /^[a-z0-9._%+\-@]+$/.test(n) ? n.replace(/%/g, "") : null;
}

async function loadContactCandidates(supabase: Db, workspaceId: string, emails: string[]): Promise<ContactCandidate[]> {
  const safe = emails.map(safeEmail).filter((e): e is string => !!e).slice(0, 10);
  if (safe.length === 0) return [];
  const { data } = await supabase
    .from("contacts")
    .select("id, created_at, email, secondary_email")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .or(safe.map((e) => `email.ilike.${e},secondary_email.ilike.${e}`).join(","));
  return (data ?? []) as ContactCandidate[];
}

async function loadBookingCandidates(
  supabase: Db,
  workspaceId: string,
  recordedAt: string,
  contactIds: string[],
  emails: string[],
): Promise<BookingCandidate[]> {
  const safe = emails.map(safeEmail).filter((e): e is string => !!e).slice(0, 10);
  const parts = [
    ...(contactIds.length > 0 ? [`contact_id.in.(${contactIds.join(",")})`] : []),
    ...safe.map((e) => `booker_email.ilike.${e}`),
  ];
  if (parts.length === 0) return [];
  const at = new Date(recordedAt).getTime();
  const { data } = await supabase
    .from("bookings")
    .select("id, contact_id, host_user_id, start_at, created_at, booker_email, status_group")
    .eq("workspace_id", workspaceId)
    .gte("start_at", new Date(at - 4 * 3600_000).toISOString())
    .lte("start_at", new Date(at + 4 * 3600_000).toISOString())
    .or(parts.join(","));
  return (data ?? []) as BookingCandidate[];
}

// ── La corrida ────────────────────────────────────────────────────────────

export async function syncFathomConnection(deps: IngestDeps, connectionId: string): Promise<SyncResult> {
  const clock = deps.now ?? (() => new Date());
  const now = clock();
  const db = deps.supabase;

  let connection: FathomConnection & { sync_watermark: string | null; sync_cursor: string | null };
  try {
    const base = await loadFathomConnection(db, connectionId);
    const { data } = await db.from("oauth_connections").select("sync_watermark, sync_cursor").eq("id", connectionId).maybeSingle();
    connection = { ...base, sync_watermark: data?.sync_watermark ?? null, sync_cursor: data?.sync_cursor ?? null };
  } catch {
    return empty("inactive");
  }
  if (connection.status !== "active" && connection.status !== "attention") return empty("inactive");

  // La persona ya no esta en el workspace: no se consulta nada.
  const candidates = await loadCloserCandidates(db, connection.workspace_id);
  if (connection.user_id && !candidates.some((c) => c.userId === connection.user_id)) return empty("inactive");

  const byEmail = buildCloserByEmail(candidates);
  if (byEmail.size === 0) return empty("no_closers"); // sin closers no se pide nada

  const budget = createRequestBudget();
  const result = empty("complete");
  const tokenFor = deps.tokenProvider ?? { get: (id: string) => getFathomAccessToken(deps, id), force: (id: string) => forceFathomRefresh(deps, id) };

  // El estado de la pasada: la pagina que se esta leyendo (null = la primera).
  let pageCursor: string | null = connection.sync_cursor && connection.sync_cursor !== FIRST_PAGE ? connection.sync_cursor : null;
  let maxCreated: string | null = null;

  const createdAfter = new Date(
    (connection.sync_watermark ? new Date(connection.sync_watermark).getTime() - WATERMARK_OVERLAP_MS : now.getTime() - INITIAL_WINDOW_MS),
  ).toISOString();

  // Si ni siquiera se pudo leer una pagina, no hay pasada a medias que recordar.
  let progressed = false;
  const saveProgress = async (extra: { sync_last_error?: string | null } = {}) => {
    await db
      .from("oauth_connections")
      .update({ ...(progressed ? { sync_cursor: pageCursor ?? FIRST_PAGE } : {}), ...extra })
      .eq("id", connectionId);
  };

  let accessToken: string;
  try {
    accessToken = await tokenFor.get(connectionId);
  } catch (err) {
    return failWithoutToken(db, connectionId, err, result);
  }

  /** Un pedido con UNA renovacion forzada si Fathom contesta 401. */
  let retried401 = false;
  async function withAuth<T>(fn: (token: string) => Promise<T>): Promise<T> {
    try {
      return await fn(accessToken);
    } catch (err) {
      if (err instanceof FathomError && err.status === 401 && !retried401) {
        retried401 = true;
        accessToken = await tokenFor.force(connectionId);
        return fn(accessToken);
      }
      throw err;
    }
  }
  const api = () => ({ accessToken, budget, fetchImpl: deps.fetchImpl, now: () => now.getTime() });

  try {
    for (;;) {
      const page = await withAuth(() => listMeetings(api(), { createdAfter, recordedBy: closerEmails(byEmail), cursor: pageCursor }));
      result.requests = budget.used;
      progressed = true;

      for (const m of page.items) if (m.created_at && (!maxCreated || m.created_at > maxCreated)) maxCreated = m.created_at;

      // Doble control: solo las que grabo un closer.
      const mine: Array<{ m: FathomMeeting; externalId: string; closerId: string }> = [];
      for (const m of page.items) {
        if (m.recording_id === null || m.recording_id === undefined || m.recording_id === "") continue; // sin id no se puede guardar
        const closerId = byEmail.get(normalizeFathomEmail(m.recorded_by?.email) ?? "");
        if (!closerId) { result.skippedNotCloser++; continue; }
        mine.push({ m, externalId: String(m.recording_id), closerId });
      }

      // Cuales ya existen: una consulta por pagina, no una por reunion.
      const known = new Set<string>();
      if (mine.length > 0) {
        const { data: existing } = await db
          .from("calls")
          .select("external_id")
          .eq("workspace_id", connection.workspace_id)
          .eq("source", "fathom")
          .in("external_id", mine.map((x) => x.externalId));
        for (const row of existing ?? []) if (row.external_id) known.add(row.external_id);
      }

      for (const item of mine) {
        if (known.has(item.externalId)) { result.skippedExisting++; continue; }
        const transcript = await withAuth(() => getTranscript(api(), item.m.recording_id as number | string));
        result.requests = budget.used;
        const created = await saveCall(deps, connection, item.m, item.externalId, item.closerId, transcript, byEmail, candidates);
        if (created === "created") result.ingested++;
        else result.skippedExisting++;
      }

      if (!page.nextCursor) break;
      pageCursor = page.nextCursor;
    }
  } catch (err) {
    return handleRunError(deps, connection, err, result, pageCursor, saveProgress);
  }

  // Pasada completa: ahora si avanza la marca de agua.
  const watermark = [connection.sync_watermark, maxCreated].filter((x): x is string => !!x).sort().pop() ?? null;
  await db
    .from("oauth_connections")
    .update({ sync_cursor: null, sync_watermark: watermark, last_synced_at: now.toISOString(), sync_last_error: null })
    .eq("id", connectionId);
  result.requests = budget.used;
  return { ...result, outcome: "complete" };
}

// ── Guardar una llamada ───────────────────────────────────────────────────

async function saveCall(
  deps: IngestDeps,
  connection: FathomConnection,
  m: FathomMeeting,
  externalId: string,
  closerId: string,
  transcript: Awaited<ReturnType<typeof getTranscript>>,
  byEmail: Map<string, string>,
  candidates: CloserCandidate[],
): Promise<"created" | "exists"> {
  const db = deps.supabase;
  const now = (deps.now ?? (() => new Date()))();
  const attendees = toAttendees(m.calendar_invitees);
  const recordedAt = m.recording_start_time ?? m.created_at ?? now.toISOString();
  const recorderEmail = normalizeFathomEmail(m.recorded_by?.email);

  const teamEmails = [...byEmail.keys(), ...candidates.map((c) => c.email ?? "")].filter(Boolean);
  const external = externalEmailsOf(attendees, { teamEmails, recorderEmail });
  const contacts = await loadContactCandidates(db, connection.workspace_id, external);
  const bookings = await loadBookingCandidates(db, connection.workspace_id, recordedAt, contacts.map((c) => c.id), external);
  const link = computeAutoLink({ recordedAt, recorderUserId: closerId, attendees, teamEmails, recorderEmail }, contacts, bookings);

  const counts = countPeople(attendees, transcript);
  const { data, error } = await db
    .from("calls")
    .insert({
      workspace_id: connection.workspace_id,
      source: "fathom",
      external_id: externalId,
      connection_id: connection.id,
      title: m.meeting_title || m.title || "Reunión",
      fathom_url: m.url ?? null,
      share_url: m.share_url ?? null,
      recorded_at: recordedAt,
      scheduled_start_at: m.scheduled_start_time ?? null,
      scheduled_end_at: m.scheduled_end_time ?? null,
      duration_seconds: secondsBetween(m.recording_start_time, m.recording_end_time),
      recorded_by_email: recorderEmail,
      recorded_by_user_id: closerId,
      attendees,
      transcript,
      transcript_language: m.transcript_language ?? null,
      participants_count: counts.participants,
      speakers_count: counts.speakers,
      people_count: counts.people,
      contact_id: link.contact_id,
      booking_id: link.booking_id,
      link_method: link.link_method,
      analysis_status: "classifying",
      // La reunion SIN la transcripcion (esa va en su columna): nunca audio ni video.
      raw_payload: m as unknown as Json,
    })
    .select("id")
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") return "exists"; // otra conexion la trajo primero
    throw new FathomError("No pude guardar una llamada", "temporary", null, "insert_failed");
  }
  const callId = (data as { id: string }).id;

  // Lo que sigue nunca tumba la ingesta: la llamada ya esta guardada.
  try {
    await auditAsWebhook({
      supabase: db as never,
      workspaceId: connection.workspace_id,
      entityType: "call",
      entityId: callId,
      action: "call.ingested",
      metadata: { source: "fathom", link_method: link.link_method, lines: transcript.length },
      label: "Fathom",
    });
    await (deps.enqueueClassify ?? ((id: string) => defaultEnqueueClassify(db, id, now)))(callId);
    if (link.contact_id && deps.onLinked) await deps.onLinked({ callId, contactId: link.contact_id, workspaceId: connection.workspace_id });
  } catch (err) {
    console.error("[fathom] la llamada se guardó pero falló un paso posterior:", err instanceof Error ? err.message : "error");
  }
  return "created";
}

/** `call_classify` con su clave de dedupe; un duplicado no es un error. */
export async function defaultEnqueueClassify(db: Db, callId: string, now: Date): Promise<void> {
  try {
    await scheduleJob(db, "call_classify", { callId }, now, `call_classify:${callId}`);
  } catch (err) {
    if ((err as { code?: string }).code !== "23505") throw err;
  }
}

// ── Errores ───────────────────────────────────────────────────────────────

async function failWithoutToken(db: Db, connectionId: string, err: unknown, result: SyncResult): Promise<SyncResult> {
  if (err instanceof FathomError && err.kind === "permanent") {
    // `getFathomAccessToken` ya la dejo en error y avisó a la persona.
    return { ...result, outcome: "reconnect", error: err.message };
  }
  const message = err instanceof Error ? err.message : "Fathom no respondió";
  await db.from("oauth_connections").update({ sync_last_error: message }).eq("id", connectionId);
  return { ...result, outcome: "temporary_error", error: message };
}

async function handleRunError(
  deps: IngestDeps,
  connection: FathomConnection,
  err: unknown,
  result: SyncResult,
  pageCursor: string | null,
  saveProgress: (extra?: { sync_last_error?: string | null }) => Promise<void>,
): Promise<SyncResult> {
  const db = deps.supabase;
  const now = (deps.now ?? (() => new Date()))();

  // Se agoto el presupuesto: se guarda donde quedo y se sigue en 70 s.
  if (err instanceof BudgetExhausted) {
    await saveProgress({ sync_last_error: null });
    await requeueFathomSync(db, connection.id, CONTINUATION_DELAY_MS, now);
    return { ...result, outcome: "continued" };
  }

  if (err instanceof FathomError) {
    // Un 401 que sobrevivio a la renovacion forzada: el acceso se perdio.
    if (err.status === 401) {
      await markFathomConnectionError(db, connection, "Fathom cortó el acceso (el permiso se revocó o venció): hay que reconectar");
      return { ...result, outcome: "reconnect", error: err.message };
    }
    if (err.status === 429) {
      await saveProgress({ sync_last_error: "Fathom pidió esperar" });
      await requeueFathomSync(db, connection.id, err.retryAfterMs ?? CONTINUATION_DELAY_MS, now);
      return { ...result, outcome: "rate_limited", error: err.message };
    }
    // 5xx, red u otro error: la conexion sigue activa y reintenta la proxima vuelta del cron.
    await saveProgress({ sync_last_error: err.message });
    return { ...result, outcome: "temporary_error", error: err.message };
  }

  const message = err instanceof Error ? err.message : "Error desconocido";
  console.error("[fathom] fallo inesperado en la ingesta:", message);
  await saveProgress({ sync_last_error: "Falló la consulta a Fathom" });
  return { ...result, outcome: "temporary_error", error: message };
}

// Se re-exporta para el handler.
export type { FathomDeps };
