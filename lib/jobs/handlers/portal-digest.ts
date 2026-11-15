// @plantilla-quitar(servicios)
/**
 * El resumen semanal por email del estudiante (F128). El barrido diario (`svc_daily`) lo encola los lunes: un job por
 * persona y programa, para las 8:00 en SU zona (`enqueuePortalDigests`). Al correr, vuelve a mirar que el programa lo
 * tenga PRENDIDO y que la persona no lo haya apagado (puede haber cambiado desde que se encoló), arma las secciones y lo
 * manda con el Resend del negocio. Un negocio sin Resend no manda: queda en el registro de emails como no configurado.
 *
 * Nace apagado en todos los programas (`portal_settings.notifications.weekly_digest`): condición de Wendy, 14/11.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { svcRpc } from "@/lib/services/db";
import { sendTransactionalEmail } from "@/lib/email/send";
import { digestSections, localTimeToUtc, weekday, type DigestCounts } from "@/lib/portal-notify/digest";
import { portalDigestEmail, portalDueTodayEmail } from "@/lib/email/templates";
import { resolveBrand } from "@/lib/brand";
import { loadPortalHost, portalUrl } from "@/lib/portal-admin/load";

export const PORTAL_DIGEST_JOB = "portal_digest";
export const PORTAL_DUE_TODAY_JOB = "portal_due_today";

type Db = SupabaseClient<Database>;
interface Target {
  account_id: string;
  contact_id: string;
  email: string;
  display_name: string | null;
  timezone: string;
  product_id: string;
  product_name: string;
}

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Los lunes (fecha local del negocio), encola un resumen por persona y programa para las 8:00 en su zona. */
export async function enqueuePortalDigests(db: Db, workspaceId: string, localDate: string): Promise<number> {
  if (weekday(localDate) !== 1) return 0;
  const res = await svcRpc<Target[]>(db, "portal_digest_targets", { p_workspace_id: workspaceId });
  if (!res.ok) throw new Error(`portal_digest_targets: ${res.error.message}`);
  let n = 0;
  for (const t of res.data ?? []) {
    const dedupe = `portal_digest:${t.account_id}:${t.product_id}:${localDate}`;
    const { error } = await db.from("scheduled_jobs").insert({
      type: PORTAL_DIGEST_JOB,
      payload: { workspace_id: workspaceId, account_id: t.account_id, product_id: t.product_id, week: localDate } as unknown as Json,
      run_at: localTimeToUtc(localDate, 8, t.timezone || "UTC"),
      status: "pending" as const,
      dedupe_key: dedupe,
    });
    if (!error) n++;
    else if (error.code !== "23505") console.error("[portal_digest] no pude encolar:", error.message);
  }
  return n;
}

export async function runPortalDigest({ supabase, job }: JobContext): Promise<void> {
  const p = (job.payload ?? {}) as { workspace_id?: unknown; account_id?: unknown; product_id?: unknown };
  if (!isUuid(p.workspace_id) || !isUuid(p.account_id) || !isUuid(p.product_id)) return;
  // ¿Sigue tocándole? (el programa prendido, la cuenta activa y la preferencia de Perfil).
  const targets = await svcRpc<Target[]>(supabase, "portal_digest_targets", { p_workspace_id: p.workspace_id });
  if (!targets.ok) throw new Error(`portal_digest_targets: ${targets.error.message}`);
  const t = (targets.data ?? []).find((x) => x.account_id === p.account_id && x.product_id === p.product_id);
  if (!t) return;
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const data = await svcRpc<DigestCounts>(supabase, "portal_digest_data", { p_account_id: t.account_id, p_product_id: t.product_id, p_since: since });
  if (!data.ok || !data.data) throw new Error(`portal_digest_data: ${data.ok ? "sin datos" : data.error.message}`);
  // La plantilla del sistema con la marca del negocio (logo, color, botón) y el link al portal si hay dirección.
  const look = await emailLook(supabase, p.workspace_id);
  const content = portalDigestEmail({ brand: look.brand, studentName: t.display_name, programName: t.product_name, sections: digestSections(data.data), portalUrl: look.portalUrl });
  const res = await sendTransactionalEmail({
    workspaceId: p.workspace_id,
    to: t.email,
    subject: content.subject,
    html: content.html,
    fromOverride: look.fromEmail,
    kind: "portal_digest",
    category: "transactional",
    contactId: t.contact_id,
    relatedEntityType: "product",
    relatedEntityId: t.product_id,
    deps: { supabase },
  });
  // Sin Resend, o la dirección no puede recibir: queda en el registro de emails y no se reintenta.
  if (!res.ok && res.reason !== "not_configured" && res.reason !== "skipped") throw new Error(`portal_digest: ${res.error}`);
}

/** La marca, la dirección del portal y el «Enviar desde» del negocio, para los emails del estudiante. */
async function emailLook(db: Db, workspaceId: string) {
  const [{ data: ws }, host] = await Promise.all([
    db.from("workspaces").select("brand_name, brand_logo_path, brand_color" as never).eq("id", workspaceId).maybeSingle(),
    loadPortalHost(db as never, workspaceId),
  ]);
  return { brand: resolveBrand((ws ?? null) as never), portalUrl: host.host ? portalUrl(host.host, "/") : null, fromEmail: host.fromEmail };
}

// ─── «Lo que vence hoy» por email (F128) ─────────────────────────────────────
// Nace APAGADO dos veces: el programa (`notifications.due_today_email`) y la persona (su Perfil). El barrido diario lo
// encola para las 7:00 en la zona de cada estudiante; al correr vuelve a mirar las dos cosas y lo que vence HOY. Si no
// vence nada, no manda nada.

export async function enqueuePortalDueToday(db: Db, workspaceId: string, localDate: string): Promise<number> {
  const res = await svcRpc<Target[]>(db, "portal_due_today_targets", { p_workspace_id: workspaceId });
  if (!res.ok) throw new Error(`portal_due_today_targets: ${res.error.message}`);
  let n = 0;
  for (const t of res.data ?? []) {
    const { error } = await db.from("scheduled_jobs").insert({
      type: PORTAL_DUE_TODAY_JOB,
      payload: { workspace_id: workspaceId, account_id: t.account_id, product_id: t.product_id, day: localDate } as unknown as Json,
      run_at: localTimeToUtc(localDate, 7, t.timezone || "UTC"),
      status: "pending" as const,
      dedupe_key: `portal_due_today:${t.account_id}:${t.product_id}:${localDate}`,
    });
    if (!error) n++;
    else if (error.code !== "23505") console.error("[portal_due_today] no pude encolar:", error.message);
  }
  return n;
}

export async function runPortalDueToday({ supabase, job }: JobContext): Promise<void> {
  const p = (job.payload ?? {}) as { workspace_id?: unknown; account_id?: unknown; product_id?: unknown };
  if (!isUuid(p.workspace_id) || !isUuid(p.account_id) || !isUuid(p.product_id)) return;
  const targets = await svcRpc<Target[]>(supabase, "portal_due_today_targets", { p_workspace_id: p.workspace_id });
  if (!targets.ok) throw new Error(`portal_due_today_targets: ${targets.error.message}`);
  const t = (targets.data ?? []).find((x) => x.account_id === p.account_id && x.product_id === p.product_id);
  if (!t) return;
  const view = await svcRpc<{ today_items?: Array<{ name: string; due_at: string | null }> } | null>(supabase, "portal_notifications_view", { p_account_id: t.account_id, p_product_id: t.product_id });
  if (!view.ok) throw new Error(`portal_notifications_view: ${view.error.message}`);
  const items = view.data?.today_items ?? [];
  if (items.length === 0) return;
  const hhmm = new Intl.DateTimeFormat("es", { timeZone: t.timezone || "UTC", hour: "2-digit", minute: "2-digit" });
  const look = await emailLook(supabase, p.workspace_id);
  const content = portalDueTodayEmail({
    brand: look.brand,
    studentName: t.display_name,
    programName: t.product_name,
    items: items.map((i) => ({ name: i.name, time: i.due_at ? hhmm.format(new Date(i.due_at)) : null })),
    portalUrl: look.portalUrl,
  });
  const res = await sendTransactionalEmail({
    workspaceId: p.workspace_id,
    to: t.email,
    subject: content.subject,
    html: content.html,
    fromOverride: look.fromEmail,
    kind: "portal_due_today",
    category: "transactional",
    contactId: t.contact_id,
    relatedEntityType: "product",
    relatedEntityId: t.product_id,
    deps: { supabase },
  });
  if (!res.ok && res.reason !== "not_configured" && res.reason !== "skipped") throw new Error(`portal_due_today: ${res.error}`);
}

export function registerPortalDigestHandler(): void {
  registerJobHandler(PORTAL_DIGEST_JOB, runPortalDigest);
  registerJobHandler(PORTAL_DUE_TODAY_JOB, runPortalDueToday);
}
