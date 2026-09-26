/**
 * Limpieza de la media ya publicada (F23).
 *
 * Un video de 300 MB que ya salio publicado no hace falta guardarlo para
 * siempre: la red lo tiene, y el bucket es finito. Pasado el plazo del
 * workspace se borra del bucket y queda marcado en la pieza, asi el historial
 * sigue diciendo que hubo un video aunque el archivo ya no este.
 *
 * Retencion 0 = no se borra nunca. Es lo que se pone cuando el archivo
 * original es la unica copia.
 *
 * La decision es pura; borrar es del cron.
 */

import type { MediaEntry } from "./media";

export interface PostToClean {
  id: string;
  /** Cuando se publico la ultima red de la pieza. */
  publishedAt: string | null;
  media: MediaEntry[];
}

export interface CleanupPlan {
  postId: string;
  /** Rutas a borrar del bucket. */
  paths: string[];
  /** Como queda el jsonb de la pieza. */
  media: MediaEntry[];
}

/**
 * Que borrar.
 *
 * Solo de piezas publicadas y pasado el plazo. Una pieza que todavia no salio
 * conserva su media aunque sea vieja: la fecha que importa es la de
 * publicacion, no la de subida.
 */
export function planCleanup(params: {
  posts: PostToClean[];
  retentionDays: number;
  now?: Date;
}): CleanupPlan[] {
  if (params.retentionDays <= 0) return [];

  const now = params.now ?? new Date();
  const cutoff = now.getTime() - params.retentionDays * 24 * 60 * 60 * 1000;
  const plans: CleanupPlan[] = [];

  for (const post of params.posts) {
    if (!post.publishedAt) continue;
    const published = new Date(post.publishedAt).getTime();
    if (Number.isNaN(published) || published > cutoff) continue;

    const toDelete = post.media.filter((m) => !m.deleted_at);
    if (toDelete.length === 0) continue;

    plans.push({
      postId: post.id,
      paths: toDelete.map((m) => m.storage_path),
      media: post.media.map((m) =>
        m.deleted_at ? m : { ...m, deleted_at: now.toISOString() },
      ),
    });
  }

  return plans;
}
