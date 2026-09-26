/**
 * El explorador de tendencias (F49).
 *
 * Una tarjeta con dos ejes: barras a la izquierda, lineas a la derecha, y
 * cualquier metrica en cada uno. Sirve para la pregunta que ningun grafico
 * fijo contesta: "¿el alcance sube cuando publico mas?".
 *
 * Toda la configuracion vive en la URL y NO en una tabla de vistas
 * guardadas. Compartir una vista es copiar un link, que es lo que la gente
 * hace igual; una tabla de vistas seria una pantalla mas de mantenimiento
 * para el mismo resultado.
 *
 * Dos cosas que el modulo se niega a hacer, y por eso estan aca y no en el
 * componente:
 *
 * 1. **Apilar porcentajes.** Sumar dos engagement rates da un numero que no
 *    significa nada. El control se deshabilita con el motivo.
 * 2. **Dibujar una serie que esa red no tiene.** LinkedIn sin alcance no
 *    dibuja una linea en cero: no dibuja.
 */

export const EXPLORER_METRICS = [
  "none",
  "followers",
  "followers_gained",
  "reach",
  "interactions",
  "engagement_rate",
  "engagement_d7",
  "saves",
  "shares",
  "comments",
  "likes",
  "posts",
  "watch_time",
] as const;

export type ExplorerMetric = (typeof EXPLORER_METRICS)[number];

export const METRIC_LABELS: Record<ExplorerMetric, string> = {
  none: "Ninguna",
  followers: "Seguidores",
  followers_gained: "Seguidores ganados",
  reach: "Alcance y vistas",
  interactions: "Interacciones",
  engagement_rate: "Engagement rate",
  engagement_d7: "Engagement a 7 dias",
  saves: "Guardados",
  shares: "Compartidos",
  comments: "Comentarios",
  likes: "Me gusta",
  posts: "Publicaciones",
  watch_time: "Tiempo visto",
};

/** Las que son un porcentaje: nunca se apilan. */
export const PERCENT_METRICS: ExplorerMetric[] = ["engagement_rate", "engagement_d7"];

/** Las que son un total acumulado: tampoco se apilan. */
export const CUMULATIVE_METRICS: ExplorerMetric[] = ["followers"];

/** Que metrica da cada red. */
export const METRICS_BY_PLATFORM: Record<string, ExplorerMetric[]> = {
  instagram: [
    "followers", "followers_gained", "reach", "interactions", "engagement_rate",
    "engagement_d7", "saves", "shares", "comments", "likes", "posts",
  ],
  tiktok: [
    "followers", "followers_gained", "reach", "interactions", "engagement_rate",
    "engagement_d7", "shares", "comments", "likes", "posts", "watch_time",
  ],
  youtube: [
    "followers", "followers_gained", "reach", "interactions", "engagement_rate",
    "engagement_d7", "shares", "comments", "likes", "posts", "watch_time",
  ],
  threads: [
    "followers", "reach", "interactions", "engagement_rate", "engagement_d7",
    "shares", "comments", "likes", "posts",
  ],
  // LinkedIn solo puede contar lo que publicamos nosotros.
  linkedin: ["posts"],
};

export function platformHasMetric(platform: string, metric: ExplorerMetric): boolean {
  if (metric === "none") return true;
  return (METRICS_BY_PLATFORM[platform] ?? []).includes(metric);
}

export type BarMode = "stacked" | "grouped";

export interface ExplorerConfig {
  bars: ExplorerMetric;
  lines: ExplorerMetric;
  platforms: string[];
  grouping: "day" | "week" | "month";
  barMode: BarMode;
  /** Puntos por publicacion bajo el eje. Solo tiene sentido en Dia. */
  markPosts: boolean;
}

export const DEFAULT_CONFIG: ExplorerConfig = {
  bars: "reach",
  lines: "engagement_rate",
  platforms: [],
  grouping: "day",
  barMode: "grouped",
  markPosts: false,
};

export interface StackDecision {
  allowed: boolean;
  reason?: string;
}

/** Si se puede apilar las barras de esa metrica. */
export function canStack(metric: ExplorerMetric): StackDecision {
  if (PERCENT_METRICS.includes(metric)) {
    return {
      allowed: false,
      reason: "Sumar porcentajes de dos redes da un numero que no significa nada.",
    };
  }
  if (CUMULATIVE_METRICS.includes(metric)) {
    return {
      allowed: false,
      reason: "Los seguidores son un total, no algo que pase cada dia: apilarlos los duplica.",
    };
  }
  return { allowed: true };
}

/** Marcar publicaciones solo tiene sentido agrupando por dia. */
export function canMarkPosts(grouping: ExplorerConfig["grouping"]): StackDecision {
  return grouping === "day"
    ? { allowed: true }
    : { allowed: false, reason: "Los puntos por publicacion solo se ven agrupando por dia." };
}

/**
 * La configuracion ya corregida.
 *
 * Es lo que se dibuja, no lo que se pidio: si alguien llega con un link que
 * pide apilar porcentajes, se dibuja lado a lado en vez de mostrar un
 * grafico sin sentido.
 */
export function normalizeConfig(config: ExplorerConfig): ExplorerConfig {
  return {
    ...config,
    barMode: canStack(config.bars).allowed ? config.barMode : "grouped",
    markPosts: config.markPosts && canMarkPosts(config.grouping).allowed,
    platforms: [...new Set(config.platforms)].sort(),
  };
}

// ── La URL ───────────────────────────────────────────────────────────────

function isMetric(value: string): value is ExplorerMetric {
  return (EXPLORER_METRICS as readonly string[]).includes(value);
}

export function parseExplorerConfig(params: URLSearchParams): ExplorerConfig {
  const bars = params.get("bars");
  const lines = params.get("lines");
  const grouping = params.get("g");
  const platforms = params.get("redes");

  return normalizeConfig({
    bars: bars && isMetric(bars) ? bars : DEFAULT_CONFIG.bars,
    lines: lines && isMetric(lines) ? lines : DEFAULT_CONFIG.lines,
    platforms: platforms ? platforms.split(",").filter(Boolean) : [],
    grouping: grouping === "week" || grouping === "month" ? grouping : "day",
    barMode: params.get("modo") === "stacked" ? "stacked" : "grouped",
    markPosts: params.get("puntos") === "1",
  });
}

/**
 * La config a parametros.
 *
 * Solo lo que se aparta del default: una URL con ocho parametros iguales a
 * los de siempre es una URL imposible de leer.
 */
export function explorerConfigToParams(config: ExplorerConfig): URLSearchParams {
  const params = new URLSearchParams();
  const normalized = normalizeConfig(config);

  if (normalized.bars !== DEFAULT_CONFIG.bars) params.set("bars", normalized.bars);
  if (normalized.lines !== DEFAULT_CONFIG.lines) params.set("lines", normalized.lines);
  if (normalized.platforms.length > 0) params.set("redes", normalized.platforms.join(","));
  if (normalized.grouping !== "day") params.set("g", normalized.grouping);
  if (normalized.barMode !== "grouped") params.set("modo", normalized.barMode);
  if (normalized.markPosts) params.set("puntos", "1");

  return params;
}

// ── Atajos ───────────────────────────────────────────────────────────────

export interface ExplorerShortcut {
  key: string;
  label: string;
  config: Pick<ExplorerConfig, "bars" | "lines">;
}

/**
 * Las combinaciones que se miran siempre.
 *
 * Existen porque armar la vista a mano son cuatro clics, y estas cuatro son
 * las preguntas que se repiten todas las semanas.
 */
export const SHORTCUTS: ExplorerShortcut[] = [
  {
    key: "reach-engagement",
    label: "Alcance y engagement",
    config: { bars: "reach", lines: "engagement_rate" },
  },
  {
    key: "growth-activity",
    label: "Seguidores ganados y publicaciones",
    config: { bars: "posts", lines: "followers_gained" },
  },
  {
    key: "interactions-d7",
    label: "Interacciones y engagement a 7 dias",
    config: { bars: "interactions", lines: "engagement_d7" },
  },
  {
    key: "followers",
    label: "Seguidores por red",
    config: { bars: "none", lines: "followers" },
  },
];

// ── Las series ───────────────────────────────────────────────────────────

export interface ExplorerSeries {
  platform: string;
  metric: ExplorerMetric;
  kind: "bar" | "line";
  points: Array<{ bucket: string; value: number | null }>;
  /** La red no da esa metrica: no se dibuja y se dice por que. */
  unavailableReason?: string;
}

/**
 * Las series a dibujar: una de barras y una de linea por red.
 *
 * `resolve` es quien sabe sacar una metrica de los datos; asi este modulo no
 * depende de la forma de las filas y se prueba solo con la tabla de
 * decisiones.
 */
export function buildSeries(params: {
  config: ExplorerConfig;
  platforms: string[];
  resolve: (platform: string, metric: ExplorerMetric) => Array<{ bucket: string; value: number | null }>;
}): ExplorerSeries[] {
  const config = normalizeConfig(params.config);
  const platforms = config.platforms.length > 0 ? config.platforms : params.platforms;
  const series: ExplorerSeries[] = [];

  for (const [metric, kind] of [
    [config.bars, "bar"],
    [config.lines, "line"],
  ] as const) {
    if (metric === "none") continue;

    for (const platform of platforms) {
      if (!platformHasMetric(platform, metric)) {
        series.push({
          platform,
          metric,
          kind,
          points: [],
          unavailableReason: `${METRIC_LABELS[metric]} no existe en ${platform}.`,
        });
        continue;
      }
      series.push({ platform, metric, kind, points: params.resolve(platform, metric) });
    }
  }

  return series;
}
