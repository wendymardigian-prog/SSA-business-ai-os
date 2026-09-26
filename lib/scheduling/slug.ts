// Adaptado de Cal.diy (https://github.com/calcom/cal.diy), MIT License, Copyright (c) 2020-present Cal.com, Inc.
/**
 * Slugs de eventos y usuarios (F17, F3). Adaptado de `packages/lib/slugify.ts`.
 */

/**
 * `"Llamada de Descubrimiento ñ"` → `"llamada-de-descubrimiento-n"`.
 *
 * Con `forDisplayingInput` se conserva un guión final mientras la persona
 * escribe ("test-" no se convierte en "test" a mitad de tipeo).
 */
export function slugify(str: string, forDisplayingInput = false): string {
  if (!str) return "";
  const s = str
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}\p{Zs}]+/gu, "-")
    .replace(/[\s_#]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+/g, "-")
    // Lo que no es ASCII después de quitar diacríticos (emojis, otros alfabetos) se descarta.
    .replace(/[^a-z0-9-]/g, "");
  return forDisplayingInput ? s : s.replace(/-+$/, "");
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(value: unknown, min = 1, max = 60): value is string {
  return typeof value === "string" && value.length >= min && value.length <= max && SLUG_RE.test(value);
}

/** `<slug>-copia`, o `-copia-2`, `-copia-3`… si ya existe (F17: duplicar). */
export function nextCopySlug(slug: string, existing: string[]): string {
  const taken = new Set(existing);
  const base = `${slug}-copia`;
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}
