/**
 * Versiones de un producto (plano F5): el precio y las condiciones vigentes.
 * Una versión publicada no se edita nunca: se crea otra. Reglas puras; la base
 * las repite (CHECK, índice único de la activa, trigger de protección).
 */
import { toCents } from "../money";

export type VersionStatus = "draft" | "active" | "deprecated";

export interface VersionLike {
  id: string;
  status: VersionStatus | string;
  version_number: number;
  price: number | string;
  change_notes?: string | null;
}

/** La versión activa de una variante. Dos activas es un estado imposible: lanza, no elige. */
export function resolveActiveVersion<T extends VersionLike>(versions: readonly T[]): T | null {
  const active = versions.filter((v) => v.status === "active");
  if (active.length > 1) {
    throw new Error(`La variante tiene ${active.length} versiones activas: es un estado imposible`);
  }
  return active[0] ?? null;
}

/** El número de la próxima versión de una variante. */
export function nextVersionNumber(versions: readonly Pick<VersionLike, "version_number">[]): number {
  return versions.reduce((max, v) => Math.max(max, Number(v.version_number) || 0), 0) + 1;
}

export type PriceInputCheck = { ok: true; price: number } | { ok: false; error: string };

export const MAX_VERSION_PRICE = 10_000_000;

/** Precio ≥ 0 (en USD, a dos decimales). Precio cero solo con notas del cambio. */
export function checkVersionInput(rawPrice: unknown, changeNotes: string | null | undefined): PriceInputCheck {
  const text = typeof rawPrice === "string" ? rawPrice.trim().replace(",", ".") : rawPrice;
  if (text === "" || text === null || text === undefined) return { ok: false, error: "Poné el precio en dólares" };
  const n = Number(text);
  if (!Number.isFinite(n)) return { ok: false, error: "El precio tiene que ser un número" };
  if (n < 0) return { ok: false, error: "El precio no puede ser negativo" };
  if (n > MAX_VERSION_PRICE) return { ok: false, error: "Ese precio es demasiado alto" };
  const cents = toCents(n);
  if (cents === 0 && !(changeNotes ?? "").trim()) {
    return { ok: false, error: "Un precio de cero necesita una nota que explique el cambio" };
  }
  return { ok: true, price: cents / 100 };
}

export type PublishCheck = { ok: true } | { ok: false; error: string };

/**
 * Al crear un producto sin precio todavía, la versión 1 nace en borrador con
 * precio 0 y esta nota (la base exige una nota para el precio 0). No se puede
 * publicar así: primero se carga el precio de verdad.
 */
export const PLACEHOLDER_NOTE = "Precio por definir";

export function isPlaceholderDraft(version: Pick<VersionLike, "price" | "change_notes">): boolean {
  return toCents(version.price) === 0 && (version.change_notes ?? "").trim() === PLACEHOLDER_NOTE;
}

/** Si se puede publicar este borrador. */
export function canPublish(version: VersionLike, siblings: readonly VersionLike[] = []): PublishCheck {
  if (version.status === "deprecated") return { ok: false, error: "Esa versión ya está reemplazada: creá una nueva" };
  if (version.status === "active") return { ok: false, error: "Esa versión ya está publicada" };
  if (version.status !== "draft") return { ok: false, error: "Esa versión no se puede publicar" };
  if (isPlaceholderDraft(version)) return { ok: false, error: "Cargá el precio antes de publicar" };
  const check = checkVersionInput(version.price, version.change_notes);
  if (!check.ok) return check;
  const otherDrafts = siblings.filter((s) => s.id !== version.id && s.status === "draft");
  // No es un error: la base publica solo la que se pide. Se deja como regla explícita por si se necesita avisar.
  void otherDrafts;
  return { ok: true };
}

export const PUBLISHED_VERSION_MESSAGE = "Una versión publicada no se edita: creá una nueva";

/** Un borrador se edita; lo publicado, no. */
export function canEditVersion(status: string): PublishCheck {
  return status === "draft" ? { ok: true } : { ok: false, error: PUBLISHED_VERSION_MESSAGE };
}

/** Un borrador sin ventas se borra; una publicada o con ventas, nunca. */
export function canDeleteVersion(version: Pick<VersionLike, "status">, salesCount: number): PublishCheck {
  if (version.status !== "draft") return { ok: false, error: "Una versión publicada no se borra" };
  if (salesCount > 0) return { ok: false, error: "Esa versión tiene ventas y no se borra" };
  return { ok: true };
}
