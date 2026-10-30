/**
 * El job `notification_deliver`: manda un aviso por email y/o WhatsApp a quien
 * lo eligio en Mi cuenta → Notificaciones. Lo encola el trigger de la 00275 al
 * insertarse cada aviso. Fino a proposito: las reglas viven en
 * `lib/notifications/deliver.ts`.
 *
 * NUNCA lanza por un fallo de un proveedor (Resend, Evolution): la logica
 * reagenda a 1, 5 y 15 minutos con `scheduleJob` (la cola reintentaria a los
 * 10 s encima). Un error de la base si lanza: la cola reintenta, y lo que ya
 * salio no se repite (`metadata.delivered`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { scheduleJob } from "@/lib/scheduler";
import { appUrl } from "@/lib/app-url";
import { resolveBrand } from "@/lib/brand";
import { sendTransactionalEmail } from "@/lib/email/send";
import { teamNotificationEmail } from "@/lib/email/templates";
import { accountTabHref } from "@/lib/account/tabs";
import { dbDeliverDeps, deliverNotification, type DeliverDeps, type DeliveryNotification } from "@/lib/notifications/deliver";
import { emailConfigured, loadTeamAlertsChannel, type TeamAlertsChannel } from "@/lib/notifications/team-alerts";
import { sendTeamWhatsApp } from "@/lib/notifications/team-whatsapp";

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
  const brandCache = new Map<string, { name: string; color: string | null }>();
  const channelCache = new Map<string, TeamAlertsChannel | null>();

  async function brandOf(workspaceId: string) {
    const cached = brandCache.get(workspaceId);
    if (cached) return cached;
    const { data } = await db.from("workspaces").select("name, brand_name, brand_logo_path, brand_color").eq("id", workspaceId).maybeSingle();
    const brand = { name: data?.brand_name?.trim() || data?.name || "Tu negocio", color: resolveBrand(data).colorHex };
    brandCache.set(workspaceId, brand);
    return brand;
  }

  return {
    ...base,
    async channelsAvailable(workspaceId) {
      const [email, channel] = await Promise.all([emailConfigured(db, workspaceId), loadTeamAlertsChannel(db, workspaceId)]);
      channelCache.set(workspaceId, channel);
      return { email, whatsapp: Boolean(channel) };
    },
    async sendEmail(n, to, link) {
      const brand = await brandOf(n.workspace_id);
      const content = teamNotificationEmail({
        title: n.title,
        body: n.body,
        url: absolute(link),
        settingsUrl: `${appUrl()}${accountTabHref("notificaciones")}`,
        businessName: brand.name,
        brandColor: brand.color,
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
      return result.ok ? { ok: true } : { ok: false, retryable: result.retryable };
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
