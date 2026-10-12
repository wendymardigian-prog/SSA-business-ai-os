/** El resultado de una Server Action del catálogo: nunca lanza, siempre dice qué pasó. */
export type CatalogResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };
