/**
 * Volver a leer los comentarios (F46).
 *
 * El webhook trae los comentarios en el momento, y eso es lo que importa
 * para contestar. Pero se pierde cosas: los de antes de conectar la cuenta,
 * los que el proveedor no entrego, y los likes, que cambian sin avisar. Por
 * eso el cron los vuelve a leer para los posts de hasta 30 dias.
 *
 * **LinkedIn no permite leer comentarios** con los permisos que da a una app
 * sin partnership. No es un error nuestro ni algo que se arregle
 * reconectando: se dice en pantalla y listo.
 */

import type { createZernioClient } from "@/lib/zernio-client";
import { THREADS_API } from "@/lib/metrics/threads";
import { plainError } from "@/lib/metrics/youtube";
import type { IncomingComment } from "./store";

/** Las redes de las que se pueden releer comentarios. */
export const READABLE_PLATFORMS = ["instagram", "tiktok", "threads", "youtube"] as const;

/** Por que no se pueden leer los de LinkedIn, en palabras. */
export const LINKEDIN_COMMENTS_NOTE =
  "LinkedIn no deja leer los comentarios desde afuera. Se contestan desde LinkedIn.";

export function canReadComments(platform: string): boolean {
  return (READABLE_PLATFORMS as readonly string[]).includes(platform);
}

export interface CommentSyncResult {
  comments: IncomingComment[];
  warnings: string[];
}

interface ZernioComment {
  id?: string;
  message?: string;
  createdTime?: string;
  likeCount?: number;
  isHidden?: boolean;
  from?: { id?: string; name?: string; username?: string; picture?: string | null; isOwner?: boolean };
}

/**
 * Los comentarios de un post de Instagram o TikTok, por Zernio.
 *
 * Verificado contra el SDK: `inbox.getInboxPostComments` con el post y la
 * cuenta. `from.isOwner` dice si el comentario es nuestro, que es mas
 * confiable que comparar nombres de usuario.
 */
export async function readZernioComments(params: {
  client: ReturnType<typeof createZernioClient>;
  postId: string;
  accountId: string;
  platform: string;
  limit?: number;
}): Promise<CommentSyncResult> {
  const response = await params.client.comments.getInboxPostComments({
    path: { postId: params.postId },
    query: { accountId: params.accountId, limit: params.limit ?? 100 },
  });

  if (response.error) {
    return { comments: [], warnings: [`Comentarios de ${params.platform}: no pude leerlos`] };
  }

  const data = response.data as { comments?: ZernioComment[] } | undefined;

  return {
    comments: (data?.comments ?? [])
      .filter((c): c is ZernioComment & { id: string } => Boolean(c.id))
      .map((c) => ({
        platform: params.platform,
        externalCommentId: c.id,
        externalPostId: params.postId,
        authorExternalId: c.from?.id ?? null,
        authorUsername: c.from?.username ?? null,
        authorName: c.from?.name ?? null,
        authorAvatarUrl: c.from?.picture ?? null,
        isOwn: c.from?.isOwner === true,
        text: c.message ?? null,
        commentedAt: c.createdTime ?? null,
        likeCount: typeof c.likeCount === "number" ? c.likeCount : null,
        source: "sync" as const,
      })),
    warnings: [],
  };
}

/** Las respuestas de un post de Threads. */
export async function readThreadsReplies(params: {
  token: string;
  postId: string;
  fetchImpl?: typeof fetch;
  limit?: number;
}): Promise<CommentSyncResult> {
  const url = new URL(`${THREADS_API}/${params.postId}/replies`);
  url.searchParams.set("fields", "id,text,username,timestamp,is_reply_owned_by_me,has_replies");
  url.searchParams.set("limit", String(params.limit ?? 100));
  url.searchParams.set("access_token", params.token);

  try {
    const res = await (params.fetchImpl ?? fetch)(url.toString());
    const body = (await res.json()) as {
      data?: Array<{
        id?: string;
        text?: string;
        username?: string;
        timestamp?: string;
        is_reply_owned_by_me?: boolean;
      }>;
      error?: { message?: string };
    };

    if (body.error) {
      return { comments: [], warnings: [`Respuestas de Threads: ${body.error.message ?? "error"}`] };
    }

    return {
      comments: (body.data ?? [])
        .filter((c) => Boolean(c.id))
        .map((c): IncomingComment => ({
          platform: "threads",
          externalCommentId: c.id as string,
          externalPostId: params.postId,
          authorUsername: c.username ?? null,
          isOwn: c.is_reply_owned_by_me === true,
          text: c.text ?? null,
          commentedAt: c.timestamp ?? null,
          source: "sync" as const,
        })),
      warnings: [],
    };
  } catch (err) {
    return {
      comments: [],
      warnings: [`Respuestas de Threads: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}

/**
 * Los comentarios de un video de YouTube.
 *
 * `commentThreads.list` trae el comentario de arriba de cada hilo. Las
 * respuestas anidadas no se traen: en un video con comentarios activos son
 * cientos, y lo que hace falta es saber que dijo la gente, no reconstruir
 * cada sub-hilo.
 */
export async function readYouTubeComments(params: {
  token: string;
  videoId: string;
  channelId?: string | null;
  fetchImpl?: typeof fetch;
  limit?: number;
}): Promise<CommentSyncResult> {
  const url = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("videoId", params.videoId);
  url.searchParams.set("maxResults", String(Math.min(params.limit ?? 100, 100)));
  url.searchParams.set("order", "time");

  try {
    const res = await (params.fetchImpl ?? fetch)(url.toString(), {
      headers: { Authorization: `Bearer ${params.token}` },
    });
    const body = (await res.json()) as {
      items?: Array<{
        id?: string;
        snippet?: {
          topLevelComment?: {
            id?: string;
            snippet?: {
              textOriginal?: string;
              authorDisplayName?: string;
              authorProfileImageUrl?: string;
              authorChannelId?: { value?: string };
              likeCount?: number;
              publishedAt?: string;
            };
          };
        };
      }>;
      error?: { message?: string; errors?: Array<{ reason?: string }> };
    };

    if (body.error) {
      // Un video con los comentarios desactivados no tiene nada que leer: no es
      // una falla. Antes se avisaba y la card del perfil decia que la lectura
      // de TODA la cuenta habia fallado.
      if (body.error.errors?.some((e) => e.reason === "commentsDisabled")) {
        return { comments: [], warnings: [] };
      }
      return { comments: [], warnings: [`Comentarios de YouTube: ${plainError(body.error.message) ?? "error"}`] };
    }

    return {
      comments: (body.items ?? [])
        .map((item): IncomingComment | null => {
          const top = item.snippet?.topLevelComment;
          const s = top?.snippet;
          if (!top?.id) return null;
          const authorChannel = s?.authorChannelId?.value ?? null;
          return {
            platform: "youtube",
            externalCommentId: top.id,
            externalPostId: params.videoId,
            authorExternalId: authorChannel,
            authorUsername: s?.authorDisplayName ?? null,
            authorName: s?.authorDisplayName ?? null,
            authorAvatarUrl: s?.authorProfileImageUrl ?? null,
            // El canal del video comentando su propio video: somos nosotros.
            isOwn: Boolean(params.channelId && authorChannel === params.channelId),
            text: s?.textOriginal ?? null,
            commentedAt: s?.publishedAt ?? null,
            likeCount: typeof s?.likeCount === "number" ? s.likeCount : null,
            source: "sync" as const,
          } satisfies IncomingComment;
        })
        .filter((c): c is IncomingComment => c !== null),
      warnings: [],
    };
  } catch (err) {
    return {
      comments: [],
      warnings: [`Comentarios de YouTube: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}
