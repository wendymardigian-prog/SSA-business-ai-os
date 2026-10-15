/**
 * Las variables de PIEZA que ven los flujos (Extra I, F34): `{{content.title}}` y `{{content.code}}`, más los ids
 * (`content.social_post_id`, `content.content_post_id`) que el envío guarda en `origin_context.content` (F35).
 *
 * `contentVariablesFor` es PURA. Los resolvedores (`resolveContentForPost`, `resolveContentForAd`) leen con el cliente de
 * servicio y NUNCA lanzan: sin pieza devuelven null y el flujo corre como siempre.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

export interface ContentVariables {
  social_post_id: string | null;
  content_post_id: string | null;
  code: string | null;
  title: string | null;
}

export interface PublicationForVariables {
  socialPostId: string | null;
  contentPostId: string | null;
  attributionCode: string | null;
  title: string | null;
}

const clean = (v: unknown, max = 200): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

/** `{ social_post_id, content_post_id, code, title }`, o null si no hay ni publicación ni pieza. */
export function contentVariablesFor(pub: PublicationForVariables | null | undefined): ContentVariables | null {
  if (!pub) return null;
  const social = clean(pub.socialPostId, 100);
  const piece = clean(pub.contentPostId, 100);
  if (!social && !piece) return null;
  return { social_post_id: social, content_post_id: piece, code: clean(pub.attributionCode, 20), title: clean(pub.title, 120) };
}

/** Las variables que el editor ofrece cuando el disparador sabe de qué pieza viene (comentarios, historias, anuncios). */
export const CONTENT_VARIABLE_KEYS = ["content.title", "content.code"] as const;

/** Lo que el saliente de un flujo guarda en `origin_context.content` si el contexto trae una pieza. */
export function flowContentOrigin(variables: Record<string, unknown> | null | undefined, flowId: string | null | undefined): Record<string, unknown> | null {
  const raw = variables?.content;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  const social = clean(c.social_post_id, 100);
  const piece = clean(c.content_post_id, 100);
  if (!social && !piece) return null;
  const title = clean(c.title, 120);
  const flow = clean(flowId, 100);
  return {
    ...(social ? { social_post_id: social } : {}),
    ...(piece ? { content_post_id: piece } : {}),
    via: "flow",
    ...(flow ? { flow_id: flow } : {}),
    ...(title ? { title } : {}),
  };
}

/** `{ content: {...} }` si el flujo trae una pieza (comentario, historia o anuncio de una pieza); null si no. */
export function sentContentContext(context: { variables?: Record<string, unknown> | null; flowId?: string | null }): { content: Record<string, unknown> } | null {
  const content = flowContentOrigin(context.variables, context.flowId ?? null);
  return content ? { content } : null;
}

type Db = SupabaseClient<Database>;

async function pieceFields(db: Db, contentPostId: string | null): Promise<{ title: string | null; code: string | null }> {
  if (!contentPostId) return { title: null, code: null };
  const { data } = await db.from("content_posts").select("title, attribution_code").eq("id", contentPostId).maybeSingle();
  const row = data as { title?: string | null; attribution_code?: string | null } | null;
  return { title: row?.title ?? null, code: row?.attribution_code ?? null };
}

/** La publicación comentada (por el id EN LA RED y la plataforma) → variables. Una sola fila o nada. */
export async function resolveContentForPost(db: Db, args: { workspaceId: string; platform: string; externalPostId: string | null | undefined }): Promise<ContentVariables | null> {
  try {
    const external = clean(args.externalPostId, 300);
    if (!external) return null;
    const { data, error } = await db
      .from("social_posts").select("id, content_post_id, caption")
      .eq("workspace_id", args.workspaceId).eq("platform", args.platform as never).eq("external_post_id", external).is("deleted_at", null).limit(2);
    if (error || !data || data.length !== 1) return null;
    const row = data[0] as { id: string; content_post_id: string | null; caption: string | null };
    const piece = await pieceFields(db, row.content_post_id);
    const title = piece.title ?? (row.caption ?? "").split("\n").find((l) => l.trim())?.trim().slice(0, 80) ?? null;
    return contentVariablesFor({ socialPostId: row.id, contentPostId: row.content_post_id, attributionCode: piece.code, title });
  } catch {
    return null;
  }
}

/** Un anuncio de Meta vinculado a una pieza (`meta_ads.content_post_id`) → variables. */
export async function resolveContentForAd(db: Db, args: { workspaceId: string; adId: string | null | undefined }): Promise<ContentVariables | null> {
  try {
    const adId = clean(args.adId, 100);
    if (!adId) return null;
    const { data } = await db.from("meta_ads").select("social_post_id, content_post_id").eq("workspace_id", args.workspaceId).eq("ad_id", adId).maybeSingle();
    const row = data as { social_post_id: string | null; content_post_id: string | null } | null;
    if (!row || (!row.social_post_id && !row.content_post_id)) return null;
    const piece = await pieceFields(db, row.content_post_id);
    return contentVariablesFor({ socialPostId: row.social_post_id, contentPostId: row.content_post_id, attributionCode: piece.code, title: piece.title });
  } catch {
    return null;
  }
}

/**
 * La pieza que lleva un mensaje ENTRANTE (historia propia, respuesta a un DM de automatización o anuncio vinculado), en
 * ese orden de prioridad (el anuncio gana en el toque, pero acá se ofrece la primera pieza conocida). Null si ninguna.
 */
export async function resolveContentForIncoming(
  db: Db,
  args: {
    workspaceId: string;
    storyPiece: { socialPostId: string; contentPostId: string | null; title: string | null } | null;
    inherited: { social_post_id: string | null; content_post_id: string | null; title?: string | null } | null;
    adId: string | null | undefined;
  },
): Promise<ContentVariables | null> {
  try {
    const known = args.storyPiece
      ? { socialPostId: args.storyPiece.socialPostId, contentPostId: args.storyPiece.contentPostId, title: args.storyPiece.title }
      : args.inherited
        ? { socialPostId: args.inherited.social_post_id, contentPostId: args.inherited.content_post_id, title: args.inherited.title ?? null }
        : null;
    if (known) {
      const piece = await pieceFields(db, known.contentPostId);
      return contentVariablesFor({ ...known, attributionCode: piece.code, title: piece.title ?? known.title });
    }
    return await resolveContentForAd(db, { workspaceId: args.workspaceId, adId: args.adId });
  } catch {
    return null;
  }
}
