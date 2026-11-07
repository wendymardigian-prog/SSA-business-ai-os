/**
 * El alcance del disparador «Palabra clave en un comentario»: en que cuenta y en que publicaciones. Puro: lo usan el
 * panel del lienzo y la pestana Comentarios.
 *
 * Antes la cuenta y las publicaciones solo se podian elegir desde la pestana Growth, que escribia en la misma tabla
 * `triggers` que el lienzo y se pisaban. Ahora viven en el nodo disparador (`channelId`, `postIds`) y publicar arma la
 * fila desde ahi (`buildDesiredTriggers`).
 */

/** Los ids de publicacion pegados a mano: separados por coma, espacio o renglon, sin repetir. */
export function parsePostIds(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const id = raw.trim();
    if (id && /^[A-Za-z0-9_:.-]{1,120}$/.test(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Agrega o saca una publicacion de la lista. */
export function togglePostId(current: string[], id: string): string[] {
  return current.includes(id) ? current.filter((p) => p !== id) : [...current, id];
}

/** Una publicacion para el selector: la primera linea del texto, recortada; sin texto, la fecha. */
export function postOptionLabel(post: { caption: string | null; published_at: string | null }, formatDate: (iso: string) => string): string {
  const firstLine = (post.caption ?? "").split("\n").find((l) => l.trim())?.trim();
  if (firstLine) return firstLine.length > 70 ? `${firstLine.slice(0, 69)}…` : firstLine;
  return post.published_at ? `Publicación del ${formatDate(post.published_at)}` : "Publicación sin texto";
}

/** El resumen que se muestra en la tarjeta del disparador y en la pestana Comentarios. */
export function scopeSummary(args: { channelName: string | null; postCount: number }): string {
  const account = args.channelName ? args.channelName : "Todas las cuentas";
  const posts = args.postCount === 0 ? "todas las publicaciones" : args.postCount === 1 ? "1 publicación" : `${args.postCount} publicaciones`;
  return `${account} · ${posts}`;
}
