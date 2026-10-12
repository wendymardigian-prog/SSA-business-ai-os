/**
 * Usuarios de redes sociales (Formularios R5): una sola normalización para el envío, el prellenado y el
 * mapeo al contacto. PURO.
 *
 * Tiene que coincidir con cómo están guardados hoy los contactos: `instagram_username` (y TikTok y X)
 * en minúsculas y sin "@" — así los busca `find_or_link_contact` y así llegaron los DMs. LinkedIn se
 * guarda como URL (`https://www.linkedin.com/in/<slug>`) porque la columna es una URL.
 */

export const SOCIAL_PLATFORMS = ["instagram", "tiktok", "x", "linkedin", "facebook", "youtube"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  x: "X",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  youtube: "YouTube",
};

/** La columna de `contacts` de cada red. */
export const SOCIAL_COLUMNS = {
  instagram: "instagram_username",
  tiktok: "tiktok_username",
  x: "twitter_username",
  linkedin: "linkedin_profile_url",
  facebook: "facebook_id",
  youtube: "youtube_channel_id",
} as const satisfies Record<SocialPlatform, string>;

/**
 * Las redes que sirven para BUSCAR a una persona. Facebook y YouTube solo se guardan: sus formatos
 * (ids numéricos, nombres de canal, `profile.php?id=`) no son confiables para decir "es la misma persona".
 */
export const SOCIAL_LOOKUP_PLATFORMS = ["instagram", "tiktok", "x", "linkedin"] as const satisfies readonly SocialPlatform[];

/** El texto que se ve pegado al input público (el prefijo). */
export const SOCIAL_PREFIX: Record<SocialPlatform, string> = {
  instagram: "@",
  tiktok: "@",
  x: "@",
  linkedin: "linkedin.com/in/",
  facebook: "@",
  youtube: "@",
};

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return typeof value === "string" && (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

export type SocialResult = { ok: true; value: string } | { ok: false; error: string };

const HOSTS: Record<SocialPlatform, string[]> = {
  instagram: ["instagram.com", "instagr.am"],
  tiktok: ["tiktok.com"],
  x: ["x.com", "twitter.com"],
  linkedin: ["linkedin.com"],
  facebook: ["facebook.com", "fb.com", "fb.me"],
  youtube: ["youtube.com", "youtu.be"],
};

const PATTERNS: Partial<Record<SocialPlatform, RegExp>> = {
  instagram: /^[a-z0-9._]{1,30}$/,
  tiktok: /^[a-z0-9._]{2,24}$/,
  x: /^[a-z0-9_]{1,15}$/,
};

// Rutas de la red que NO son un perfil (una publicación, la búsqueda…).
const RESERVED: Partial<Record<SocialPlatform, string[]>> = {
  instagram: ["p", "reel", "reels", "explore", "accounts", "tv", "direct", "about", "legal"],
  x: ["home", "i", "intent", "share", "search", "hashtag", "explore", "settings", "messages", "notifications", "login", "signup"],
};

export const LINKEDIN_PROFILE_BASE = "https://www.linkedin.com/in/";

const invalid = (platform: SocialPlatform): SocialResult => ({ ok: false, error: `Ese usuario de ${SOCIAL_LABELS[platform]} no es válido` });

/** Si `raw` es (o empieza con) la dirección de una red, devuelve el host y los segmentos de la ruta. */
function parseProfileUrl(raw: string): { host: string; segments: string[] } | null {
  // Sin esquema solo es una URL si empieza con la dirección de una red Y trae ruta ("ana.perez" es un usuario, no un dominio).
  const bare = /^((?:www|m|mobile|web)\.)?([^\s/]+)\//i.exec(raw);
  const knownHost = bare ? Object.values(HOSTS).some((hosts) => hosts.includes(bare[2]!.toLowerCase())) : false;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : knownHost ? `https://${raw}` : null;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase().replace(/^(www|m|mobile|web)\./, "");
    const segments = url.pathname.split("/").filter(Boolean).map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
    return { host, segments };
  } catch {
    return null;
  }
}

/** El slug de `linkedin.com/in/<slug>` en minúsculas, o null si no es un perfil de LinkedIn. */
export function linkedinSlug(raw: string): string | null {
  const match = /\/in\/([^/?#\s]+)/i.exec(raw);
  const slug = match?.[1]?.toLowerCase();
  return slug || null;
}

/**
 * Normaliza lo que escribió la persona (`@Ana`, `ana`, `instagram.com/ana`, la URL completa del perfil) al
 * valor que se guarda en el contacto. Instagram, TikTok y X: sin "@", minúsculas y con el formato de la red.
 * LinkedIn: la URL canónica del perfil. Facebook y YouTube: solo se limpian, sin validar el formato.
 */
export function normalizeSocialHandle(platform: SocialPlatform, raw: unknown): SocialResult {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") return invalid(platform);

  const parsed = parseProfileUrl(text);
  if (parsed) {
    if (!HOSTS[platform].some((h) => parsed.host === h)) return invalid(platform);
    return fromSegments(platform, parsed.segments);
  }
  if (text.includes("/")) return invalid(platform); // algo con barras que no es de ninguna red conocida

  return fromHandle(platform, text);
}

function fromSegments(platform: SocialPlatform, segments: string[]): SocialResult {
  switch (platform) {
    case "linkedin": {
      const i = segments.findIndex((s) => s.toLowerCase() === "in");
      const slug = i >= 0 ? segments[i + 1] : undefined;
      return slug ? fromHandle(platform, slug) : invalid(platform);
    }
    case "tiktok": {
      const handle = segments.find((s) => s.startsWith("@"));
      return handle ? fromHandle(platform, handle) : invalid(platform);
    }
    case "instagram": {
      const [first, second] = segments;
      if (!first) return invalid(platform);
      if (first.toLowerCase() === "stories") return second ? fromHandle(platform, second) : invalid(platform);
      return fromHandle(platform, first);
    }
    case "youtube": {
      const [first, second] = segments;
      if (!first) return invalid(platform);
      return fromHandle(platform, ["channel", "c", "user"].includes(first.toLowerCase()) && second ? second : first);
    }
    default: {
      const [first] = segments;
      return first ? fromHandle(platform, first) : invalid(platform);
    }
  }
}

function fromHandle(platform: SocialPlatform, raw: string): SocialResult {
  const stripped = raw.replace(/^@+/, "").trim();
  if (stripped === "") return invalid(platform);

  if (platform === "linkedin") {
    const slug = stripped.toLowerCase();
    if (/\s/.test(slug) || /[/?#]/.test(slug) || slug.length > 100) return invalid(platform);
    return { ok: true, value: `${LINKEDIN_PROFILE_BASE}${slug}` };
  }
  if (platform === "facebook" || platform === "youtube") {
    const cleaned = stripped.replace(/\s+/g, "");
    return cleaned ? { ok: true, value: cleaned.slice(0, 200) } : invalid(platform);
  }

  const handle = stripped.toLowerCase();
  if (/\s/.test(handle) || (RESERVED[platform] ?? []).includes(handle)) return invalid(platform);
  const pattern = PATTERNS[platform];
  return pattern && pattern.test(handle) ? { ok: true, value: handle } : invalid(platform);
}
