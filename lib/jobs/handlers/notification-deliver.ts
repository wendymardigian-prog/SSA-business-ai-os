/**
 * El job `notification_deliver`: manda un aviso por email, WhatsApp y/o Slack a quien
 * lo eligio en Mi cuenta → Notificaciones. Lo encola el trigger de la 00275 al
 * insertarse cada aviso. Fino a proposito: las reglas viven en
 * `lib/notifications/deliver.ts`.
 *
 * NUNCA lanza por un fallo de un proveedor (Resend, Evolution): la logica
 * reagenda a 1, 5 y 15 minutos con `scheduleJob` (la cola reintentaria a los
 * 10 s encima), y un WhatsApp que encontro el numero en su tope, para la hora
 * siguiente. Un error de la base si lanza: la cola reintenta, y lo que ya
 * salio no se repite (`metadata.delivered`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { scheduleJob } from "@/lib/scheduler";
import { appUrl } from "@/lib/app-url";
import { resolveBrand, type Brand } from "@/lib/brand";
import { sendTransactionalEmail } from "@/lib/email/send";
import { teamNotificationEmail } from "@/lib/email/templates";
import { accountTabHref } from "@/lib/account/tabs";
import { dbDeliverDeps, deliverNotification, type DeliverDeps, type DeliveryNotification } from "@/lib/notifications/deliver";
import { emailConfigured, loadTeamAlertsChannel, type TeamAlertsChannel } from "@/lib/notifications/team-alerts";
import { sendTeamWhatsApp } from "@/lib/notifications/team-whatsapp";
import { readSecret } from "@/lib/vault";
import { SECRET_NAMES } from "@/lib/secret-names";
import { postMessage as postSlackMessage, slackNotificationText } from "@/lib/integrations/slack";
import { notifyIntegrationAttention } from "@/lib/notifications/integration-alerts";

type Db = SupabaseClient<Database>;

export const NOTIFICATION_DELIVER_JOB = "notification_deliver";

const absolute = (path: string | null) => (path ? `${appUrl()}${path}` : null);

/** El texto del WhatsApp: corto, con el negocio adelante y el link al final. */
export function whatsappText(businessName: string, n: Pick<DeliveryNotification, "title" | "body">, link: string | null): string {
  const lines = [`*${businessName}* · ${n.title}`];
  if (n.body?.trim()) lines.push(n.body.trim());
  if (link) lines.push(link);
  return lines.join("\n");
}

export function realDeliverDeps(db: Db): DeliverDeps {
  const base = dbDeliverDeps(db);
  const brandCache = new Map<string, { name: string; brand: Brand }>();
  const channelCache = new Map<string, TeamAlertsChannel | null>();
  const slackCache = new Map<string, boolean>();

  /** Si el negocio conectó Slack (la fila activa). Leer el token se hace recién al mandar. */
  async function slackConnected(workspaceId: string): Promise<boolean> {
    const cached = slackCache.get(workspaceId);
    if (cached !== undefined) return cached;
    const { data } = await db
      .from("integration_configs")
      .select("is_active")
      .eq("workspace_id", workspaceId)
      .eq("type", "slack")
      .eq("provider", "slack")
      .maybeSingle();
    const on = Boolean(data?.is_active);
    slackCache.set(workspaceId, on);
    return on;
  }

  async function brandOf(workspaceId: string) {
    const cached = brandCache.get(workspaceId);
    if (cached) return cached;
    const { data } = await db.from("workspaces").select("name, brand_name, brand_logo_path, brand_color").eq("id", workspaceId).maybeSingle();
    // `name` va en el asunto y el WhatsApp (su marca o su nombre de workspace); la cabecera del email
    // (logo, nombre y color) es la de `resolveBrand`, igual que la invitacion.
    const brand = { name: data?.brand_name?.trim() || data?.name || "Tu negocio", brand: resolveBrand(data) };
    brandCache.set(workspaceId, brand);
    return brand;
  }

  return {
    ...base,
    async channelsAvailable(workspaceId) {
      const [email, channel, slack] = await Promise.all([
        emailConfigured(db, workspaceId),
        loadTeamAlertsChannel(db, workspaceId),
        slackConnected(workspaceId),
      ]);
      channelCache.set(workspaceId, channel);
      return { email, whatsapp: Boolean(channel), slack };
    },
    async sendEmail(n, to, link) {
      const brand = await brandOf(n.workspace_id);
      const content = teamNotificationEmail({
        title: n.title,
        body: n.body,
        url: absolute(link),
        settingsUrl: `${appUrl()}${accountTabHref("notificaciones")}`,
        businessName: brand.name,
        brand: brand.brand,
      });
      // Un aviso al EQUIPO: sin categoria (no es de ningun contacto; subscription-gate.test.ts lo lista).
      const result = await sendTransactionalEmail({
        workspaceId: n.workspace_id,
        to,
        subject: content.subject,
        html: content.html,
        kind: `notification:${n.type}`,
        relatedEntityType: "notification",
        relatedEntityId: n.id,
      });
      if (result.ok) return { ok: true };
      return { ok: false, retryable: result.reason === "failed" };
    },
    async sendWhatsApp(n, to, link) {
      const brand = await brandOf(n.workspace_id);
      const channel = channelCache.has(n.workspace_id) ? channelCache.get(n.workspace_id) : undefined;
      const result = await sendTeamWhatsApp(db, n.workspace_id, to, whatsappText(brand.name, n, absolute(link)), channel);
      if (result.ok) return { ok: true };
      // El numero de avisos llego a su tope de la hora: se reagenda para cuando se libera, sin gastar un intento.
      if (result.reason === "rate_limited") return { ok: false, retryable: true, retryAt: result.retryAt };
      return { ok: false, retryable: result.retryable };
    },
    async sendSlack(n, to, link) {
      // Slack (Servicios A4, F133). Nunca se loguea el token ni el ID.
      let token: string | null = null;
      try {
        token = await readSecret(db, n.workspace_id, SECRET_NAMES.slackBotToken);
      } catch {
        return { ok: false, retryable: true };
      }
      if (!token) return { ok: false, retryable: false };
      const result = await postSlackMessage(token, to, slackNotificationText({ title: n.title, body: n.body, url: absolute(link) }));
      if (result.ok) return { ok: true };
      if (result.invalidToken) {
        // Token inválido: la tarjeta queda con el error y Owner/Admin reciben un aviso (con su ventana de repetición).
        await db
          .from("integration_configs")
          .update({ last_error: "Slack rechazó el token del bot." })
          .eq("workspace_id", n.workspace_id)
          .eq("type", "slack")
          .eq("provider", "slack");
        await notifyIntegrationAttention({
          supabase: db,
          workspaceId: n.workspace_id,
          providerId: "slack",
          providerLabel: "Slack",
          cause: "revoked",
          detail: "Slack rechazó el token del bot: los avisos por Slack no salen hasta que lo vuelvas a conectar.",
        }).catch(() => undefined);
      }
      return { ok: false, retryable: result.temporary };
    },
    async scheduleRetry(id, attempt, runAt) {
      try {
        await scheduleJob(db, NOTIFICATION_DELIVER_JOB, { notification_id: id, attempt }, runAt, `${NOTIFICATION_DELIVER_JOB}:${id}:${attempt}`);
      } catch (err) {
        // 23505: ya hay uno agendado. Cualquier otro: se pierde el reintento, no el aviso (sigue en la campana).
        const code = (err as { code?: string } | null)?.code;
        if (code !== "23505") console.error("[avisos] no pude reagendar la entrega:", err instanceof Error ? err.message : String(err));
      }
    },
    now: () => new Date(),
  };
}

export async function handleNotificationDeliver(ctx: JobContext): Promise<void> {
  const payload = ctx.job.payload as { notification_id?: unknown; attempt?: unknown } | null;
  const id = payload?.notification_id;
  if (typeof id !== "string") return;
  const attempt = typeof payload?.attempt === "number" && payload.attempt >= 0 ? Math.floor(payload.attempt) : 0;
  const outcome = await deliverNotification(realDeliverDeps(ctx.supabase), id, attempt);
  if (outcome.status === "done" && (outcome.sent > 0 || outcome.retry)) {
    console.log(`[avisos] ${id}: ${outcome.sent} enviados, ${outcome.skipped} salteados${outcome.retry ? ", con reintento" : ""}`);
  }
}

export function registerNotificationDeliverHandler(): void {
  registerJobHandler(NOTIFICATION_DELIVER_JOB, handleNotificationDeliver);
}
