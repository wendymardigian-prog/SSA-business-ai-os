/**
 * El analisis historico de un post (F51).
 *
 * Las fotos diarias de `social_post_metrics_daily` son ACUMULADAS: el dia 5
 * trae el total de los cinco dias. Lo que interesa ver es cuanto sumo cada
 * dia, que es la diferencia entre fotos consecutivas.
 *
 * El caso que define el archivo: **una foto que falta**. Entre el dia 3 y el
 * dia 6 hay una diferencia de tres dias juntos. Repartirla en partes iguales
 * inventa tres valores; atribuirsela al dia 6 inventa un pico. Se marca el
 * tramo como estimado y se reparte, que es lo menos malo, y la pantalla lo
 * dice.
 *
 * Nunca se inventa un valor negativo: una metrica acumulada que baja es un
 * dato corregido por la red, no gente que "des-vio" el video.
 */

import { daysBetween } from "@/lib/metrics/rules";

export type AnalysisMetric =
  | "views"
  | "reach"
  | "likes"
  | "comments"
  | "shares"
  | "saves"
  | "interactions";

export const ANALYSIS_METRIC_LABELS: Record<AnalysisMetric, string> = {
  views: "Vistas",
  reach: "Alcance",
  likes: "Me gusta",
  comments: "Comentarios",
  shares: "Compartidos",
  saves: "Guardados",
  interactions: "Interacciones",
};

export interface Snapshot {
  date: string;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  extra?: Record<string, unknown> | null;
}

export function metricOf(snapshot: Snapshot, metric: AnalysisMetric): number | null {
  if (metric !== "interactions") return snapshot[metric];
  const parts = [snapshot.likes, snapshot.comments, snapshot.shares, snapshot.saves].filter(
    (v): v is number => v !== null,
  );
  return parts.length > 0 ? parts.reduce((a, b) => a + b, 0) : null;
}

export interface EvolutionPoint {
  /** Dia desde la publicacion: 0, 1, 2… */
  day: number;
  date: string;
  /** Cuanto sumo ese dia. */
  added: number | null;
  /** El total hasta ese dia. */
  cumulative: number | null;
  /** El valor se repartio entre dias sin foto. */
  estimated: boolean;
}

/**
 * La evolucion desde la publicacion.
 *
 * Barras = lo nuevo de cada dia; linea = el acumulado.
 */
export function evolution(params: {
  publishedAt: string;
  snapshots: Snapshot[];
  metric: AnalysisMetric;
}): EvolutionPoint[] {
  const sorted = [...params.snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const points: EvolutionPoint[] = [];

  // El dia se cuenta entre FECHAS, no entre instantes: la foto del dia de
  // la publicacion es del mismo dia aunque el post haya salido al mediodia.
  // Comparando instantes, todo post publicado despues de las 00:00 tendria
  // su primera foto en el "dia -1".
  const publishedDate = params.publishedAt.slice(0, 10);

  let previousValue: number | null = null;
  let previousDay: number | null = null;

  for (const snapshot of sorted) {
    const value = metricOf(snapshot, params.metric);
    if (value === null) continue;

    const day = daysBetween(publishedDate, snapshot.date);
    const gap = previousDay === null ? 1 : day - previousDay;
    // Una metrica acumulada que baja es una correccion de la red, no gente
    // que se arrepintio: el dia suma cero, nunca un negativo.
    const delta = previousValue === null ? value : Math.max(0, value - previousValue);

    if (gap > 1 && previousDay !== null) {
      // Se reparte entre los dias sin foto y se marca: es la unica opcion
      // que no inventa ni un pico ni un hueco.
      const perDay = delta / gap;
      for (let i = 1; i <= gap; i += 1) {
        const at = previousDay + i;
        points.push({
          day: at,
          date: shiftDate(params.publishedAt, at),
          added: Number(perDay.toFixed(2)),
          cumulative: Number(((previousValue ?? 0) + perDay * i).toFixed(2)),
          estimated: true,
        });
      }
    } else {
      points.push({ day, date: snapshot.date, added: delta, cumulative: value, estimated: false });
    }

    previousValue = value;
    previousDay = day;
  }

  return points;
}

function shiftDate(from: string, days: number): string {
  const d = new Date(`${from.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * El promedio de los posts del mismo formato y red, a la misma edad.
 *
 * Es la linea punteada: sin ella, un post con 400 vistas al dia 3 no se sabe
 * si va bien o mal.
 */
export function benchmark(params: {
  peers: Array<{ publishedAt: string; snapshots: Snapshot[] }>;
  metric: AnalysisMetric;
  maxDay: number;
}): Array<{ day: number; value: number | null }> {
  const byDay = new Map<number, number[]>();

  for (const peer of params.peers) {
    for (const point of evolution({ ...peer, metric: params.metric })) {
      if (point.cumulative === null || point.day > params.maxDay) continue;
      const values = byDay.get(point.day) ?? [];
      values.push(point.cumulative);
      byDay.set(point.day, values);
    }
  }

  return Array.from({ length: params.maxDay + 1 }, (_, day) => {
    const values = byDay.get(day);
    return {
      day,
      value:
        values && values.length > 0
          ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
          : null,
    };
  });
}

export interface MetricCard {
  key: string;
  label: string;
  value: number | null;
  /** Por que no esta, cuando no esta. */
  note?: string;
}

/**
 * La grilla de metricas actuales.
 *
 * Las que la red no da NO aparecen en cero: aparecen con su motivo. YouTube
 * no tiene guardados, y un cero ahi diria que nadie guardo el video.
 */
export function metricCards(params: {
  platform: string;
  latest: Snapshot | null;
  engagementD7: number | null;
  daysSincePublished: number;
}): MetricCard[] {
  const s = params.latest;
  const interactions = s ? metricOf(s, "interactions") : null;
  const denominator = s ? (s.reach ?? s.views) : null;

  const cards: MetricCard[] = [
    { key: "reach", label: "Alcance", value: s?.reach ?? null },
    { key: "views", label: "Vistas", value: s?.views ?? null },
    { key: "interactions", label: "Interacciones", value: interactions },
    { key: "likes", label: "Me gusta", value: s?.likes ?? null },
    { key: "comments", label: "Comentarios", value: s?.comments ?? null },
    { key: "shares", label: "Compartidos", value: s?.shares ?? null },
  ];

  if (params.platform === "youtube") {
    cards.push({ key: "saves", label: "Guardados", value: null, note: "YouTube no informa guardados." });
  } else {
    cards.push({ key: "saves", label: "Guardados", value: s?.saves ?? null });
  }

  cards.push({
    key: "engagement",
    label: "Engagement",
    value:
      interactions !== null && denominator !== null && denominator > 0
        ? Number(((interactions / denominator) * 100).toFixed(2))
        : null,
  });

  cards.push({
    key: "engagement_d7",
    label: "Engagement a 7 dias",
    value: params.engagementD7,
    note: params.engagementD7 === null && params.daysSincePublished < 7 ? "En curso" : undefined,
  });

  return cards;
}

/**
 * Como se reparte el alcance entre seguidores y no seguidores (Instagram).
 *
 * La frase importa tanto como el numero: "70% no seguidores" no dice nada
 * solo; "alto alcance a gente nueva" es lo que alguien usa para decidir que
 * publicar la semana que viene.
 */
export function reachAudience(extra: Record<string, unknown> | null | undefined): {
  followers: number;
  nonFollowers: number;
  nonFollowerShare: number;
  label: string;
} | null {
  const followers = typeof extra?.reach_followers === "number" ? extra.reach_followers : null;
  const nonFollowers = typeof extra?.reach_non_followers === "number" ? extra.reach_non_followers : null;
  if (followers === null || nonFollowers === null) return null;

  const total = followers + nonFollowers;
  if (total === 0) return null;

  const share = Number(((nonFollowers / total) * 100).toFixed(1));

  return {
    followers,
    nonFollowers,
    nonFollowerShare: share,
    label:
      share > 60
        ? "Alto alcance a gente nueva: la mayoria de quienes lo vieron no te seguian."
        : share < 25
          ? "Casi todo el alcance fue entre quienes ya te siguen."
          : "Alcance repartido entre seguidores y gente nueva.",
  };
}

/** La edad del post, en palabras. */
export function ageLabel(publishedAt: string | null, now: Date): string {
  if (!publishedAt) return "Sin fecha";
  const days = daysBetween(publishedAt, now);
  if (days === 0) return "Hoy";
  if (days === 1) return "Ayer";
  if (days < 30) return `Hace ${days} dias`;
  const months = Math.floor(days / 30);
  return months === 1 ? "Hace un mes" : `Hace ${months} meses`;
}
