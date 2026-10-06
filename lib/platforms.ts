/**
 * The platforms ZernFlow can drive. Zernio itself connects many more (TikTok,
 * YouTube, LinkedIn, ads accounts...), but only these expose the DM inbox that
 * flows, sequences and broadcasts are built on, so account sync skips the rest.
 */
export const PLATFORMS = [
  "instagram",
  "facebook",
  "whatsapp",
  "twitter",
  "telegram",
  "bluesky",
  "reddit",
  // Etapa 2: el email es un canal mas, con su bandeja adentro de la misma
  // bandeja. Una pantalla aparte seria una segunda bandeja que revisar.
  "email",
] as const;

export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  twitter: "X / Twitter",
  telegram: "Telegram",
  bluesky: "Bluesky",
  reddit: "Reddit",
  email: "Email",
};

export function isSupportedPlatform(value: unknown): value is Platform {
  return (
    typeof value === "string" && (PLATFORMS as readonly string[]).includes(value)
  );
}

/**
 * Los nombres de las redes en las que solo se PUBLICA (Etapa 2): no tienen
 * bandeja de mensajes, asi que no estan en `PLATFORMS` (que es el CHECK de
 * `channels.platform` y no se toca). Sin esto, el nombre salia capitalizado a
 * secas: "Youtube", "Linkedin", "Tiktok".
 */
const PUBLISHING_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  threads: "Threads",
};

export function platformLabel(platform: string): string {
  if (isSupportedPlatform(platform)) return PLATFORM_LABELS[platform];
  return PUBLISHING_LABELS[platform] ?? platform.charAt(0).toUpperCase() + platform.slice(1);
}
