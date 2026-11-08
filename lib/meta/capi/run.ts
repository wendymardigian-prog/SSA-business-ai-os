/**
 * La API de Conversiones de Meta del lado del servidor: encolar un evento, guardar la IP y el navegador de quien
 * respondió o agendó, y el job que lo manda.
 *
 * Reglas (las de siempre para un proveedor):
 *   - Nada de esto tumba lo que lo origina. Encolar y guardar el contexto nunca lanzan.
 *   - El job no lanza por un fallo de Meta (la cola reintentaría a los 10 s encima de la espera propia): reagenda a 1,
 *     5 y 15 minutos, y después deja el evento `failed` con el motivo, que se ve en la tarjeta.
 *   - Un evento se manda una sola vez: el índice único (workspace, evento, código) de `meta_capi_events`.
 *   - Los datos de la persona se leen AL MANDAR (frescos) y nunca se guardan ni se loguean.
 *   - Todo con el cliente de servicio: quien encola ya es el servidor (el motor de flujos, el trigger de pagos).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { readSecret, SECRET_NAMES } from "@/lib/vault";
import { scheduleJob } from "@/lib/scheduler";
import { buildCapiEvent, type CapiEventInput, type CapiSourceType, type SkipReason } from "./build-event";
import { parseCapiConfig, META_CAPI_PROVIDER_ID, type CapiConfig } from "./config";
import { sendCapiEvents } from "./send";
import { normalizeIp, normalizeUserAgent } from "./normalize";

type Db = SupabaseClient<Database>;

export const META_CAPI_JOB = "meta_capi_send";
export const CAPI_RETRY_MINUTES = [1, 5, 15] as const;

// ── Configuración ─────────────────────────────────────────────────────────

export async function loadCapiConfig(db: Db, workspaceId: string): Promise<CapiConfig | null> {
  const { data, error } = await db
    .from("integration_configs")
    .select("is_active, config")
    .eq("workspace_id", workspaceId)
    .eq("type", "meta")
    .eq("provider", META_CAPI_PROVIDER_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return parseCapiConfig(data);
}

// ── La IP y el navegador ──────────────────────────────────────────────────

/**
 * Guarda la IP y el navegador de quien respondió un formulario o agendó, solo si el negocio tiene la API de
 * Conversiones configurada (si no, no se guarda nada que no se vaya a usar). Se borra a los 8 días. Nunca lanza.
 */
export async function rememberCapiRequestContext(
  db: Db,
  input: { workspaceId: string; sourceType: "form" | "booking"; sourceId: string; ip: string | null | undefined; userAgent: string | null | undefined },
): Promise<void> {
  try {
    const ip = normalizeIp(input.ip);
    const userAgent = normalizeUserAgent(input.userAgent);
    if (!ip && !userAgent) return;
    if (!(await loadCapiConfig(db, input.workspaceId))) return;
    const { error } = await db.from("meta_capi_request_context").insert({
      workspace_id: input.workspaceId,
      source_type: input.sourceType,
      source_id: input.sourceId,
      client_ip: ip,
      user_agent: userAgent,
    });
    if (error && error.code !== "23505") console.error("[meta-capi] no pude guardar el contexto del pedido:", error.code ?? "error");
  } catch (err) {
    console.error("[meta-capi] no pude guardar el contexto del pedido:", err instanceof Error ? err.message.slice(0, 120) : "error");
  }
}

// ── Encolar ───────────────────────────────────────────────────────────────

export interface CapiEnqueueInput {
  workspaceId: string;
  eventName: string;
  eventId: string;
  sourceType: CapiSourceType;
  sourceId: string;
  eventTime: string;
  params?: Record<string, Json>;
  flowId?: string | null;
  flowSessionId?: string | null;
}

export type CapiEnqueueResult =
  | { ok: true; eventLogId: string }
  | { ok: false; reason: "duplicate" | "error"; message: string };

/** Anota el evento y encola su envío. Nunca lanza. Un evento que ya existía no se vuelve a mandar. */
export async function enqueueCapiEvent(db: Db, input: CapiEnqueueInput, deps: { schedule?: typeof scheduleJob; now?: () => Date } = {}): Promise<CapiEnqueueResult> {
  const schedule = deps.schedule ?? scheduleJob;
  const now = deps.now ?? (() => new Date());
  try {
    const { data, error } = await db
      .from("meta_capi_events")
      .insert({
        workspace_id: input.workspaceId,
        event_name: input.eventName,
        event_id: input.eventId,
        source_type: input.sourceType,
        source_id: input.sourceId,
        event_time: input.eventTime,
        params: (input.params ?? {}) as Json,
        flow_id: input.flowId ?? null,
        flow_session_id: input.flowSessionId ?? null,
        status: "pending",
        attempts: 0,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") return { ok: false, reason: "duplicate", message: "Ese evento ya se había mandado a Meta." };
      console.error("[meta-capi] no pude anotar el evento:", error.code ?? "error");
      return { ok: false, reason: "error", message: "No pude anotar el evento." };
    }
    try {
      await schedule(db, META_CAPI_JOB, { eventLogId: data.id, attempt: 1 }, now(), `meta_capi:${data.id}`);
    } catch (err) {
      console.error("[meta-capi] no pude encolar el envío:", err instanceof Error ? err.message.slice(0, 120) : "error");
      await db.from("meta_capi_events").update({ status: "failed", error: "No pude encolar el envío.", updated_at: now().toISOString() }).eq("id", data.id);
      return { ok: false, reason: "error", message: "No pude encolar el envío." };
    }
    return { ok: true, eventLogId: data.id };
  } catch (err) {
    console.error("[meta-capi] no pude encolar el evento:", err instanceof Error ? err.message.slice(0, 120) : "error");
    return { ok: false, reason: "error", message: "No pude encolar el evento." };
  }
}

// ── Leer lo que pasó ──────────────────────────────────────────────────────

type EventRow = Database["public"]["Tables"]["meta_capi_events"]["Row"];

interface ContactFacts {
  display_name: string | null;
  email: string | null;
  secondary_email: string | null;
  phone: string | null;
  whatsapp_phone: string | null;
  country: string | null;
}

export type Facts =
  | { ok: true; input: Omit<CapiEventInput, "now" | "eventName" | "eventId"> }
  | { ok: false; reason: SkipReason };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

async function loadContact(db: Db, workspaceId: string, contactId: string | null): Promise<ContactFacts | null> {
  if (!contactId) return null;
  const { data, error } = await db
    .from("contacts")
    .select("display_name, email, secondary_email, phone, whatsapp_phone, country")
    .eq("id", contactId)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Las cookies de Meta del último toque del contacto que las tenga (para un pago o un flujo sin página de por medio). */
async function latestTouchCookies(db: Db, workspaceId: string, contactId: string): Promise<{ fbc: string | null; fbp: string | null; fbclid: string | null; at: Date | null }> {
  const { data } = await db
    .from("contact_touches")
    .select("raw, fbclid, occurred_at")
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .order("occurred_at", { ascending: false })
    .limit(10);
  for (const touch of data ?? []) {
    const raw = obj(touch.raw);
    const fbc = str(raw.fbc);
    const fbp = str(raw.fbp);
    const fbclid = str(touch.fbclid) ?? str(raw.fbclid);
    if (fbc || fbp || fbclid) return { fbc, fbp, fbclid, at: touch.occurred_at ? new Date(touch.occurred_at) : null };
  }
  return { fbc: null, fbp: null, fbclid: null, at: null };
}

async function requestContext(db: Db, sourceType: "form" | "booking", sourceId: string): Promise<{ ip: string | null; userAgent: string | null }> {
  const { data } = await db.from("meta_capi_request_context").select("client_ip, user_agent").eq("source_type", sourceType).eq("source_id", sourceId).maybeSingle();
  return { ip: data?.client_ip ?? null, userAgent: data?.user_agent ?? null };
}

function contactUser(contact: ContactFacts, contactId: string) {
  return {
    emails: [contact.email, contact.secondary_email],
    phones: [contact.phone, contact.whatsapp_phone],
    displayName: contact.display_name,
    country: contact.country,
    externalId: contactId,
  };
}

function paramNumber(params: Record<string, unknown>, key: string): number | null {
  const v = params[key];
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Los datos de lo que pasó y de la persona, recién leídos. */
export async function loadFacts(db: Db, row: EventRow): Promise<Facts> {
  const params = obj(row.params);
  const base = {
    occurredAt: new Date(row.event_time),
    value: paramNumber(params, "value"),
    currency: str(params.currency),
    contentName: str(params.content_name),
    orderId: null as string | null,
  };

  switch (row.source_type) {
    // @plantilla-desde(formularios)
    case "form": {
      const { data: sub, error } = await db
        .from("form_submissions")
        .select("id, status, contact_id, attribution, meta")
        .eq("id", row.source_id)
        .eq("workspace_id", row.workspace_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!sub) return { ok: false, reason: "source_missing" };
      if (sub.status === "spam") return { ok: false, reason: "spam" };
      const contact = await loadContact(db, row.workspace_id, sub.contact_id);
      if (!contact || !sub.contact_id) return { ok: false, reason: "no_contact" };
      const attribution = obj(sub.attribution);
      const meta = obj(sub.meta);
      const ctx = await requestContext(db, "form", sub.id);
      return {
        ok: true,
        input: {
          ...base,
          fromWebsite: true,
          sourceUrl: str(attribution.entry_url) ?? str(attribution.landing_page) ?? str(attribution.page_url),
          user: {
            ...contactUser(contact, sub.contact_id),
            clientIp: ctx.ip,
            userAgent: ctx.userAgent ?? str(meta.user_agent),
            fbc: str(attribution.fbc),
            fbp: str(attribution.fbp),
            fbclid: str(attribution.fbclid),
          },
        },
      };
    }

    // @plantilla-hasta(formularios)
    case "booking": {
      const { data: booking, error } = await db
        .from("bookings")
        .select("id, contact_id, utm, origin")
        .eq("id", row.source_id)
        .eq("workspace_id", row.workspace_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!booking) return { ok: false, reason: "source_missing" };
      const contact = await loadContact(db, row.workspace_id, booking.contact_id);
      if (!contact || !booking.contact_id) return { ok: false, reason: "no_contact" };
      const utm = obj(booking.utm);
      const isPublic = booking.origin === "public_page" || booking.origin === "embed";
      const ctx = isPublic ? await requestContext(db, "booking", booking.id) : { ip: null, userAgent: null };
      return {
        ok: true,
        input: {
          ...base,
          fromWebsite: isPublic,
          sourceUrl: str(utm.landing_page) ?? str(utm.page_url),
          user: {
            ...contactUser(contact, booking.contact_id),
            clientIp: ctx.ip,
            userAgent: ctx.userAgent,
            fbc: str(utm.fbc),
            fbp: str(utm.fbp),
            fbclid: str(utm.fbclid),
          },
        },
      };
    }

    // @plantilla-desde(ventas)
    case "payment": {
      const { data: payment, error } = await db
        .from("payments")
        .select("id, sale_id, status, type")
        .eq("id", row.source_id)
        .eq("workspace_id", row.workspace_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!payment) return { ok: false, reason: "source_missing" };
      const { data: sale, error: saleError } = await db.from("sales").select("contact_id, attribution").eq("id", payment.sale_id).eq("workspace_id", row.workspace_id).maybeSingle();
      if (saleError) throw new Error(saleError.message);
      const contact = await loadContact(db, row.workspace_id, sale?.contact_id ?? null);
      if (!contact || !sale?.contact_id) return { ok: false, reason: "no_contact" };
      const raw = obj(obj(sale.attribution).raw);
      const touch = str(raw.fbc) || str(raw.fbp) ? null : await latestTouchCookies(db, row.workspace_id, sale.contact_id);
      return {
        ok: true,
        input: {
          ...base,
          orderId: payment.id,
          fromWebsite: false,
          user: {
            ...contactUser(contact, sale.contact_id),
            fbc: str(raw.fbc) ?? touch?.fbc ?? null,
            fbp: str(raw.fbp) ?? touch?.fbp ?? null,
            fbclid: str(raw.fbclid) ?? touch?.fbclid ?? null,
          },
        },
      };
    }

    // @plantilla-hasta(ventas)
    case "contact": {
      const contactId = row.source_id;
      const contact = await loadContact(db, row.workspace_id, contactId);
      if (!contact) return { ok: false, reason: "no_contact" };
      const touch = await latestTouchCookies(db, row.workspace_id, contactId);
      return {
        ok: true,
        input: { ...base, fromWebsite: false, user: { ...contactUser(contact, contactId), fbc: touch.fbc, fbp: touch.fbp, fbclid: touch.fbclid } },
      };
    }
  }
  // Un origen que esta instalacion no tiene (la plantilla sin Formularios o sin Ventas).
  return { ok: false, reason: "source_missing" };
}

// ── El job ────────────────────────────────────────────────────────────────

export interface CapiSendPayload {
  eventLogId: string;
  attempt?: number;
}

export type CapiOutcome = "sent" | "skipped" | "failed" | "retry" | "already" | "missing";

export interface CapiRunDeps {
  readToken?: (db: Db, workspaceId: string) => Promise<string | null>;
  fetchImpl?: typeof fetch;
  schedule?: typeof scheduleJob;
  now?: () => Date;
}

export function capiRetryDelayMinutes(attempt: number): number | null {
  if (!Number.isFinite(attempt) || attempt < 1) return CAPI_RETRY_MINUTES[0];
  return CAPI_RETRY_MINUTES[attempt - 1] ?? null;
}

export async function runCapiSend(db: Db, payload: CapiSendPayload, deps: CapiRunDeps = {}): Promise<CapiOutcome> {
  const now = deps.now ?? (() => new Date());
  const schedule = deps.schedule ?? scheduleJob;
  const readToken = deps.readToken ?? ((client, ws) => readSecret(client as never, ws, SECRET_NAMES.metaCapiToken));
  const attempt = payload.attempt ?? 1;

  const { data: row, error } = await db.from("meta_capi_events").select("*").eq("id", payload.eventLogId).maybeSingle();
  if (error) throw new Error(`no pude leer el evento de Meta: ${error.message}`);
  if (!row) return "missing";
  if (row.status !== "pending") return "already";

  const update = async (patch: Database["public"]["Tables"]["meta_capi_events"]["Update"]): Promise<void> => {
    const { error: updateError } = await db
      .from("meta_capi_events")
      .update({ ...patch, updated_at: now().toISOString() })
      .eq("id", row.id)
      .eq("status", "pending");
    if (updateError) console.error("[meta-capi] no pude actualizar el evento:", updateError.code ?? "error");
  };
  const skip = async (reason: SkipReason): Promise<CapiOutcome> => {
    await update({ status: "skipped", skip_reason: reason, attempts: attempt });
    return "skipped";
  };
  const fail = async (message: string): Promise<CapiOutcome> => {
    await update({ status: "failed", error: message.slice(0, 500), attempts: attempt });
    return "failed";
  };
  const retryLater = async (message: string): Promise<CapiOutcome> => {
    const minutes = capiRetryDelayMinutes(attempt);
    if (minutes === null) return fail(message);
    try {
      await schedule(db, META_CAPI_JOB, { eventLogId: row.id, attempt: attempt + 1 }, new Date(now().getTime() + minutes * 60_000), `meta_capi:${row.id}:${attempt + 1}`);
      await update({ attempts: attempt, error: message.slice(0, 500) });
      return "retry";
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      if (code === "23505") return "retry";
      return fail(message);
    }
  };

  let config: CapiConfig | null;
  try {
    config = await loadCapiConfig(db, row.workspace_id);
  } catch {
    return retryLater("No pude leer la configuración de la API de Conversiones.");
  }
  if (!config) return skip("not_configured");

  let token: string | null;
  try {
    token = await readToken(db, row.workspace_id);
  } catch {
    return retryLater("No pude leer el token de la API de Conversiones.");
  }
  if (!token) return skip("not_configured");

  let facts: Facts;
  try {
    facts = await loadFacts(db, row);
  } catch {
    return retryLater("No pude leer los datos del evento.");
  }
  if (!facts.ok) return skip(facts.reason);

  const built = buildCapiEvent({ ...facts.input, eventName: row.event_name, eventId: row.event_id, now: now() });
  if (!built.ok) return skip(built.reason);

  const result = await sendCapiEvents({ pixelId: config.pixelId, token, events: [built.event], testEventCode: config.testEventCode, fetchImpl: deps.fetchImpl });
  if (result.ok) {
    await update({
      status: "sent",
      sent_at: now().toISOString(),
      attempts: attempt,
      fbtrace_id: result.fbtraceId,
      action_source: built.event.action_source,
      test: !!config.testEventCode,
      error: null,
    });
    return "sent";
  }
  return result.transient ? retryLater(result.error) : fail(result.error);
}
