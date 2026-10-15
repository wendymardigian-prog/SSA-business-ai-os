/**
 * Quién es el responsable de lo que generó una venta (F43). Puro: es la gemela en TypeScript de
 * `public.commission_content_owner(p_social_post_id, p_content_post_id, p_workspace)`; los casos de
 * `content-owner.cases.json` corren contra las dos.
 *
 *   1. si hay pieza (la directa, o la de la publicación) → `content_posts.assigned_to` (aunque sea null:
 *      una pieza sin responsable es «Sin persona», no se le busca otro dueño);
 *   2. si no hay pieza pero hay publicación → `social_posts.assigned_to`;
 *   3. si no hay nada → null.
 */

export interface ContentOwnerInput {
  /** La pieza que se pasa directo (`content_post_id`). */
  contentPost?: { assigned_to: string | null } | null;
  /** La publicación del toque (`social_post_id`), con la pieza a la que está vinculada si tiene. */
  publication?: {
    content_post?: { assigned_to: string | null } | null;
    assigned_to: string | null;
  } | null;
}

export function contentOwner(input: ContentOwnerInput): string | null {
  const piece = input.contentPost ?? input.publication?.content_post ?? null;
  if (piece) return piece.assigned_to ?? null;
  if (input.publication) return input.publication.assigned_to ?? null;
  return null;
}

/** Un caso compartido con la función SQL (`content-owner.cases.json`). */
export interface ContentOwnerCase {
  name: string;
  seed: {
    contentPost?: { assignedTo: string | null };
    socialPost?: { linkedToContentPost: boolean; assignedTo: string | null };
  };
  expected: string | null;
}

/**
 * De la siembra de un caso a la entrada de `contentOwner`. Convención (la misma que usa el SQL para
 * sembrar y llamar):
 *   - `socialPost.linkedToContentPost = true`: la publicación apunta a `contentPost` y se llama solo con
 *     `social_post_id`;
 *   - `contentPost` sin ese vínculo: se llama con `content_post_id` directo (y, si hay `socialPost`, también
 *     con su `social_post_id`: la pieza directa gana).
 */
export function contentOwnerInputFromSeed(seed: ContentOwnerCase["seed"]): ContentOwnerInput {
  const linked = !!seed.socialPost?.linkedToContentPost;
  if (linked && !seed.contentPost) throw new Error("Un caso con publicación vinculada necesita su contentPost");
  const piece = seed.contentPost ? { assigned_to: seed.contentPost.assignedTo } : null;
  return {
    contentPost: linked ? null : piece,
    publication: seed.socialPost ? { content_post: linked ? piece : null, assigned_to: seed.socialPost.assignedTo } : null,
  };
}
