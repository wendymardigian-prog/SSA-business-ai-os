// @plantilla-quitar(servicios)
/**
 * El aviso por correo de una publicación nueva del equipo en la comunidad (00405).
 *
 * Dos pasos, los dos por la cola:
 *  1. `community_post_email` (reparto): lo encola la acción de publicar. Relee el post (si ya no está, no hace nada),
 *     pide los destinatarios a la base (`community_email_targets`: cuenta del portal ACTIVA, con acceso a la comunidad
 *     y miembro de alguna de las comunidades del post) y encola un envío por persona, espaciados, para no chocar con el
 *     límite de Resend. Clave por persona y post: nadie recibe dos veces el mismo aviso, aunque el reparto corra dos.
 *  2. `community_post_email_send`: vuelve a mirar el post y a la persona (pudo cambiar desde que se encoló), arma el
 *     correo con la marca del negocio y lo manda (transaccional, como el resumen semanal). Sin Resend o con una
 *     dirección que no puede recibir, queda en el registro de emails y no se reintenta.
 *
 * Nunca se loguea un email ni el contenido del post.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { svcRpc, type SvcResult } from "@/lib/services/db";
import { sendTransactionalEmail, type SendEmailResult } from "@/lib/email/send";
import { communityPostEmail } from "@/lib/email/templates";
import { resolveBrand, type Brand } from "@/lib/brand";
import { loadPortalHost, portalUrl } from "@/lib/portal-admin/load";

export const COMMUNITY_POST_EMAIL_JOB = "community_post_email";
export const COMMUNITY_POST_EMAIL_SEND_JOB = "community_post_email_send";
/** Entre un envío y el siguiente (Resend deja ~2 por segundo). */
export const COMMUNITY_EMAIL_SPACING_MS = 700;

type Db = SupabaseClient<Database>;

export interface CommunityEmailPost {
  id: string;
  workspace_id: string;
  product_id: string;
  product_name: string;
  community_key: string;
  title: string | null;
  body: string;
  photo_count: number;
  live: boolean;
}

export interface CommunityEmailTarget {
  contact_id: string;
  email: string;
  display_name: string | null;
}

export interface CommunityEmailPayload {
  workspace_id: string;
  product_id: string;
  post_id: string;
  community_keys: string[];
  author_label: string;
}

/** Lo que el handler necesita de afuera (en los tests se simula). */
export interface CommunityEmailDeps {
  loadPost: (db: Db, postId: string) => Promise<SvcResult<CommunityEmailPost | null>>;
  loadTargets: (db: Db, productId: string, keys: string[]) => Promise<SvcResult<CommunityEmailTarget[]>>;
  enqueue: (db: Db, row: { type: string; payload: Json; run_at: string; dedupe_key: string }) => Promise<{ code?: string; message: string } | null>;
  look: (db: Db, workspaceId: string) => Promise<{ brand: Brand; host: string | null; fromEmail: string | null }>;
  send: typeof sendTransactionalEmail;
  now: () => number;
}

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const isKey = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9_]{1,40}$/.test(v);

/** El payload del reparto, validado (null si no sirve). */
export function parseCommunityEmailPayload(raw: unknown): CommunityEmailPayload | null {
  const p = (raw ?? {}) as Record<string, unknown>;
  if (!isUuid(p.workspace_id) || !isUuid(p.product_id) || !isUuid(p.post_id)) return null;
  const keys = Array.isArray(p.community_keys) ? p.community_keys.filter(isKey).slice(0, 20) : [];
  const author = typeof p.author_label === "string" ? p.author_label.trim().slice(0, 120) : "";
  return { workspace_id: p.workspace_id, product_id: p.product_id, post_id: p.post_id, community_keys: keys, author_label: author };
}

/** La clave de un envío: una por persona y post. */
export const communityEmailDedupe = (postId: string, contactId: string) => `community_post_email:${postId}:${contactId}`;

export const defaultCommunityEmailDeps: CommunityEmailDeps = {
  loadPost: (db, postId) => svcRpc<CommunityEmailPost | null>(db, "community_post_for_email", { p_post_id: postId }),
  loadTargets: (db, productId, keys) => svcRpc<CommunityEmailTarget[]>(db, "community_email_targets", { p_product_id: productId, p_keys: keys }),
  enqueue: async (db, row) => {
    const { error } = await db.from("scheduled_jobs").insert({ ...row, status: "pending" as const });
    return error ? { code: error.code, message: error.message } : null;
  },
  look: async (db, workspaceId) => {
    const [{ data: ws }, host] = await Promise.all([
      db.from("workspaces").select("brand_name, brand_logo_path, brand_color" as never).eq("id", workspaceId).maybeSingle(),
      loadPortalHost(db as never, workspaceId),
    ]);
    return { brand: resolveBrand((ws ?? null) as never), host: host.host, fromEmail: host.fromEmail };
  },
  send: sendTransactionalEmail,
  now: () => Date.now(),
};

/** ¿El post sigue siendo del negocio y del programa del pedido, y visible? */
function usablePost(post: CommunityEmailPost | null, p: CommunityEmailPayload): post is CommunityEmailPost {
  return !!post && post.live && post.workspace_id === p.workspace_id && post.product_id === p.product_id && !!post.title;
}

export async function runCommunityPostEmail({ supabase, job }: JobContext, deps: CommunityEmailDeps = defaultCommunityEmailDeps): Promise<void> {
  const p = parseCommunityEmailPayload(job.payload);
  if (!p) return;
  const post = await deps.loadPost(supabase, p.post_id);
  if (!post.ok) throw new Error(`community_post_for_email: ${post.error.message}`);
  if (!usablePost(post.data, p)) return;
  const keys = p.community_keys.length ? p.community_keys : [post.data.community_key];
  const targets = await deps.loadTargets(supabase, p.product_id, keys);
  if (!targets.ok) throw new Error(`community_email_targets: ${targets.error.message}`);
  const start = deps.now();
  let failed = 0;
  for (const [i, t] of (targets.data ?? []).entries()) {
    const err = await deps.enqueue(supabase, {
      type: COMMUNITY_POST_EMAIL_SEND_JOB,
      payload: { ...p, community_keys: keys, contact_id: t.contact_id } as unknown as Json,
      run_at: new Date(start + i * COMMUNITY_EMAIL_SPACING_MS).toISOString(),
      dedupe_key: communityEmailDedupe(p.post_id, t.contact_id),
    });
    // 23505 = ya estaba encolado (un reparto repetido): no es un error.
    if (err && err.code !== "23505") failed++;
  }
  // Lo que no se pudo encolar se reintenta con el reparto entero: los ya encolados chocan con su clave y no se repiten.
  if (failed) throw new Error(`community_post_email: no pude encolar ${failed} envíos`);
}

export async function runCommunityPostEmailSend({ supabase, job }: JobContext, deps: CommunityEmailDeps = defaultCommunityEmailDeps): Promise<SendEmailResult | null> {
  const p = parseCommunityEmailPayload(job.payload);
  const contactId = (job.payload as { contact_id?: unknown } | null)?.contact_id;
  if (!p || !isUuid(contactId)) return null;
  const post = await deps.loadPost(supabase, p.post_id);
  if (!post.ok) throw new Error(`community_post_for_email: ${post.error.message}`);
  if (!usablePost(post.data, p)) return null;
  // ¿Le sigue tocando? (la cuenta pudo suspenderse o perder el acceso desde que se encoló).
  const targets = await deps.loadTargets(supabase, p.product_id, p.community_keys.length ? p.community_keys : [post.data.community_key]);
  if (!targets.ok) throw new Error(`community_email_targets: ${targets.error.message}`);
  const t = (targets.data ?? []).find((x) => x.contact_id === contactId);
  if (!t) return null;
  const look = await deps.look(supabase, p.workspace_id);
  const content = communityPostEmail({
    brand: look.brand,
    authorName: p.author_label || look.brand.name,
    title: post.data.title as string,
    body: post.data.body,
    photoCount: post.data.photo_count,
    programName: post.data.product_name,
    portalUrl: look.host ? portalUrl(look.host, `/p/${p.product_id}/comunidad`) : null,
  });
  const res = await deps.send({
    workspaceId: p.workspace_id,
    to: t.email,
    subject: content.subject,
    html: content.html,
    fromOverride: look.fromEmail,
    kind: "community_post",
    category: "transactional",
    contactId: t.contact_id,
    relatedEntityType: "product",
    relatedEntityId: p.product_id,
    deps: { supabase },
  });
  // Sin Resend, o la dirección no puede recibir: queda en el registro de emails y no se reintenta.
  if (!res.ok && res.reason !== "not_configured" && res.reason !== "skipped") throw new Error(`community_post_email_send: ${res.error}`);
  return res;
}

export function registerCommunityPostEmailHandlers(): void {
  registerJobHandler(COMMUNITY_POST_EMAIL_JOB, (ctx) => runCommunityPostEmail(ctx));
  registerJobHandler(COMMUNITY_POST_EMAIL_SEND_JOB, async (ctx) => {
    await runCommunityPostEmailSend(ctx);
  });
}
