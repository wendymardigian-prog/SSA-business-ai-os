/**
 * Clasificacion de una idea o una pieza (F91).
 *
 * Los mismos campos en las dos: plataformas, formato, oferta, pilar, etapa del
 * embudo y referencia. En la idea son una intencion; al aprobar pasan a la
 * pieza (eso lo hace `approve_content_idea_v2` en la base, y
 * `pickInheritedClassification` es la misma regla escrita en TypeScript para
 * lo que se crea fuera de esa funcion: una pieza nueva vinculada a una idea).
 *
 * Todo puro: nada toca la base ni React.
 */

import type { FunnelStage, SocialPlatform } from "@/lib/types/database";

// ── Etapa del embudo ─────────────────────────────────────────────────────

export interface FunnelStageInfo {
  value: FunnelStage;
  label: string;
  /** Lo que va bajo el selector, para no tener que adivinar que es cada una. */
  description: string;
}

/** Lista fija en codigo: la base solo guarda el valor (CHECK de la 00116). */
export const FUNNEL_STAGES: FunnelStageInfo[] = [
  {
    value: "tofu",
    label: "Descubrimiento",
    description: "Gente que todavía no te conoce. Contenido amplio que atrae y no vende.",
  },
  {
    value: "mofu",
    label: "Consideración",
    description: "Gente que ya te sigue y está evaluando. Contenido que educa y demuestra cómo trabajás.",
  },
  {
    value: "bofu",
    label: "Decisión",
    description: "Gente lista para comprar. Contenido que cierra con prueba concreta y una oferta.",
  },
];

export function isFunnelStage(value: unknown): value is FunnelStage {
  return value === "tofu" || value === "mofu" || value === "bofu";
}

export function funnelStageInfo(value: unknown): FunnelStageInfo | null {
  return FUNNEL_STAGES.find((s) => s.value === value) ?? null;
}

// ── Plataformas ──────────────────────────────────────────────────────────

const PLATFORMS: SocialPlatform[] = ["instagram", "tiktok", "youtube", "linkedin", "threads"];

export function isContentPlatform(value: unknown): value is SocialPlatform {
  return typeof value === "string" && (PLATFORMS as string[]).includes(value);
}

// ── Normalizacion ────────────────────────────────────────────────────────

export interface Classification {
  platforms: SocialPlatform[];
  format: string | null;
  reference: string | null;
  offer_id: string | null;
  pillar_id: string | null;
  funnel_stage: FunnelStage | null;
}

const text = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

/**
 * Lleva lo que mande el navegador a lo que se puede escribir.
 *
 * Las plataformas quedan sin repetir, en el orden en que vinieron y solo las
 * cinco que existen. Lo vacio es null: asi "sin pilar" se distingue de un
 * pilar en blanco al leer la fila, y la base nunca recibe una cadena vacia
 * donde espera un uuid.
 */
export function cleanClassification(input: {
  platforms?: unknown[] | null;
  format?: string | null;
  reference?: string | null;
  offer_id?: string | null;
  pillar_id?: string | null;
  funnel_stage?: string | null;
}): Classification {
  const platforms: SocialPlatform[] = [];
  for (const p of input.platforms ?? []) {
    const clean = typeof p === "string" ? p.trim() : p;
    if (isContentPlatform(clean) && !platforms.includes(clean)) platforms.push(clean);
  }

  return {
    platforms,
    format: text(input.format),
    reference: text(input.reference),
    offer_id: text(input.offer_id),
    pillar_id: text(input.pillar_id),
    funnel_stage: isFunnelStage(input.funnel_stage) ? input.funnel_stage : null,
  };
}

export interface InheritedClassification {
  format: string | null;
  offer_id: string | null;
  pillar_id: string | null;
  funnel_stage: FunnelStage | null;
  reference: string | null;
}

/**
 * Lo que una pieza hereda de su idea (F91): formato, oferta, pilar, etapa y
 * referencia. Las plataformas no entran aca: en la pieza son sus redes, y las
 * elige quien la crea (o las trae `approve_content_idea_v2`).
 *
 * Lo que la pieza ya tiene gana: heredar nunca pisa algo que alguien eligio.
 */
export function pickInheritedClassification(
  idea:
    | {
        format?: string | null;
        reference?: string | null;
        offer_id?: string | null;
        pillar_id?: string | null;
        funnel_stage?: string | null;
      }
    | null
    | undefined,
  own: Partial<InheritedClassification> = {},
): InheritedClassification {
  const from = cleanClassification({
    format: idea?.format,
    reference: idea?.reference,
    offer_id: idea?.offer_id,
    pillar_id: idea?.pillar_id,
    funnel_stage: idea?.funnel_stage,
  });

  return {
    format: own.format ?? from.format,
    offer_id: own.offer_id ?? from.offer_id,
    pillar_id: own.pillar_id ?? from.pillar_id,
    funnel_stage: own.funnel_stage ?? from.funnel_stage,
    reference: own.reference ?? from.reference,
  };
}

// ── Autor y fechas ───────────────────────────────────────────────────────

function shortDate(iso: string | null | undefined, timeZone: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone })
    .format(date)
    .replace(".", "");
}

/**
 * "Ana · creada el 3 oct · editada el 5 oct" (F91).
 *
 * El dia se cuenta en la zona del negocio y no en UTC: una pieza creada a las
 * 8 de la noche en Costa Rica ya es del dia siguiente en UTC, y mostrar la
 * fecha equivocada es peor que no mostrarla. La edicion no se repite si fue
 * el mismo dia que la creacion.
 */
export function authorshipLine(input: {
  authorName: string | null | undefined;
  createdAt: string | null | undefined;
  updatedAt: string | null | undefined;
  timeZone: string;
}): string | null {
  const created = shortDate(input.createdAt, input.timeZone);
  const edited = shortDate(input.updatedAt, input.timeZone);
  const author = input.authorName?.trim() || null;

  const parts: string[] = [];
  if (author) parts.push(author);
  if (created) parts.push(`${author ? "creada" : "Creada"} el ${created}`);
  if (edited && edited !== created && created) parts.push(`editada el ${edited}`);

  return parts.length > 0 ? parts.join(" · ") : null;
}
