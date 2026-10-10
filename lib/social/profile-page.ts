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
  /** Si la ultima lectura del perfil fallo (F75/F100): se sigue mostrando lo anterior. */
  warning: string | null;
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
  /** Videos (YouTube). */
  videos: number | null;
  /** El error de la ultima lectura del perfil, si fallo. */
  syncError: string | null;
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
    // Un fallo no borra lo que ya se sabia: se dice y se muestra lo ultimo.
    warning: source.syncError
      ? `La última lectura del perfil falló (${source.syncError}). Se muestran los últimos datos que se leyeron.`
      : null,
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
        { key: "posts", label: "Videos", value: source.videos ?? source.posts },
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

/**
 * Las pestañas de contenido de una red, como las tiene la red misma.
 *
 * YouTube separa "Videos" y "Shorts" en el canal, y no se miran igual: un
 * Short es vertical y un video es apaisado. En una sola grilla de 16:9 la
 * portada de un Short quedaba con franjas negras a los costados.
 */
export const CONTENT_TABS: Record<string, Array<{ value: string; label: string; ratio: string }>> = {
  youtube: [
    { value: "video", label: "Videos", ratio: "16 / 9" },
    { value: "short", label: "Shorts", ratio: "9 / 16" },
  ],
};

export function contentTabs(platform: string): Array<{ value: string; label: string; ratio: string }> {
  return CONTENT_TABS[platform] ?? [];
}

/**
 * Si una publicacion va en la pestaña. Una sin formato conocido va en la
 * primera (en YouTube, "Videos"): no puede quedar fuera de todas.
 */
export function inContentTab(platform: string, tab: string, mediaType: string | null): boolean {
  const tabs = contentTabs(platform);
  if (tabs.length === 0) return true;
  const known = tabs.some((t) => t.value === mediaType);
  return known ? mediaType === tab : tab === tabs[0].value;
}

/** La forma de la baldosa: la de la pestaña si la red las tiene, si no la de la red. */
export function tabRatio(platform: string, tab: string | null): string {
  return contentTabs(platform).find((t) => t.value === tab)?.ratio ?? gridRatio(platform);
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
  // YouTube no tiene filtro: tiene pestañas (CONTENT_TABS).
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

// ── Las cifras reales del perfil (F75, F100) ───────────────────────────────

export interface ProfileFigures {
  following: number | null;
  posts: number | null;
  videos: number | null;
  views: number | null;
  likes: number | null;
}

const FIGURE_KEYS: Array<keyof ProfileFigures> = ["following", "posts", "videos", "views", "likes"];

/**
 * Las cifras de perfil de una cuenta, de lo que guardo la lectura diaria en
 * `social_account_metrics_daily.extra.profile`.
 *
 * De cada cifra se toma la ULTIMA que se leyo: un dia mas nuevo que no la trajo
 * no la borra. Y una cifra que la red nunca dio queda en null: un cero diria
 * "no sigue a nadie", que es una afirmacion distinta y falsa. Un cero que la
 * red SI dio se conserva.
 */
export function latestProfileStats(rows: Array<{ date: string; extra: unknown }>): ProfileFigures {
  const out: ProfileFigures = { following: null, posts: null, videos: null, views: null, likes: null };

  for (const row of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    const profile = (row.extra as { profile?: unknown } | null)?.profile;
    if (!profile || typeof profile !== "object") continue;

    for (const key of FIGURE_KEYS) {
      const value = (profile as Record<string, unknown>)[key];
      if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    }
  }

  return out;
}

// ── Una pestaña por red, conectada o no (F100) ─────────────────────────────

export const SOCIAL_PLATFORMS = ["instagram", "tiktok", "youtube", "linkedin", "threads"] as const;

/**
 * Las cinco redes siempre, marcando cuales estan conectadas. Una red sin
 * conectar no desaparece del selector: muestra "Conectá tu cuenta" con el link
 * a Integraciones, que es mas claro que no saber que existe.
 */
export function networkTabs(connected: string[]): Array<{ platform: string; connected: boolean }> {
  return SOCIAL_PLATFORMS.map((platform) => ({ platform, connected: connected.includes(platform) }));
}

/** La red con la que arranca la pantalla: la primera conectada, o Instagram. */
export function defaultPlatform(connected: string[]): string {
  return SOCIAL_PLATFORMS.find((p) => connected.includes(p)) ?? "instagram";
}

// ── "Proximas" (F100) ──────────────────────────────────────────────────────

export interface UpcomingItem {
  contentPostId: string;
  title: string;
  platform: string;
  /** Cuando sale (la fecha de la cola) o cuando se planeo (la tentativa). */
  at: string;
  kind: "scheduled" | "tentative";
  format: string | null;
}

/** Los estados de una publicacion que todavia no salio pero esta en camino. */
const IN_FLIGHT = ["scheduled", "uploading", "publishing"];

/**
 * Lo que viene en una red: lo programado y lo tentativo.
 *
 *  - PROGRAMADO: hay una publicacion viva en la cola; vale la fecha de la cola.
 *  - TENTATIVO: la pieza tiene una fecha planeada para esa red y no hay nada
 *    en la cola (o la publicacion se cancelo o fallo: la fecha sigue en la pieza).
 *
 * Lo ya publicado no entra (esta en la grilla), ni una fecha tentativa que ya
 * paso, ni una red sin fecha: todavia no se sabe cuando. Van por fecha.
 */
export function buildUpcoming(params: {
  posts: Array<{
    id: string;
    title: string;
    status: string;
    format: string | null;
    networks: Array<{ platform?: string; planned_at?: string | null }>;
    archivedAt?: string | null;
  }>;
  publications: Array<{
    contentPostId: string;
    platform: string;
    status: string | null;
    scheduledAt: string | null;
  }>;
  platform: string;
  now: Date;
}): UpcomingItem[] {
  const items: UpcomingItem[] = [];

  for (const post of params.posts) {
    if (post.archivedAt) continue;

    const publication = params.publications.find(
      (p) => p.contentPostId === post.id && p.platform === params.platform,
    );

    // Ya salio: esta en la grilla.
    if (publication?.status === "published") continue;

    if (publication?.status && IN_FLIGHT.includes(publication.status) && publication.scheduledAt) {
      items.push({
        contentPostId: post.id,
        title: post.title,
        platform: params.platform,
        at: publication.scheduledAt,
        kind: "scheduled",
        format: post.format,
      });
      continue;
    }

    const planned = post.networks.find((n) => n.platform === params.platform)?.planned_at;
    if (planned && new Date(planned).getTime() > params.now.getTime()) {
      items.push({
        contentPostId: post.id,
        title: post.title,
        platform: params.platform,
        at: planned,
        kind: "tentative",
        format: post.format,
      });
    }
  }

  return items.sort((a, b) => a.at.localeCompare(b.at));
}

// ── LinkedIn como lista (F100) ─────────────────────────────────────────────

export interface LinkedinSource {
  socialPostId: string;
  contentPostId: string | null;
  caption: string | null;
  status: string | null;
  publishedAt: string | null;
  scheduledAt: string | null;
  url: string | null;
  lastError: string | null;
}

export interface LinkedinRow {
  socialPostId: string;
  contentPostId: string | null;
  title: string;
  state: string;
  tone: "ok" | "pending" | "error" | "muted";
  at: string | null;
  url: string | null;
  note: string | null;
}

const LINKEDIN_STATES: Record<string, { state: string; tone: LinkedinRow["tone"] }> = {
  published: { state: "Publicada", tone: "ok" },
  scheduled: { state: "Programada", tone: "pending" },
  uploading: { state: "Preparando", tone: "pending" },
  publishing: { state: "Publicando", tone: "pending" },
  failed: { state: "No salió", tone: "error" },
};

/**
 * La lista de LinkedIn: lo publicado DESDE EL SISTEMA con su estado. LinkedIn
 * no entrega metricas de publicaciones (sin partnership), asi que no hay grilla
 * con numeros: hay una lista honesta de lo que se mando y como le fue.
 */
export function linkedinRows(items: LinkedinSource[]): LinkedinRow[] {
  return items
    .filter((i) => i.status && i.status !== "cancelled" && LINKEDIN_STATES[i.status])
    .map((i): LinkedinRow => {
      const meta = LINKEDIN_STATES[i.status as string];
      const text = i.caption?.trim().replace(/\s+/g, " ") ?? "";
      return {
        socialPostId: i.socialPostId,
        contentPostId: i.contentPostId,
        title: text ? (text.length > 140 ? `${text.slice(0, 139)}…` : text) : "Publicación sin texto",
        state: meta.state,
        tone: meta.tone,
        at: i.publishedAt ?? i.scheduledAt,
        url: i.url,
        note: i.status === "failed" ? i.lastError : null,
      };
    })
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}
