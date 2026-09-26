/**
 * Lo que muestra la pagina Social de cada red (F54).
 *
 * Cada red cuenta cosas distintas y las llama distinto. Instagram dice
 * "publicaciones, seguidores, seguidos"; YouTube, "suscriptores, videos,
 * vistas". Mostrar las mismas tres etiquetas para todas obligaria a traducir
 * mentalmente cada vez.
 *
 * Tambien cambia la forma de la grilla: un Reel es vertical y un video de
 * YouTube es apaisado. Una grilla cuadrada para las dos recorta lo que
 * importa de una y deja aire en la otra.
 */

export interface ProfileStat {
  key: string;
  label: string;
  value: number | null;
}

export interface ProfileSummary {
  platform: string;
  username: string | null;
  displayName: string | null;
  bio: string | null;
  website: string | null;
  avatarUrl: string | null;
  stats: ProfileStat[];
  /** De donde salen los datos y cuando se leyeron. */
  sourceLabel: string;
}

export interface ProfileSource {
  platform: string;
  username: string | null;
  displayName: string | null;
  bio: string | null;
  website: string | null;
  avatarUrl: string | null;
  followers: number | null;
  following: number | null;
  posts: number | null;
  /** Vistas totales (YouTube) o me gusta totales (TikTok). */
  totalOther: number | null;
  syncedAt: string | null;
}

/** De donde sale cada red, para decirlo en pantalla. */
const SOURCE_LABELS: Record<string, string> = {
  instagram: "Zernio y la Graph de Meta",
  tiktok: "Zernio",
  youtube: "la API de YouTube",
  linkedin: "LinkedIn",
  threads: "la API de Threads",
};

export function buildProfile(source: ProfileSource): ProfileSummary {
  const stats = statsFor(source);

  const when = source.syncedAt
    ? new Intl.DateTimeFormat("es-AR", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(source.syncedAt))
    : null;

  return {
    platform: source.platform,
    username: source.username,
    displayName: source.displayName,
    bio: source.bio,
    website: source.website,
    avatarUrl: source.avatarUrl,
    stats,
    sourceLabel: when
      ? `Datos de ${SOURCE_LABELS[source.platform] ?? "la red"}, leidos el ${when}.`
      : `Datos de ${SOURCE_LABELS[source.platform] ?? "la red"}. Todavia no se leyeron.`,
  };
}

/** Las cifras de cada red, con el nombre que usa esa red. */
export function statsFor(source: ProfileSource): ProfileStat[] {
  switch (source.platform) {
    case "instagram":
      return [
        { key: "posts", label: "Publicaciones", value: source.posts },
        { key: "followers", label: "Seguidores", value: source.followers },
        { key: "following", label: "Seguidos", value: source.following },
      ];
    case "tiktok":
      return [
        { key: "following", label: "Siguiendo", value: source.following },
        { key: "followers", label: "Seguidores", value: source.followers },
        { key: "likes", label: "Me gusta", value: source.totalOther },
      ];
    case "youtube":
      return [
        { key: "followers", label: "Suscriptores", value: source.followers },
        { key: "posts", label: "Videos", value: source.posts },
        { key: "views", label: "Vistas", value: source.totalOther },
      ];
    case "threads":
      return [{ key: "followers", label: "Seguidores", value: source.followers }];
    case "linkedin":
      return [{ key: "followers", label: "Seguidores", value: source.followers }];
    default:
      return [{ key: "followers", label: "Seguidores", value: source.followers }];
  }
}

/** La forma de cada baldosa de la grilla. */
export const GRID_RATIO: Record<string, string> = {
  instagram: "3 / 4",
  tiktok: "9 / 16",
  youtube: "16 / 9",
  threads: "auto",
  linkedin: "auto",
};

export function gridRatio(platform: string): string {
  return GRID_RATIO[platform] ?? "1 / 1";
}

/** Los formatos que se pueden filtrar en cada red. */
export const FORMAT_FILTERS: Record<string, Array<{ value: string; label: string }>> = {
  instagram: [
    { value: "reel", label: "Reels" },
    { value: "carousel", label: "Carruseles" },
    { value: "image", label: "Imagenes" },
    { value: "story", label: "Stories" },
  ],
  tiktok: [{ value: "video", label: "Videos" }],
  youtube: [
    { value: "video", label: "Videos" },
    { value: "short", label: "Shorts" },
  ],
  threads: [
    { value: "text", label: "Texto" },
    { value: "image", label: "Con imagen" },
  ],
  linkedin: [
    { value: "text", label: "Texto" },
    { value: "image", label: "Imagen" },
    { value: "document", label: "Documento" },
  ],
};

export function formatFilters(platform: string): Array<{ value: string; label: string }> {
  return FORMAT_FILTERS[platform] ?? [];
}

/** La tendencia de seguidores de los ultimos 30 dias, para el mini grafico. */
export function followerTrend(
  points: Array<{ date: string; followers: number | null }>,
): { series: Array<{ date: string; value: number }>; change: number | null } {
  const series = points
    .filter((p): p is { date: string; followers: number } => p.followers !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => ({ date: p.date, value: p.followers }));

  // Con un solo punto no hay tendencia: una linea de un punto no dice nada
  // y un "0%" diria que la cuenta no crecio, que no es lo que se sabe.
  if (series.length < 2) return { series, change: null };

  return { series, change: series[series.length - 1].value - series[0].value };
}
