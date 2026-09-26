/**
 * El salto de seguidores alrededor de una publicacion (F52).
 *
 * **Esto no es atribucion, y el rotulo lo dice.** Ninguna red informa
 * cuantos seguidores trajo un post. Lo que se puede saber es cuanto crecio
 * la cuenta el dia que salio y el siguiente, comparado con lo normal de esa
 * cuenta. Eso es una señal, y presentarla como "este post trajo 40
 * seguidores" seria inventar una causa.
 *
 * El calculo:
 *   sumados = seguidores netos del dia de la publicacion + el siguiente
 *   normal  = mediana diaria de las 28 jornadas anteriores × 2
 *   ratio   = sumados ÷ normal
 *
 * La mediana y no el promedio: un dia con un post viral arrastraria el
 * promedio y haria que todo lo demas parezca flojo.
 */

import { daysBetween } from "@/lib/metrics/rules";

/** Desde este ratio, el salto se considera notable. */
export const BUMP_THRESHOLD = 1.5;

/** Cuantos dias de historia se miran para saber que es lo normal. */
export const BASELINE_DAYS = 28;

/** Debajo de esta base diaria la cuenta es muy chica para un ratio. */
export const MIN_BASELINE = 3;

export interface FollowerPoint {
  date: string;
  followers: number | null;
}

export type BumpVerdict = "jump" | "normal" | "below" | "partial" | "insufficient" | "not_applicable";

export interface FollowerBump {
  /** Seguidores netos del dia y el siguiente. Null si falta un dia. */
  gained: number | null;
  /** Lo que seria normal en dos dias. */
  expected: number | null;
  ratio: number | null;
  verdict: BumpVerdict;
  /** Que decir, en palabras. */
  label: string;
  /** La serie de ±7 dias, para el grafico. */
  window: Array<{ date: string; net: number | null; highlighted: boolean }>;
  /** La mediana diaria, para la linea punteada. */
  median: number | null;
}

const NOT_APPLICABLE: FollowerBump = {
  gained: null,
  expected: null,
  ratio: null,
  verdict: "not_applicable",
  label: "LinkedIn no informa seguidores por dia.",
  window: [],
  median: null,
};

/** El neto de cada dia: la diferencia con el dia anterior. */
export function dailyNet(points: FollowerPoint[]): Map<string, number> {
  const sorted = [...points]
    .filter((p) => p.followers !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  const net = new Map<string, number>();
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    // Solo entre dias consecutivos: con un hueco en el medio, la diferencia
    // seria la de varios dias y se le atribuiria a uno solo.
    if (daysBetween(previous.date, current.date) !== 1) continue;
    net.set(current.date, (current.followers as number) - (previous.followers as number));
  }
  return net;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * El salto alrededor de una publicacion.
 *
 * `publishedDate` ya viene en la zona del workspace: quien llama la
 * convirtio, porque el modulo no sabe en que zona vive el negocio y "el dia
 * que salio" depende de eso.
 */
export function computeFollowerBump(params: {
  platform: string;
  publishedDate: string;
  points: FollowerPoint[];
  /** Hoy, en la zona del workspace. */
  today: string;
}): FollowerBump {
  if (params.platform === "linkedin") return NOT_APPLICABLE;

  const net = dailyNet(params.points);
  const dayAfter = addDays(params.publishedDate, 1);

  const window = Array.from({ length: 15 }, (_, i) => {
    const date = addDays(params.publishedDate, i - 7);
    return {
      date,
      net: net.get(date) ?? null,
      highlighted: date === params.publishedDate || date === dayAfter,
    };
  });

  const baseline: number[] = [];
  for (let i = 1; i <= BASELINE_DAYS; i += 1) {
    const value = net.get(addDays(params.publishedDate, -i));
    if (value !== undefined) baseline.push(value);
  }
  const dailyMedian = median(baseline);

  const dayValue = net.get(params.publishedDate);
  const nextValue = net.get(dayAfter);

  // El dia siguiente todavia no termino: se muestra lo que hay y se dice
  // que falta. Dar el ratio ahora lo dejaria bajo por la mitad de un dia.
  if (nextValue === undefined && dayAfter >= params.today) {
    return {
      gained: dayValue ?? null,
      expected: dailyMedian === null ? null : dailyMedian * 2,
      ratio: null,
      verdict: "partial",
      label: "El dia siguiente todavia no termino: el numero esta parcial.",
      window,
      median: dailyMedian,
    };
  }

  if (dayValue === undefined || nextValue === undefined) {
    return {
      gained: null,
      expected: dailyMedian === null ? null : dailyMedian * 2,
      ratio: null,
      verdict: "insufficient",
      label: "Faltan datos de seguidores de esos dias.",
      window,
      median: dailyMedian,
    };
  }

  const gained = dayValue + nextValue;
  const expected = dailyMedian === null ? null : dailyMedian * 2;

  // Una cuenta que gana uno o dos seguidores por dia: cualquier post
  // "multiplica por tres" y el numero no dice nada.
  if (dailyMedian === null || dailyMedian < MIN_BASELINE) {
    return {
      gained,
      expected,
      ratio: null,
      verdict: "insufficient",
      label: `${gained >= 0 ? "+" : ""}${gained} seguidores en 48 h. La cuenta todavia es chica para comparar contra lo normal.`,
      window,
      median: dailyMedian,
    };
  }

  const ratio = Number((gained / (expected as number)).toFixed(2));

  const verdict: BumpVerdict = ratio >= BUMP_THRESHOLD ? "jump" : ratio >= 0.8 ? "normal" : "below";
  const label =
    verdict === "jump"
      ? `Salto: ${gained >= 0 ? "+" : ""}${gained} seguidores en 48 h, ${ratio}× lo normal.`
      : verdict === "normal"
        ? `Dentro de lo normal: ${gained >= 0 ? "+" : ""}${gained} seguidores en 48 h.`
        : `Por debajo de lo normal: ${gained >= 0 ? "+" : ""}${gained} seguidores en 48 h.`;

  return { gained, expected, ratio, verdict, label, window, median: dailyMedian };
}

/**
 * Los otros posts de la misma red en esas 48 horas.
 *
 * Si hubo tres, el salto es de los tres juntos y de ninguno en particular.
 * Mostrarlo al lado es lo que evita que alguien concluya que el reel del
 * martes fue el que funciono.
 */
export function neighborPosts<T extends { socialPostId: string; platform: string; publishedAt: string | null }>(
  posts: T[],
  target: { socialPostId: string; platform: string; publishedDate: string },
): T[] {
  const dayAfter = addDays(target.publishedDate, 1);

  return posts.filter(
    (post) =>
      post.socialPostId !== target.socialPostId &&
      post.platform === target.platform &&
      post.publishedAt !== null &&
      (post.publishedAt.slice(0, 10) === target.publishedDate ||
        post.publishedAt.slice(0, 10) === dayAfter),
  );
}

/** La insignia de la tabla: `+40` y `1,8×`. */
export function bumpBadge(bump: FollowerBump): { value: string; ratio: string | null; good: boolean } {
  return {
    value: bump.gained === null ? "—" : `${bump.gained >= 0 ? "+" : ""}${bump.gained}`,
    ratio: bump.ratio === null ? null : `${bump.ratio.toFixed(1).replace(".", ",")}×`,
    good: bump.verdict === "jump",
  };
}
