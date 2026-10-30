/**
 * La entrega por email y WhatsApp de un aviso (Mi cuenta → Notificaciones, 00274/00275).
 *
 * Cada aviso que entra a `notifications` encola un job `notification_deliver`
 * (trigger de la 00275). Aca, para ese aviso:
 *   1. a quien va: su `recipient_id`, o Owner/Admin si es general;
 *   2. que eligio cada una para ese evento (`lib/notifications/preferences.ts`);
 *   3. se manda por email (Resend del negocio) y/o WhatsApp (el canal de avisos
 *      del negocio, `team_alerts_settings`) al email de su cuenta y al WhatsApp
 *      de su perfil.
 *
 * Reglas:
 * - **Nunca lanza por un fallo de un proveedor**: reagenda a 1, 5 y 15 minutos
 *   (la cola reintentaria a los 10 s encima). Un error de la base si lanza.
 * - **No manda dos veces**: cada envio queda anotado en `metadata.delivered`
 *   (`<persona>:<canal>` → fecha) en el momento, y un reintento saltea lo hecho.
 * - **Tope anti-spam**: a una persona, por un mismo evento y una misma cosa,
 *   como mucho un email y un WhatsApp cada 10 minutos (la campana sigue igual).
 * - Un aviso de hace mas de 24 horas ya no se manda (llegaria tarde).
 * - Nunca se loguea un email ni un telefono.
 *
 * Las dependencias se inyectan: el test lo corre con espias, sin red.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { eventForType, parseStoredPrefs, resolveEventPrefs, type NotificationChannel } from "./preferences";
import { linkFor } from "./types";

type Db = SupabaseClient<Database>;

export const DELIVER_RETRY_MINUTES = [1, 5, 15] as const;
export const DELIVER_THROTTLE_MINUTES = 10;
export const DELIVER_MAX_AGE_HOURS = 24;

export interface DeliveryNotification {
  id: string;
  workspace_id: string;
  type: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  recipient_id: string | null;
  created_at: string;
}

export interface Recipient {
  userId: string;
  email: string | null;
  whatsapp: string | null;
  prefs: unknown;
}

export interface ChannelSendResult {
  ok: boolean;
  /** Solo si fallo: si tiene sentido reintentar (red, 5xx, 429) o no (numero invalido, sin canal). */
  retryable?: boolean;
}

export interface DeliverDeps {
  loadNotification(id: string): Promise<DeliveryNotification | null>;
  /** Owner y Admin del workspace (para un aviso general). */
  loadAdminIds(workspaceId: string): Promise<string[]>;
  /** Si la persona sigue siendo del workspace. */
  isMember(workspaceId: string, userId: string): Promise<boolean>;
  /** Email de la cuenta, WhatsApp del perfil y preferencias, de cada persona. */
  loadRecipients(workspaceId: string, userIds: string[]): Promise<Recipient[]>;
  /** Los `delivered` de los avisos del mismo evento y la misma cosa en la ventana del tope. */
  recentDeliveries(n: DeliveryNotification, types: readonly string[], since: Date): Promise<Array<Record<string, unknown>>>;
  /** Qué canales puede usar el negocio. */
  channelsAvailable(workspaceId: string): Promise<{ email: boolean; whatsapp: boolean }>;
  sendEmail(n: DeliveryNotification, to: string, link: string | null): Promise<ChannelSendResult>;
  sendWhatsApp(n: DeliveryNotification, to: string, link: string | null): Promise<ChannelSendResult>;
  /** Anota un envio hecho (en el momento, para que un reintento no lo repita). */
  markDelivered(id: string, key: string, at: string): Promise<void>;
  scheduleRetry(id: string, attempt: number, runAt: Date): Promise<void>;
  now(): Date;
}

export type DeliverOutcome =
  | { status: "missing" | "too_old" | "unknown_type" | "no_recipients" }
  | { status: "done"; sent: number; skipped: number; retry: boolean };

export const deliveredKey = (userId: string, channel: Exclude<NotificationChannel, "bell">) => `${userId}:${channel}`;

function deliveredOf(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const d = metadata?.delivered;
  return d && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, unknown>) : {};
}

/** A quien va un aviso: la persona concreta (si sigue en el negocio) o Owner/Admin. Puro salvo las dos lecturas. */
export async function deliveryRecipients(deps: Pick<DeliverDeps, "loadAdminIds" | "isMember">, n: DeliveryNotification): Promise<string[]> {
  if (n.recipient_id) return (await deps.isMember(n.workspace_id, n.recipient_id)) ? [n.recipient_id] : [];
  return [...new Set(await deps.loadAdminIds(n.workspace_id))];
}

export async function deliverNotification(deps: DeliverDeps, notificationId: string, attempt = 0): Promise<DeliverOutcome> {
  const n = await deps.loadNotification(notificationId);
  if (!n) return { status: "missing" };

  const now = deps.now();
  if (now.getTime() - new Date(n.created_at).getTime() > DELIVER_MAX_AGE_HOURS * 3600_000) return { status: "too_old" };

  const event = eventForType(n.type);
  if (!event) return { status: "unknown_type" };

  const userIds = await deliveryRecipients(deps, n);
  if (userIds.length === 0) return { status: "no_recipients" };

  const recipients = await deps.loadRecipients(n.workspace_id, userIds);
  // Lo que quiere cada persona, antes de mirar nada mas: casi siempre nadie quiere nada fuera de la campana.
  const wanted = recipients
    .map((r) => ({ r, prefs: resolveEventPrefs(parseStoredPrefs(r.prefs), event) }))
    .filter(({ prefs }) => prefs.email || prefs.whatsapp);
  if (wanted.length === 0) return { status: "done", sent: 0, skipped: 0, retry: false };

  const available = await deps.channelsAvailable(n.workspace_id);
  const since = new Date(now.getTime() - DELIVER_THROTTLE_MINUTES * 60_000);
  const recent = await deps.recentDeliveries(n, event.types, since);
  const alreadyHere = deliveredOf(n.metadata);
  const rawLink = linkFor(n.entity_type, n.entity_id, n.metadata);

  let sent = 0;
  let skipped = 0;
  let retry = false;

  for (const { r, prefs } of wanted) {
    for (const channel of ["email", "whatsapp"] as const) {
      if (!prefs[channel]) continue;
      const key = deliveredKey(r.userId, channel);
      if (alreadyHere[key]) continue; // ya salio en un intento anterior
      const to = channel === "email" ? r.email : r.whatsapp;
      if (!available[channel] || !to) {
        skipped++;
        continue;
      }
      // El tope: ya le llego uno igual hace menos de 10 minutos.
      if (recent.some((d) => d[key])) {
        skipped++;
        continue;
      }
      const result = channel === "email" ? await deps.sendEmail(n, to, rawLink) : await deps.sendWhatsApp(n, to, rawLink);
      if (result.ok) {
        sent++;
        await deps.markDelivered(n.id, key, now.toISOString());
      } else if (result.retryable) {
        retry = true;
      } else {
        skipped++;
      }
    }
  }

  if (retry && attempt < DELIVER_RETRY_MINUTES.length) {
    await deps.scheduleRetry(n.id, attempt + 1, new Date(now.getTime() + DELIVER_RETRY_MINUTES[attempt] * 60_000));
  }
  return { status: "done", sent, skipped, retry: retry && attempt < DELIVER_RETRY_MINUTES.length };
}

// ---------------------------------------------------------------------------
// Las dependencias de verdad (cliente de servicio)
// ---------------------------------------------------------------------------

/** Las lecturas y escrituras contra la base, con el cliente de servicio. Los envios los pone quien llama. */
export function dbDeliverDeps(db: Db) {
  return {
    async loadNotification(id: string): Promise<DeliveryNotification | null> {
      const { data, error } = await db
        .from("notifications")
        .select("id, workspace_id, type, title, body, entity_type, entity_id, metadata, recipient_id, created_at")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`no pude leer el aviso: ${error.message}`);
      if (!data) return null;
      return { ...data, metadata: (data.metadata ?? {}) as Record<string, unknown> };
    },
    async loadAdminIds(workspaceId: string): Promise<string[]> {
      const { data, error } = await db.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).in("role", ["owner", "admin"]);
      if (error) throw new Error(`no pude leer los admins: ${error.message}`);
      return (data ?? []).map((m) => m.user_id);
    },
    async isMember(workspaceId: string, userId: string): Promise<boolean> {
      const { data, error } = await db.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
      if (error) throw new Error(`no pude leer la membresia: ${error.message}`);
      return Boolean(data);
    },
    async loadRecipients(workspaceId: string, userIds: string[]): Promise<Recipient[]> {
      const [{ data: members, error: mError }, { data: profiles, error: pError }, { data: prefs, error: prError }] = await Promise.all([
        db.rpc("workspace_member_profiles", { p_workspace_id: workspaceId }),
        db.from("user_profiles").select("user_id, phone, whatsapp_phone, whatsapp_same_as_phone").in("user_id", userIds),
        db.from("user_preferences").select("user_id, notification_prefs").in("user_id", userIds),
      ]);
      if (mError) throw new Error(`no pude leer el equipo: ${mError.message}`);
      if (pError) throw new Error(`no pude leer los perfiles: ${pError.message}`);
      if (prError) throw new Error(`no pude leer las preferencias: ${prError.message}`);
      const emailOf = new Map((members ?? []).map((m) => [m.user_id, m.email]));
      const profileOf = new Map((profiles ?? []).map((p) => [p.user_id, p]));
      const prefsOf = new Map((prefs ?? []).map((p) => [p.user_id, p.notification_prefs]));
      return userIds.map((userId) => {
        const p = profileOf.get(userId);
        const whatsapp = p ? (p.whatsapp_same_as_phone ? p.phone : p.whatsapp_phone) : null;
        return { userId, email: emailOf.get(userId) ?? null, whatsapp: whatsapp ?? null, prefs: prefsOf.get(userId) ?? {} };
      });
    },
    async recentDeliveries(n: DeliveryNotification, types: readonly string[], since: Date): Promise<Array<Record<string, unknown>>> {
      let query = db
        .from("notifications")
        .select("metadata")
        .eq("workspace_id", n.workspace_id)
        .in("type", [...types])
        .gte("created_at", since.toISOString())
        .neq("id", n.id)
        .limit(50);
      query = n.entity_id ? query.eq("entity_id", n.entity_id) : query.is("entity_id", null);
      const { data, error } = await query;
      if (error) throw new Error(`no pude leer los avisos recientes: ${error.message}`);
      return (data ?? []).map((row) => deliveredOf(row.metadata as Record<string, unknown> | null));
    },
    async markDelivered(id: string, key: string, at: string): Promise<void> {
      // Leer y escribir: un aviso tiene un solo job vivo a la vez (dedupe de la cola), asi que no se pisan.
      const { data } = await db.from("notifications").select("metadata").eq("id", id).maybeSingle();
      const metadata = (data?.metadata ?? {}) as Record<string, unknown>;
      const delivered = { ...deliveredOf(metadata), [key]: at };
      // El tipo Update de notifications solo admite read_at (lo que puede tocar una persona); esto lo escribe el servidor.
      const { error } = await db
        .from("notifications")
        .update({ metadata: { ...metadata, delivered } as unknown as Json } as never)
        .eq("id", id);
      if (error) console.error("[avisos] no pude anotar el envio:", error.message);
    },
  };
}
