/**
 * El indice de una publicacion y el de su pieza (F103).
 *
 * "1,8×" quiere decir: esta publicacion rindio casi el doble de lo normal
 * para su red y su formato. Un numero suelto ("4,2% de engagement") no dice
 * si es bueno; contra lo normal de esa cuenta si.
 *
 * Reglas que atraviesan el archivo:
 *
 * 1. **Lo normal es la MEDIANA** de las publicaciones de la misma red y el
 *    mismo formato de los 90 dias previos. La mediana y no el promedio, por
 *    la misma razon que en `follower-bump.ts`: una publicacion viral
 *    arrastraria el promedio y haria que todo lo demas parezca flojo. Es el
 *    mismo criterio (D2): dos reglas distintas para el mismo problema
 *    confunden.
 * 2. **Menos de 3 comparables = "base insuficiente".** No se muestra un
 *    indice calculado contra dos publicaciones: se muestran los numeros
 *    crudos y se dice por que.
 * 3. **Se compara el engagement a 7 dias** (`engagement_d7`), que ya es a la
 *    misma edad para todas. Una publicacion de ayer contra una de hace tres
 *    semanas, con numeros de hoy, compararia edades distintas.
 * 4. **La ventana termina el dia de la publicacion**, no hoy. Asi el indice de
 *    una publicacion no cambia cada dia que pasa, y una publicacion de hace
 *    seis meses se compara con lo que era normal ENTONCES.
 * 5. **"En curso" no es cero ni es "bajo".** Sin `engagement_d7` y con menos
 *    de 7 dias no hay numero comparable todavia, y queda fuera del promedio
 *    de la pieza.
 */

import { daysBetween } from "@/lib/metrics/rules";
import { BUMP_THRESHOLD, median } from "./follower-bump";

/** Cuantos dias previos a la publicacion se miran para saber que es lo normal. */
export const INDEX_WINDOW_DAYS = 90;

/** Menos comparables que esto y no se calcula indice. */
export const INDEX_BASE_MIN = 3;

/** Desde este indice, verde. El mismo umbral que el salto de seguidores. */
export const INDEX_HIGH = BUMP_THRESHOLD;

/** Por debajo de este indice, rojo. */
export const INDEX_LOW = 0.8;

/** A los cuantos dias se congela el engagement comparable (igual que `computeD7`). */
const D7_DAYS = 7;

/** Lo que el indice necesita saber de una publicacion. */
export interface IndexPublication {
  socialPostId: string;
  platform: string;
  mediaType: string | null;
  publishedAt: string | null;
  engagementD7: number | null;
}

export type IndexStatus = "ok" | "in_progress" | "insufficient" | "no_data";
export type IndexTone = "good" | "bad" | "neutral";

export interface PublicationIndex {
  status: IndexStatus;
  /** El indice, solo con status "ok". */
  value: number | null;
  tone: IndexTone | null;
  /** Cuantas publicaciones entraron en la comparacion. */
  comparables: number;
  /** Lo normal: la mediana del engagement a 7 dias de las comparables. */
  median: number | null;
  /** El engagement a 7 dias de esta publicacion, crudo. */
  engagement: number | null;
  /** Que decir en lugar del indice cuando no hay. */
  label: string;
}

/** `1,8×`, o un guion cuando no hay. */
export function formatIndex(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1).replace(".", ",")}×`;
}

export function toneOf(value: number): IndexTone {
  if (value >= INDEX_HIGH) return "good";
  if (value < INDEX_LOW) return "bad";
  return "neutral";
}

/**
 * El indice de UNA publicacion contra el resto de las publicaciones.
 *
 * `population` puede incluir a la propia publicacion: se la saca sola.
 */
export function publicationIndex(
  target: IndexPublication,
  population: IndexPublication[],
  now: Date,
): PublicationIndex {
  const base = {
    value: null,
    tone: null,
    comparables: 0,
    median: null,
    engagement: target.engagementD7,
  } as const;

  if (!target.publishedAt) {
    return { ...base, status: "no_data", label: "Sin dato" };
  }

  if (target.engagementD7 === null) {
    // Menos de 7 dias: todavia no hay numero comparable. Mas de 7 y sigue
    // sin: "en curso" para siempre seria mentira (la red no dio alcance, o no
    // se recolecto), asi que se dice que no hay dato.
    return daysBetween(target.publishedAt, now) < D7_DAYS
      ? { ...base, status: "in_progress", label: "En curso" }
      : { ...base, status: "no_data", label: "Sin dato" };
  }

  const targetAt = target.publishedAt;
  const peers = population.filter((peer) => {
    if (peer.socialPostId === target.socialPostId) return false;
    if (peer.platform !== target.platform) return false;
    if ((peer.mediaType ?? null) !== (target.mediaType ?? null)) return false;
    if (peer.engagementD7 === null || !peer.publishedAt) return false;
    // Los 90 dias PREVIOS: una publicacion posterior no es "lo normal de antes".
    const before = daysBetween(peer.publishedAt, targetAt);
    return before >= 0 && before <= INDEX_WINDOW_DAYS;
  });

  if (peers.length < INDEX_BASE_MIN) {
    return { ...base, status: "insufficient", comparables: peers.length, label: "Base insuficiente" };
  }

  const normal = median(peers.map((p) => p.engagementD7 as number)) as number;

  // Dividir por cero daria un indice infinito: sin una base real, no se calcula.
  if (normal <= 0) {
    return {
      ...base,
      status: "insufficient",
      comparables: peers.length,
      median: normal,
      label: "Base insuficiente",
    };
  }

  const value = Number((target.engagementD7 / normal).toFixed(2));

  return {
    status: "ok",
    value,
    tone: toneOf(value),
    comparables: peers.length,
    median: normal,
    engagement: target.engagementD7,
    label: formatIndex(value),
  };
}

export interface PieceIndex {
  /** El promedio de los indices de las publicaciones que tienen. */
  value: number | null;
  tone: IndexTone | null;
  /** Cuantas publicaciones entraron en el promedio. */
  counted: number;
  /** Cuantas publicaciones tiene la pieza. */
  total: number;
  /** Cuantas siguen en curso (fuera del promedio). */
  inProgress: number;
  label: string;
}

/**
 * El indice de la pieza: el promedio de los de sus publicaciones.
 *
 * Solo promedian las que tienen indice. Una "en curso" o con base
 * insuficiente no cuenta como cero: no se sabe, y un cero bajaria el
 * promedio de una pieza que todavia no termino de rendir.
 */
export function pieceIndex(indexes: PublicationIndex[]): PieceIndex {
  const counted = indexes.filter((i) => i.status === "ok" && i.value !== null);
  const inProgress = indexes.filter((i) => i.status === "in_progress").length;

  if (counted.length === 0) {
    const label =
      indexes.length === 0
        ? "Sin datos"
        : inProgress > 0
          ? "En curso"
          : indexes.some((i) => i.status === "insufficient")
            ? "Base insuficiente"
            : "Sin dato";
    return { value: null, tone: null, counted: 0, total: indexes.length, inProgress, label };
  }

  const average = Number(
    (counted.reduce((sum, i) => sum + (i.value as number), 0) / counted.length).toFixed(2),
  );

  return {
    value: average,
    tone: toneOf(average),
    counted: counted.length,
    total: indexes.length,
    inProgress,
    label: formatIndex(average),
  };
}
