/**
 * El rendimiento de una pieza, red por red (F102).
 *
 * Una pieza sale por varias redes, y cada una es una publicacion distinta con
 * su propia edad. Este modulo arma lo que muestra el drawer: una fila por
 * publicacion y una fila de total.
 *
 * Reglas del archivo:
 *
 * 1. **Se compara por EDAD, nunca por fecha de calendario.** Un Reel de hace 10
 *    dias y un Short de hace 3 no se pueden poner lado a lado con los numeros
 *    de hoy: uno tuvo 7 dias mas para acumular. Se muestra cada uno con su edad,
 *    y ademas los dos al dia de la mas joven (`atCommonAge`), que es la
 *    comparacion que si dice algo. Lo que sale de `evolution` ya es acumulado
 *    por dia desde la publicacion.
 * 2. **Nunca se inventan ceros.** Una red que no entrega una metrica deja el
 *    hueco; una que no entrega ninguna (LinkedIn) muestra su aviso.
 * 3. **Las sumas del total son contexto, no ranking.** Sumar el alcance de un
 *    Reel con las vistas de un Short no es una medida de nada: el ranking es el
 *    indice (F103).
 * 4. **Los leads del total NO son la suma de los de cada red**: una persona que
 *    comento dos publicaciones es un lead (F104), y eso solo lo sabe quien la
 *    cuenta una vez.
 *
 * Modulo PURO: recibe lo ya leido.
 */

import { daysBetween } from "@/lib/metrics/rules";
import { evolution, metricOf, type EvolutionPoint, type Snapshot } from "./post-analysis";
import {
  leadsForPublication,
  leadsTracked,
  type PieceLeads,
} from "./piece-leads";
import {
  pieceIndex,
  publicationIndex,
  type IndexPublication,
  type PieceIndex,
  type PublicationIndex,
} from "./piece-index";

/** Redes que no entregan metricas con la conexion actual, y que decir. */
export const NO_METRICS_NOTICE: Record<string, string> = {
  linkedin: "LinkedIn no entrega métricas con esta conexión.",
};

export function metricsAvailable(platform: string): boolean {
  return !(platform in NO_METRICS_NOTICE);
}

/** Una publicacion de la pieza, con sus fotos diarias. */
export interface PerformancePublication extends IndexPublication {
  snapshots: Snapshot[];
}

export interface AtCommonAge {
  reach: number | null;
  interactions: number | null;
  /** Algun dia entre fotos se repartio: el numero es una estimacion. */
  estimated: boolean;
}

export interface PerformanceRow {
  socialPostId: string;
  platform: string;
  mediaType: string | null;
  publishedAt: string;
  /** Dias desde que salio ESTA publicacion. */
  ageDays: number;
  /** Lo acumulado hasta la ultima foto. */
  reach: number | null;
  /** El alcance es en realidad vistas (la red no da alcance). */
  reachIsViews: boolean;
  interactions: number | null;
  engagementD7: number | null;
  index: PublicationIndex;
  leads: number | null;
  /** Lo que se muestra en lugar de las cifras cuando la red no las entrega. */
  notice: string | null;
  /** Lo mismo, medido al dia de la publicacion mas joven. */
  atCommonAge: AtCommonAge | null;
}

export interface PerformanceTotal {
  publications: number;
  reach: number | null;
  interactions: number | null;
  /** Promedio del engagement a 7 dias de las que ya lo tienen. */
  engagementD7: number | null;
  index: PieceIndex;
  leads: number | null;
}

export interface PiecePerformance {
  rows: PerformanceRow[];
  total: PerformanceTotal;
  /** El dia (desde la publicacion) al que se comparan todas, o null si no hay con que. */
  commonAge: number | null;
}

const sum = (values: Array<number | null>): number | null => {
  const present = values.filter((v): v is number => v !== null);
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) : null;
};

/** El alcance de una foto, o sus vistas cuando la red no da alcance. */
const withReachFallback = (snapshots: Snapshot[]): Snapshot[] =>
  snapshots.map((s) => ({ ...s, reach: s.reach ?? s.views }));

const last = (points: EvolutionPoint[]): EvolutionPoint | undefined => points[points.length - 1];

export function buildPiecePerformance(params: {
  /** Las publicaciones de la pieza. Las que no salieron se ignoran. */
  publications: PerformancePublication[];
  /** Las publicaciones contra las que se calcula "lo normal" (F103). */
  population: IndexPublication[];
  /** Los leads de la pieza (F104), o null si no se pudieron leer. */
  leads: PieceLeads | null;
  now: Date;
}): PiecePerformance {
  const published = params.publications
    .filter((p): p is PerformancePublication & { publishedAt: string } => p.publishedAt !== null)
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.platform.localeCompare(b.platform));

  // Una pasada por publicacion: la evolucion acumulada de alcance e
  // interacciones. De ahi salen el valor de hoy y el de la edad comun.
  const evolutions = new Map<string, { reach: EvolutionPoint[]; interactions: EvolutionPoint[] }>();
  for (const pub of published) {
    if (!metricsAvailable(pub.platform)) continue;
    evolutions.set(pub.socialPostId, {
      reach: evolution({
        publishedAt: pub.publishedAt,
        snapshots: withReachFallback(pub.snapshots),
        metric: "reach",
      }),
      interactions: evolution({
        publishedAt: pub.publishedAt,
        snapshots: pub.snapshots,
        metric: "interactions",
      }),
    });
  }

  // La edad comun: el ultimo dia con foto de la publicacion que menos lleva.
  // Mas alla de ese dia, las otras tendrian dias que esta no tuvo.
  const lastDays = [...evolutions.values()]
    .map((e) => last(e.reach)?.day)
    .filter((day): day is number => day !== undefined);
  const commonAge = lastDays.length >= 2 ? Math.min(...lastDays) : null;

  const rows: PerformanceRow[] = published.map((pub) => {
    const available = metricsAvailable(pub.platform);
    const evo = evolutions.get(pub.socialPostId);

    const reachPoint = evo ? last(evo.reach) : undefined;
    const interactionsPoint = evo ? last(evo.interactions) : undefined;

    const atCommon =
      evo && commonAge !== null
        ? {
            reach: evo.reach.find((p) => p.day === commonAge) ?? null,
            interactions: evo.interactions.find((p) => p.day === commonAge) ?? null,
          }
        : null;

    const index: PublicationIndex = available
      ? publicationIndex(pub, params.population, params.now)
      : {
          status: "no_data",
          value: null,
          tone: null,
          comparables: 0,
          median: null,
          engagement: null,
          label: "No entrega métricas",
        };

    return {
      socialPostId: pub.socialPostId,
      platform: pub.platform,
      mediaType: pub.mediaType,
      publishedAt: pub.publishedAt,
      ageDays: daysBetween(pub.publishedAt, params.now),
      reach: reachPoint?.cumulative != null ? Math.round(reachPoint.cumulative) : null,
      reachIsViews:
        available &&
        pub.snapshots.some((s) => s.views !== null) &&
        pub.snapshots.every((s) => s.reach === null),
      interactions:
        interactionsPoint?.cumulative != null ? Math.round(interactionsPoint.cumulative) : null,
      engagementD7: available ? pub.engagementD7 : null,
      index,
      leads: params.leads
        ? leadsForPublication(params.leads, pub.socialPostId, { tracked: leadsTracked(pub.platform) })
        : null,
      notice: available ? null : (NO_METRICS_NOTICE[pub.platform] ?? null),
      atCommonAge: atCommon
        ? {
            reach: atCommon.reach?.cumulative != null ? Math.round(atCommon.reach.cumulative) : null,
            interactions:
              atCommon.interactions?.cumulative != null
                ? Math.round(atCommon.interactions.cumulative)
                : null,
            estimated: Boolean(atCommon.reach?.estimated || atCommon.interactions?.estimated),
          }
        : null,
    };
  });

  const withMetrics = rows.filter((r) => metricsAvailable(r.platform));
  const d7 = withMetrics.map((r) => r.engagementD7).filter((v): v is number => v !== null);

  return {
    rows,
    commonAge,
    total: {
      publications: rows.length,
      reach: sum(rows.map((r) => r.reach)),
      interactions: sum(rows.map((r) => r.interactions)),
      engagementD7:
        d7.length > 0 ? Number((d7.reduce((a, b) => a + b, 0) / d7.length).toFixed(2)) : null,
      // Una red sin metricas no cuenta para "N de M": no es una publicacion
      // que todavia no rindio, es una que no se puede medir.
      index: pieceIndex(withMetrics.map((r) => r.index)),
      leads:
        params.leads && rows.some((r) => leadsTracked(r.platform)) ? params.leads.total : null,
    },
  };
}
