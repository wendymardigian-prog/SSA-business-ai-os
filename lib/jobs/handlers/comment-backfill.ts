/**
 * El vínculo retroactivo de comentarios (Extra I, F32).
 *
 * Alguien comenta una publicación antes de ser contacto; días después escribe por DM y nace su contacto con su usuario de
 * Instagram o TikTok. Esos comentarios viejos quedaron guardados sin contacto: este job los une a la persona y anota sus
 * toques (con la fecha del comentario, no la de hoy). Como `record_contact_touch` recalcula el primer toque desde la
 * tabla, un comentario anterior pasa a ser su primer toque: es el primer contacto real.
 *
 * Dos tipos de job:
 *   - `comment_backfill`            un contacto. Lo encola el trigger de `contacts` (00234) 5 s después de que gane un usuario.
 *   - `comment_backfill_workspace`  el barrido inicial: recorre los contactos con usuario de a 200 y encola uno por contacto.
 *
 * NUNCA lanza por un comentario: anota y sigue. Lanza SOLO si no pudo leer lo que necesita (la cola reintenta).
 * Repetir el job es seguro: el vínculo es condicional (`contact_id IS NULL`) y el toque se deduplica por `comment:<id>`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { linkCommentToContact } from "@/lib/comments/link-to-contact";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { scheduleJob } from "@/lib/scheduler";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

export const COMMENT_BACKFILL_JOB = "comment_backfill";
export const COMMENT_BACKFILL_WORKSPACE_JOB = "comment_backfill_workspace";

/** Comentarios por corrida y contactos por página del barrido. */
export const BACKFILL_BATCH = 200;
const PLATFORMS = ["instagram", "tiktok"] as const;
type Platform = (typeof PLATFORMS)[number];

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const usernameKey = (u: string) => u.trim().replace(/^@+/, "").toLowerCase();

interface CommentRow {
  external_comment_id: string;
  author_username: string | null;
  commented_at: string | null;
  social_post_id: string | null;
  platform: string;
}

/** Une los comentarios sin contacto de UNA red con ese contacto. Devuelve cuántos vinculó y si hay más. */
async function backfillPlatform(db: Db, workspaceId: string, contactId: string, platform: Platform, username: string): Promise<{ linked: number; more: boolean }> {
  const key = usernameKey(username);
  if (!key) return { linked: 0, more: false };
  // `_` es comodín en ILIKE (y los usuarios lo llevan): trae de más y se afina acá, comparando en minúsculas.
  const pattern = key.replace(/[%\\]/g, "");
  const { data, error } = await db
    .from("social_post_comments")
    .select("external_comment_id, author_username, commented_at, social_post_id, platform")
    .eq("workspace_id", workspaceId)
    .eq("platform", platform)
    .ilike("author_username", pattern)
    .is("contact_id", null)
    .eq("is_own", false)
    .is("deleted_at", null)
    .order("commented_at", { ascending: true })
    .limit(BACKFILL_BATCH);
  if (error) throw new Error(`comment_backfill: no pude leer los comentarios: ${error.message}`);

  const rows = ((data ?? []) as unknown as CommentRow[]).filter((r) => r.author_username && usernameKey(r.author_username) === key);
  let linked = 0;
  for (const row of rows) {
    const result = await linkCommentToContact(db, {
      workspaceId,
      contactId,
      comment: { platform, externalCommentId: row.external_comment_id, commentedAt: row.commented_at, socialPostId: row.social_post_id, onlyIfUnlinked: true },
    });
    if (result.linked) linked += 1;
  }
  return { linked, more: (data ?? []).length >= BACKFILL_BATCH && linked > 0 };
}

export async function handleCommentBackfill(ctx: JobContext): Promise<void> {
  const payload = ctx.job.payload as { workspace_id?: unknown; contact_id?: unknown; platform?: unknown } | null;
  if (!payload || !isUuid(payload.workspace_id) || !isUuid(payload.contact_id)) return;
  const db = ctx.supabase;

  const { data: contact, error } = await db
    .from("contacts")
    .select("instagram_username, tiktok_username, deleted_at")
    .eq("id", payload.contact_id)
    .eq("workspace_id", payload.workspace_id)
    .maybeSingle();
  if (error) throw new Error(`comment_backfill: no pude leer el contacto: ${error.message}`);
  const row = contact as { instagram_username: string | null; tiktok_username: string | null; deleted_at: string | null } | null;
  if (!row || row.deleted_at) return;

  const wanted: Platform[] = payload.platform === "instagram" ? ["instagram"] : payload.platform === "tiktok" ? ["tiktok"] : [...PLATFORMS];
  let again = false;
  for (const platform of wanted) {
    const username = platform === "instagram" ? row.instagram_username : row.tiktok_username;
    if (!username) continue;
    const result = await backfillPlatform(db, payload.workspace_id, payload.contact_id, platform, username);
    if (result.more) again = true;
  }
  if (again) {
    // Había más de 200 comentarios: otra pasada en un minuto (solo si esta vinculó alguno, así no se encicla).
    try {
      await scheduleJob(db, COMMENT_BACKFILL_JOB, { ...payload }, new Date(Date.now() + 60_000), `comment_backfill:${payload.contact_id}:next`);
    } catch (e) {
      if ((e as { code?: string } | null)?.code !== "23505") console.error("[comment_backfill] no pude reagendar:", e instanceof Error ? e.message : String(e));
    }
  }
}

/** El barrido inicial: una página de contactos con usuario, un `comment_backfill` por cada uno, y reagenda con un cursor. */
export async function handleCommentBackfillWorkspace(ctx: JobContext): Promise<void> {
  const payload = ctx.job.payload as { workspace_id?: unknown; cursor?: unknown } | null;
  if (!payload || !isUuid(payload.workspace_id)) return;
  const db = ctx.supabase;
  const cursor = isUuid(payload.cursor) ? payload.cursor : null;

  let query = db
    .from("contacts")
    .select("id, instagram_username, tiktok_username")
    .eq("workspace_id", payload.workspace_id)
    .is("deleted_at", null)
    .or("instagram_username.not.is.null,tiktok_username.not.is.null")
    .order("id", { ascending: true })
    .limit(BACKFILL_BATCH);
  if (cursor) query = query.gt("id", cursor);
  const { data, error } = await query;
  if (error) throw new Error(`comment_backfill_workspace: no pude leer los contactos: ${error.message}`);

  const contacts = (data ?? []) as unknown as Array<{ id: string; instagram_username: string | null; tiktok_username: string | null }>;
  for (const c of contacts) {
    if (!c.instagram_username && !c.tiktok_username) continue;
    try {
      await scheduleJob(db, COMMENT_BACKFILL_JOB, { workspace_id: payload.workspace_id, contact_id: c.id }, new Date(), `comment_backfill:${c.id}:sweep`);
    } catch (e) {
      if ((e as { code?: string } | null)?.code !== "23505") console.error("[comment_backfill_workspace] no pude encolar un contacto:", e instanceof Error ? e.message : String(e));
    }
  }
  if (contacts.length >= BACKFILL_BATCH) {
    const last = contacts[contacts.length - 1].id;
    try {
      await scheduleJob(db, COMMENT_BACKFILL_WORKSPACE_JOB, { workspace_id: payload.workspace_id, cursor: last }, new Date(Date.now() + 30_000), `comment_backfill_workspace:${payload.workspace_id}:${last}`);
    } catch (e) {
      if ((e as { code?: string } | null)?.code !== "23505") throw e;
    }
  }
}

export function registerCommentBackfillHandlers(): void {
  registerJobHandler(COMMENT_BACKFILL_JOB, handleCommentBackfill);
  registerJobHandler(COMMENT_BACKFILL_WORKSPACE_JOB, handleCommentBackfillWorkspace);
}
