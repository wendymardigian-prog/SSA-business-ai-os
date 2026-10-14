/**
 * La bandeja por canal (Equipo y roles, F20). Puro: lo usan la lista, el filtro de canal, el envío y los
 * borradores del agente.
 *
 * `inbox.<canal>.view` decide qué conversaciones de ese canal se ven; `inbox.<canal>.reply`, si se puede
 * escribir en ellas. El ALCANCE (cuáles de esas conversaciones) lo sigue aplicando la RLS.
 *
 * Un canal sin clave propia (cualquier otra plataforma) no se puede gatear por canal: lo ve y contesta
 * quien tenga la clave correspondiente en AL MENOS UN canal.
 */

export const INBOX_CHANNELS = ["instagram", "whatsapp", "email"] as const;
export type InboxChannel = (typeof INBOX_CHANNELS)[number];

export function inboxChannelOf(platform: string | null | undefined): InboxChannel | null {
  return (INBOX_CHANNELS as readonly string[]).includes(platform ?? "") ? (platform as InboxChannel) : null;
}

type Can = (key: string) => boolean;

/** Las claves de cada canal, escritas enteras (un buscador de «quien usa inbox.whatsapp.reply» tiene que encontrarlas). */
const VIEW_KEY: Record<InboxChannel, string> = {
  instagram: "inbox.instagram.view",
  whatsapp: "inbox.whatsapp.view",
  email: "inbox.email.view",
};
const REPLY_KEY: Record<InboxChannel, string> = {
  instagram: "inbox.instagram.reply",
  whatsapp: "inbox.whatsapp.reply",
  email: "inbox.email.reply",
};

/** Los canales cuyas conversaciones puede ver. */
export function visibleChannels(can: Can): InboxChannel[] {
  return INBOX_CHANNELS.filter((c) => can(VIEW_KEY[c]));
}

/** Si puede ver las conversaciones de esta plataforma. */
export function canViewPlatform(can: Can, platform: string | null | undefined): boolean {
  const channel = inboxChannelOf(platform);
  return channel ? can(VIEW_KEY[channel]) : visibleChannels(can).length > 0;
}

/** Si puede escribir en las conversaciones de esta plataforma. */
export function canReplyOn(can: Can, platform: string | null | undefined): boolean {
  const channel = inboxChannelOf(platform);
  if (channel) return can(REPLY_KEY[channel]);
  return INBOX_CHANNELS.some((c) => can(REPLY_KEY[c]));
}

/**
 * Las plataformas que se pueden pedir a la consulta de la bandeja: `null` si ve todos los canales
 * conocidos (no hace falta filtrar), o la lista de las que ve. Las plataformas sin clave propia se ven si
 * hay al menos un canal visible, así que quien ve algún canal no pierde una conversación de otra plataforma.
 */
export function platformFilterFor(can: Can, allPlatforms: string[]): string[] | null {
  const visible = allPlatforms.filter((p) => canViewPlatform(can, p));
  return visible.length === allPlatforms.length ? null : visible;
}
