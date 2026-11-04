/**
 * El despachador de la cola de envíos (docs/broadcasts.md). Lo llama pg_cron
 * cada 15 segundos (`/api/cron/send-queue`, 00286).
 *
 * Por cada CARRIL (un canal con broadcasts enviándose):
 * 1. Mira el ritmo del número (`paceDecision`): horario, topes por minuto, hora
 *    y día. Si no puede salir nada, corre `next_send_at` hasta cuando sí.
 * 2. Elige el broadcast más viejo que pueda salir con SU ritmo (más lento o
 *    igual que el número).
 * 3. Toma el lugar del carril (`claim_lane_slot`, gana uno solo aunque corran
 *    dos despachadores) y lo corre la espera al azar del ritmo.
 * 4. Reserva el próximo destinatario (`claim_broadcast_recipient`), vuelve a
 *    mirar lo que pudo cambiar (borrado, no contactar, baja), arma el mensaje y
 *    lo manda por el camino de siempre: `sendChannelMessage` para WhatsApp
 *    (con el tope de 200/h del canal) y `sendTransactionalEmail` como marketing
 *    para email (con la puerta de suscripción y el link de baja).
 *
 * Nunca lanza por un fallo del proveedor: reintenta a 1, 5 y 15 minutos y
 * después lo deja `failed`. Fallos seguidos pausan el carril y avisan.
 * Un destinatario que quedó `sending` (el proceso murió a mitad del envío) se
 * marca fallido y NO se reintenta: mandar dos veces es peor que no mandar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { startOfZonedDay } from "@/lib/dates";
import { isValidTimeZone } from "@/lib/timezone";
import { recordSend, sendChannelMessage } from "@/lib/flow-engine/send";
import { sendTransactionalEmail } from "@/lib/email/send";
import { emailSendCapacity, DEFER_MESSAGES, type DeferReason } from "@/lib/email/delivery-guard";
import { upsertConversation } from "@/lib/inbound";
import { notifyWorkspaceAdmins } from "@/lib/notifications";
import { loadBroadcastChannel, type BroadcastChannel } from "@/lib/broadcasts/channels";
import { loadRenderData } from "@/lib/broadcasts/audience-load";
import { filterValues, parseContactListFilters } from "@/lib/contacts/list-query";
import { broadcastVariables, cleanVariants, renderChatMessage, renderEmail } from "@/lib/broadcasts/render";
import type { SendSkipReason } from "@/lib/broadcasts/audience";
import type { SearchParams } from "@/lib/url-params";
import { combinePolicies, paceDecision, parseBroadcastPace, pickGapSeconds, type LaneCounts, type SendPolicy } from "./pace";

type Client = SupabaseClient<Database>;
type Broadcast = Database["public"]["Tables"]["broadcasts"]["Row"];
type Recipient = Database["public"]["Tables"]["broadcast_recipients"]["Row"];

/** Reintentos de un envío que falló por algo pasajero (el proveedor no contestó). */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000];
/** Un `rate_limited` (el tope de 200/h del canal) vuelve a mirar en 5 minutos sin gastar intento. */
const RATE_LIMIT_WAIT_MS = 5 * 60_000;
/** Un destinatario en `sending` hace más que esto: el proceso murió a mitad del envío. */
export const STALE_SENDING_MS = 5 * 60_000;
/** Cuánto trabaja un tic como mucho (la llamada de pg_net corta a los 60 s). */
const TICK_BUDGET_MS = 40_000;

export interface DispatchSummary {
  lanes: number;
  sent: number;
  failed: number;
  skipped: number;
  reaped: number;
}

/** Lo que pasó con un destinatario. Puro (lo decide `settleOutcome`). */
export type RecipientOutcome =
  | { kind: "sent"; conversationId: string | null }
  | { kind: "skipped"; reason: SendSkipReason; message?: string }
  | { kind: "rate_limited" }
  /** La guardia de entrega (00287): un email de marketing que hoy no entra. Vuelve a pendiente para `retryAt`. */
  | { kind: "deferred"; reason: DeferReason; retryAt: Date }
  | { kind: "failed"; message: string; retryable: boolean; laneFatal?: boolean };

/** Cómo queda un destinatario después de un intento. Puro. */
export function settleOutcome(
  outcome: RecipientOutcome,
  attempts: number,
  now: Date,
): Database["public"]["Tables"]["broadcast_recipients"]["Update"] {
  switch (outcome.kind) {
    case "sent":
      return { status: "sent", sent_at: now.toISOString(), conversation_id: outcome.conversationId, error_message: null, next_attempt_at: null };
    case "skipped":
      return { status: "skipped", skip_reason: outcome.reason, error_message: outcome.message ?? null };
    case "rate_limited":
      return { status: "pending", claimed_at: null, next_attempt_at: new Date(now.getTime() + RATE_LIMIT_WAIT_MS).toISOString() };
    case "deferred":
      // No gasta intento ni es un fallo: sale cuando haya lugar (manana, o cuando alguien reanude el marketing).
      return { status: "pending", claimed_at: null, error_message: DEFER_MESSAGES[outcome.reason], next_attempt_at: outcome.retryAt.toISOString() };
    case "failed": {
      const next = attempts + 1;
      if (outcome.retryable && next <= RETRY_DELAYS_MS.length) {
        return {
          status: "pending",
          attempts: next,
          claimed_at: null,
          error_message: outcome.message,
          next_attempt_at: new Date(now.getTime() + RETRY_DELAYS_MS[next - 1]).toISOString(),
        };
      }
      return { status: "failed", attempts: next, error_message: outcome.message };
    }
  }
}

export async function runSendQueue(service: Client, now: Date = new Date()): Promise<DispatchSummary> {
  const started = Date.now();
  const summary: DispatchSummary = { lanes: 0, sent: 0, failed: 0, skipped: 0, reaped: 0 };

  summary.reaped = await reapStaleSending(service, now);
  await activateScheduled(service, now);

  const { data: active, error } = await service
    .from("broadcasts")
    .select("*")
    .eq("status", "sending")
    .not("channel_id", "is", null)
    .order("created_at");
  if (error) {
    console.error("[send-queue] no pude leer los broadcasts activos:", error.message);
    return summary;
  }

  const byChannel = new Map<string, Broadcast[]>();
  for (const b of active ?? []) {
    const list = byChannel.get(b.channel_id!) ?? [];
    list.push(b);
    byChannel.set(b.channel_id!, list);
  }

  for (const [channelId, broadcasts] of byChannel) {
    if (Date.now() - started > TICK_BUDGET_MS) break;
    summary.lanes += 1;
    try {
      await runLane(service, channelId, broadcasts, summary, started);
    } catch (e) {
      // Un carril que se rompe no frena a los demás.
      console.error("[send-queue] carril fallido:", e instanceof Error ? e.message : "error");
    }
  }
  return summary;
}

/** Los que quedaron `sending` de un proceso que murió: fallidos, sin reintento. */
async function reapStaleSending(service: Client, now: Date): Promise<number> {
  const { data } = await service
    .from("broadcast_recipients")
    .update({ status: "failed", error_message: "El envío se interrumpió a mitad de camino. No se reintenta para no mandar el mensaje dos veces." })
    .eq("status", "sending")
    .lt("claimed_at", new Date(now.getTime() - STALE_SENDING_MS).toISOString())
    .select("broadcast_id");
  const ids = [...new Set((data ?? []).map((r) => r.broadcast_id))];
  for (const id of ids) await service.rpc("refresh_broadcast_counts", { p_broadcast_id: id });
  return data?.length ?? 0;
}

async function activateScheduled(service: Client, now: Date): Promise<void> {
  await service
    .from("broadcasts")
    .update({ status: "sending", started_at: now.toISOString() })
    .eq("status", "scheduled")
    .lte("scheduled_for", now.toISOString());
}

interface LaneContext {
  channel: BroadcastChannel;
  workspaceId: string;
  workspaceName: string | null;
  timeZone: string;
}

async function runLane(service: Client, channelId: string, broadcasts: Broadcast[], summary: DispatchSummary, started: number): Promise<void> {
  const workspaceId = broadcasts[0].workspace_id;
  const { data: lane } = await service.from("channel_send_lanes").select("*").eq("channel_id", channelId).maybeSingle();
  if (!lane) {
    await service.from("channel_send_lanes").upsert({ channel_id: channelId, workspace_id: workspaceId }, { onConflict: "channel_id", ignoreDuplicates: true });
    return; // el próximo tic lo toma
  }
  if (lane.paused_at || new Date(lane.next_send_at).getTime() > Date.now()) return;

  const channel = await loadBroadcastChannel(service, workspaceId, channelId);
  if (!channel) {
    await pauseLane(service, channelId, workspaceId, "El canal se desconectó o ya no está activo.", null);
    return;
  }
  const { data: ws } = await service.from("workspaces").select("name, timezone").eq("id", workspaceId).maybeSingle();
  const timeZone = ws?.timezone && isValidTimeZone(ws.timezone) ? ws.timezone : "UTC";
  const ctx: LaneContext = { channel, workspaceId, workspaceName: ws?.name ?? null, timeZone };

  const exhausted = new Set<string>();
  const touched = new Set<string>();
  let failures = lane.consecutive_failures;
  // WhatsApp: uno por tic (la espera mínima es más larga que el tic). Email: hasta su tope por minuto.
  let maxSends = channel.kind === "whatsapp" ? 1 : (channel.policy.perMinute ?? 200);

  // Email: la guardia de entrega (00287) decide cuánto marketing entra hoy. Se mira ANTES de reclamar destinatarios,
  // para no reservar cien y devolverlos. Si la base no contesta, el carril espera unos minutos.
  if (channel.kind === "email") {
    const capacity = await emailSendCapacity(service, workspaceId);
    if (!capacity) {
      await deferLane(service, channelId, new Date(Date.now() + 5 * 60_000));
      return;
    }
    if (capacity.status !== "ok" || capacity.remaining <= 0) {
      const retryAt = capacity.retry_at ? new Date(capacity.retry_at) : new Date(capacity.next_day_start);
      await deferLane(service, channelId, retryAt);
      return;
    }
    maxSends = Math.min(maxSends, capacity.remaining);
  }
  let counts: LaneCounts | null = null;

  for (let i = 0; i < maxSends; i++) {
    if (Date.now() - started > TICK_BUDGET_MS) break;
    const now = new Date();
    counts ??= await laneCounts(service, { channelId }, now, timeZone);

    const laneDecision = paceDecision(channel.policy, counts, now, timeZone);
    if (!laneDecision.ok) {
      await deferLane(service, channelId, laneDecision.retryAt);
      break;
    }

    const pick = await pickBroadcast(service, broadcasts, exhausted, channel.policy, counts, now, timeZone);
    if (!pick.broadcast) {
      if (pick.retryAt) await deferLane(service, channelId, pick.retryAt);
      break;
    }
    const b = pick.broadcast;

    const gap = pickGapSeconds(pick.policy);
    const { data: slot } = await service.rpc("claim_lane_slot", { p_channel_id: channelId, p_next: new Date(now.getTime() + gap * 1000).toISOString() });
    if (slot !== true) break; // otro despachador tomó el carril

    const { data: claimed } = await service.rpc("claim_broadcast_recipient", { p_broadcast_id: b.id });
    const recipient = (claimed ?? [])[0] as Recipient | undefined;
    if (!recipient) {
      // Nada listo en este broadcast (terminó, o lo que queda espera un reintento): se libera el lugar.
      exhausted.add(b.id);
      touched.add(b.id);
      await service.from("channel_send_lanes").update({ next_send_at: now.toISOString() }).eq("channel_id", channelId);
      i -= 1;
      if (exhausted.size >= broadcasts.length) break;
      continue;
    }

    const outcome = await deliver(service, ctx, b, recipient);
    const update = settleOutcome(outcome, recipient.attempts, new Date());
    await service.from("broadcast_recipients").update(update).eq("id", recipient.id).eq("status", "sending");
    touched.add(b.id);

    if (outcome.kind === "sent") {
      summary.sent += 1;
      failures = 0;
      counts = { lastMinute: counts.lastMinute + 1, lastHour: counts.lastHour + 1, today: counts.today + 1 };
    } else if (outcome.kind === "skipped") {
      summary.skipped += 1;
      // Un salteado no gastó el lugar: el próximo puede salir ya.
      await service.from("channel_send_lanes").update({ next_send_at: new Date().toISOString() }).eq("channel_id", channelId);
    } else if (outcome.kind === "failed") {
      summary.failed += 1;
      failures += 1;
      if (outcome.laneFatal || (channel.policy.pauseAfterFailures > 0 && failures >= channel.policy.pauseAfterFailures)) {
        await pauseLane(
          service,
          channelId,
          workspaceId,
          outcome.laneFatal ? outcome.message : `Fallaron ${failures} envíos seguidos. Último motivo: ${outcome.message}`,
          channel.label,
        );
        break;
      }
    } else if (outcome.kind === "deferred") {
      // La guardia de entrega: hoy no entra nada más (otro envío llenó el cupo, o saltó el freno).
      await deferLane(service, channelId, outcome.retryAt);
      break;
    } else {
      // rate_limited: el tope del canal (200/h) se llenó con otros envíos.
      await deferLane(service, channelId, new Date(Date.now() + RATE_LIMIT_WAIT_MS));
      break;
    }
  }

  if (failures !== lane.consecutive_failures) {
    await service.from("channel_send_lanes").update({ consecutive_failures: failures }).eq("channel_id", channelId);
  }
  for (const id of touched) await service.rpc("refresh_broadcast_counts", { p_broadcast_id: id });
}

/** El broadcast más viejo que pueda salir ahora con su ritmo, o cuándo volver a mirar. */
async function pickBroadcast(
  service: Client,
  broadcasts: Broadcast[],
  exhausted: Set<string>,
  ceiling: SendPolicy,
  laneCountsNow: LaneCounts,
  now: Date,
  timeZone: string,
): Promise<{ broadcast: Broadcast | null; policy: SendPolicy; retryAt?: Date }> {
  let retryAt: Date | undefined;
  for (const b of broadcasts) {
    if (exhausted.has(b.id)) continue;
    const own = parseBroadcastPace(b.pace);
    const policy = combinePolicies(ceiling, own);
    if (own.perHour != null || own.perDay != null) {
      const counts = await laneCounts(service, { broadcastId: b.id }, now, timeZone);
      const decision = paceDecision(policy, { ...counts, lastMinute: laneCountsNow.lastMinute }, now, timeZone);
      if (!decision.ok) {
        if (!retryAt || decision.retryAt < retryAt) retryAt = decision.retryAt;
        continue;
      }
    }
    return { broadcast: b, policy };
  }
  return { broadcast: null, policy: ceiling, retryAt };
}

/** Cuántos salieron (o están saliendo) en el último minuto, la última hora y hoy, del canal o de un broadcast. */
async function laneCounts(service: Client, scope: { channelId?: string; broadcastId?: string }, now: Date, timeZone: string): Promise<LaneCounts> {
  const since = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const count = async (from: string) => {
    let sent = service.from("broadcast_recipients").select("id", { count: "exact", head: true }).eq("status", "sent").gte("sent_at", from);
    let sending = service.from("broadcast_recipients").select("id", { count: "exact", head: true }).eq("status", "sending").gte("claimed_at", from);
    if (scope.channelId) {
      sent = sent.eq("channel_id", scope.channelId);
      sending = sending.eq("channel_id", scope.channelId);
    }
    if (scope.broadcastId) {
      sent = sent.eq("broadcast_id", scope.broadcastId);
      sending = sending.eq("broadcast_id", scope.broadcastId);
    }
    const [a, b] = await Promise.all([sent, sending]);
    return (a.count ?? 0) + (b.count ?? 0);
  };
  const [lastMinute, lastHour, today] = await Promise.all([
    count(since(60_000)),
    count(since(3600_000)),
    count(startOfZonedDay(now, timeZone).toISOString()),
  ]);
  return { lastMinute, lastHour, today };
}

/** Corre la próxima mirada del carril (nunca para atrás). */
async function deferLane(service: Client, channelId: string, at: Date): Promise<void> {
  await service.from("channel_send_lanes").update({ next_send_at: at.toISOString() }).eq("channel_id", channelId).lt("next_send_at", at.toISOString());
}

async function pauseLane(service: Client, channelId: string, workspaceId: string, reason: string, label: string | null): Promise<void> {
  const { data } = await service
    .from("channel_send_lanes")
    .update({ paused_at: new Date().toISOString(), paused_reason: reason.slice(0, 500) })
    .eq("channel_id", channelId)
    .is("paused_at", null)
    .select("channel_id");
  if (!data || data.length === 0) return; // ya estaba pausado: no se avisa dos veces
  await notifyWorkspaceAdmins({
    supabase: service,
    workspaceId,
    kind: "channel_error",
    title: "Se pausaron los envíos masivos",
    body: `${label ?? "Un canal"}: ${reason} Revisá el canal y reanudá desde el broadcast.`,
    entityId: channelId,
    metadata: { source: "send_queue" },
  });
}

/** Un destinatario: vuelve a mirar al contacto, arma el mensaje y lo manda. Nunca lanza. */
/** Las etiquetas por las que filtra la audiencia guardada, leídas igual que en Contactos: basta con tener una. */
function audienceTagIds(audience: Broadcast["audience_params"]): readonly string[] {
  if (!audience || typeof audience !== "object" || Array.isArray(audience)) return [];
  return filterValues(parseContactListFilters(audience as SearchParams, []), "tag");
}

async function deliver(service: Client, ctx: LaneContext, b: Broadcast, r: Recipient): Promise<RecipientOutcome> {
  try {
    const { data: contact } = await service
      .from("contacts")
      .select("id, deleted_at, do_not_contact, is_subscribed, email")
      .eq("id", r.contact_id)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();
    if (!contact || contact.deleted_at) return { kind: "skipped", reason: "deleted" };
    if (contact.do_not_contact) return { kind: "skipped", reason: "do_not_contact" };
    if (ctx.channel.kind === "whatsapp" && contact.is_subscribed === false) return { kind: "skipped", reason: "chat_unsubscribed" };

    // La audiencia se congela al poner en cola. Si filtraba por etiqueta, se vuelve a mirar justo antes de mandar: a quien
    // se la sacaron entre medio (por ejemplo, porque se registró y un flujo le quitó la de la lista) ya no le corresponde.
    // Solo las etiquetas: los demás filtros siguen congelados.
    const tagIds = audienceTagIds(b.audience_params);
    if (tagIds.length > 0) {
      const { data: tagged, error: tagError } = await service.from("contact_tags").select("tag_id").eq("contact_id", r.contact_id).in("tag_id", [...tagIds]).limit(1);
      if (tagError) throw new Error(`No pude comprobar las etiquetas del contacto: ${tagError.message}`);
      if (!tagged || tagged.length === 0) return { kind: "skipped", reason: "left_audience" };
    }

    const { data: fields } = await service.from("custom_field_definitions").select("id, slug, name, type").eq("workspace_id", ctx.workspaceId).is("deleted_at", null);
    const data = (await loadRenderData(service, ctx.workspaceId, [r.contact_id], fields ?? [])).get(r.contact_id);
    if (!data) return { kind: "skipped", reason: "deleted" };
    const variables = broadcastVariables(data.contact, { name: ctx.workspaceName }, fields ?? [], data.customValues);
    const variants = cleanVariants(b.message_variants);

    if (ctx.channel.kind === "email") return await deliverEmail(ctx, b, r, contact.email, variants, variables);
    return await deliverWhatsapp(service, ctx, b, r, variants, variables);
  } catch (e) {
    return { kind: "failed", message: e instanceof Error ? e.message : "Error inesperado al enviar.", retryable: true };
  }
}

async function deliverWhatsapp(
  service: Client,
  ctx: LaneContext,
  b: Broadcast,
  r: Recipient,
  variants: string[],
  variables: Record<string, unknown>,
): Promise<RecipientOutcome> {
  const rendered = renderChatMessage(variants, r.variant_index, variables);
  if (rendered.missing.length > 0 && b.skip_missing_variables) {
    return { kind: "skipped", reason: "missing_variables", message: `Faltaba: ${rendered.missing.join(", ")}` };
  }
  const text = rendered.text.trim();
  if (!text) return { kind: "skipped", reason: "missing_variables", message: "El mensaje quedó vacío." };

  const conversationId = await ensureWhatsappConversation(service, ctx, r, text);
  if (typeof conversationId !== "string") return conversationId;

  const sendCtx = { workspaceId: ctx.workspaceId, channelId: ctx.channel.id, contactId: r.contact_id, conversationId, origin: "broadcast" as const };
  const outcome = await sendChannelMessage(service, sendCtx, { text });
  if (!outcome.ok && outcome.failure?.kind === "rate_limited") return { kind: "rate_limited" };
  const failure = outcome.failure;
  // Un fallo que se va a reintentar no deja una burbuja roja en el chat por cada intento: solo el último.
  const willRetry = !outcome.ok && failure?.retryable === true && r.attempts + 1 <= RETRY_DELAYS_MS.length;
  if (!willRetry) await recordSend(service, sendCtx, text, outcome);
  if (outcome.ok) return { kind: "sent", conversationId };
  return {
    kind: "failed",
    message: failure?.message ?? "WhatsApp no aceptó el mensaje.",
    retryable: failure?.retryable === true,
    // Sin WhatsApp configurado no tiene sentido seguir probando con los demás.
    laneFatal: failure?.kind === "token_expired",
  };
}

/**
 * La conversación del contacto en este número. Si nunca escribió (solo tiene
 * teléfono), se lo vincula al número con ese teléfono y se le abre la
 * conversación, así el eco y su respuesta caen en el mismo chat.
 */
async function ensureWhatsappConversation(service: Client, ctx: LaneContext, r: Recipient, preview: string): Promise<string | RecipientOutcome> {
  const { data: link } = await service
    .from("contact_channels")
    .select("contact_id")
    .eq("channel_id", ctx.channel.id)
    .eq("contact_id", r.contact_id)
    .limit(1)
    .maybeSingle();

  if (!link) {
    if (!r.target) return { kind: "skipped", reason: "no_phone" };
    const { error } = await service.from("contact_channels").insert({ contact_id: r.contact_id, channel_id: ctx.channel.id, platform_sender_id: r.target });
    if (error) {
      if (error.code === "23505") return { kind: "skipped", reason: "phone_in_use" };
      return { kind: "failed", message: "No pude vincular el contacto al número.", retryable: true };
    }
  }

  const { data: conv } = await service.from("conversations").select("id").eq("channel_id", ctx.channel.id).eq("contact_id", r.contact_id).maybeSingle();
  if (conv) return conv.id;
  const created = await upsertConversation({
    supabase: service,
    channel: { id: ctx.channel.id, workspace_id: ctx.workspaceId, platform: "whatsapp" },
    contactId: r.contact_id,
    preview,
    at: new Date().toISOString(),
    incrementUnread: false,
  });
  return created ? created.id : { kind: "failed", message: "No pude abrir la conversación.", retryable: true };
}

const EMAIL_SKIP_TO_REASON: Record<string, SendSkipReason> = {
  not_subscribed: "email_not_subscribed",
  unsubscribed: "email_unsubscribed",
  bounced: "email_bounced",
  complained: "email_complained",
  do_not_contact: "do_not_contact",
  unverifiable: "email_unverifiable",
};

async function deliverEmail(
  ctx: LaneContext,
  b: Broadcast,
  r: Recipient,
  currentEmail: string | null,
  variants: string[],
  variables: Record<string, unknown>,
): Promise<RecipientOutcome> {
  const to = (currentEmail ?? "").trim();
  if (!to) return { kind: "skipped", reason: "no_email" };
  const rendered = renderEmail(b.email_subject ?? "", variants[0] ?? "", variables);
  if (rendered.missing.length > 0 && b.skip_missing_variables) {
    return { kind: "skipped", reason: "missing_variables", message: `Faltaba: ${rendered.missing.join(", ")}` };
  }
  const result = await sendTransactionalEmail({
    workspaceId: ctx.workspaceId,
    to,
    subject: rendered.subject || b.name,
    html: rendered.html,
    kind: "broadcast",
    relatedEntityType: "broadcast",
    relatedEntityId: b.id,
    contactId: r.contact_id,
    category: "marketing",
    honorDoNotContact: true,
  });
  if (result.ok) return { kind: "sent", conversationId: null };
  if (result.reason === "deferred") return { kind: "deferred", reason: result.defer, retryAt: result.retryAt };
  if (result.reason === "skipped") return { kind: "skipped", reason: EMAIL_SKIP_TO_REASON[result.skip] ?? "email_unsubscribed", message: result.error };
  if (result.reason === "not_configured") return { kind: "failed", message: result.error, retryable: false, laneFatal: true };
  return { kind: "failed", message: result.error, retryable: true };
}
