/**
 * Las cuentas de cada canal, para diferenciarlas en la bandeja y en la atribucion.
 *
 * Zernio permite conectar varias cuentas de la misma red (dos Instagram, por ejemplo) y cada una es una fila de
 * `channels`. La conversacion ya guarda su `channel_id`; este modulo decide como se NOMBRA cada cuenta y cuando vale
 * la pena mostrarla.
 *
 * **Se muestra la cuenta solo cuando hay mas de una de esa plataforma.** Con una sola, decir "via @marca" en cada
 * conversacion es ruido: no hay nada que diferenciar. Apenas se conecta la segunda, aparece en toda la bandeja.
 *
 * Modulo PURO: lo importan servidor, navegador y los receptores de webhooks.
 */

import { platformLabel } from "@/lib/platforms";

/** Lo minimo que se necesita de una fila de `channels`. */
export interface AccountSource {
  id: string;
  platform: string;
  username?: string | null;
  display_name?: string | null;
}

export interface InboxAccount {
  id: string;
  platform: string;
  /** Como se llama la cuenta: "@marca_principal", "ventas@dominio.com" o "WhatsApp". */
  label: string;
}

/**
 * El nombre de una cuenta. Una red con usuario se dice "@usuario"; WhatsApp y email no tienen @ y se dice por su
 * nombre (el correo, o "WhatsApp"). Sin ningun dato, el nombre de la plataforma: nunca una cadena vacia.
 */
export function accountLabel(channel: Pick<AccountSource, "platform" | "username" | "display_name">): string {
  const username = channel.username?.trim().replace(/^@+/, "") ?? "";
  const displayName = channel.display_name?.trim() ?? "";
  if (channel.platform !== "whatsapp" && channel.platform !== "email" && username) return `@${username}`;
  return displayName || (username ? `@${username}` : platformLabel(channel.platform));
}

/** Las cuentas, ordenadas por plataforma y despues por nombre. */
export function buildAccounts(channels: AccountSource[]): InboxAccount[] {
  return channels
    .map((c) => ({ id: c.id, platform: c.platform, label: accountLabel(c) }))
    .sort(
      (a, b) =>
        platformLabel(a.platform).localeCompare(platformLabel(b.platform), "es") ||
        a.label.localeCompare(b.label, "es", { sensitivity: "base" }),
    );
}

export interface AccountGroup {
  platform: string;
  platformLabel: string;
  accounts: InboxAccount[];
}

/** Las cuentas agrupadas por plataforma, en el orden en que se muestran en el menu. */
export function groupAccounts(accounts: InboxAccount[]): AccountGroup[] {
  const groups = new Map<string, AccountGroup>();
  for (const account of accounts) {
    const group = groups.get(account.platform) ?? {
      platform: account.platform,
      platformLabel: platformLabel(account.platform),
      accounts: [],
    };
    group.accounts.push(account);
    groups.set(account.platform, group);
  }
  return [...groups.values()];
}

/** Las plataformas con mas de una cuenta conectada: las unicas donde hay que decir de cual es cada conversacion. */
export function multiAccountPlatforms(accounts: InboxAccount[]): string[] {
  const counts = new Map<string, number>();
  for (const a of accounts) counts.set(a.platform, (counts.get(a.platform) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n > 1).map(([platform]) => platform);
}

/** Lo que reciben la lista, el hilo y el panel del contacto: nombres por canal y que plataformas tienen varias cuentas. */
export interface InboxAccountsInfo {
  byChannel: Record<string, string>;
  multiPlatforms: string[];
}

export function accountsInfo(accounts: InboxAccount[]): InboxAccountsInfo {
  return {
    byChannel: Object.fromEntries(accounts.map((a) => [a.id, a.label])),
    multiPlatforms: multiAccountPlatforms(accounts),
  };
}

/**
 * La cuenta a mostrar en una conversacion, o null si no hace falta (la plataforma tiene una sola cuenta, o no se
 * conoce el canal).
 */
export function accountToShow(
  info: InboxAccountsInfo | undefined,
  conversation: { channel_id?: string | null; platform: string },
): string | null {
  if (!info || !conversation.channel_id) return null;
  if (!info.multiPlatforms.includes(conversation.platform)) return null;
  return info.byChannel[conversation.channel_id] ?? null;
}

/**
 * Como se dice la cuenta en el boton del filtro y en la linea "Filtrando:".
 * Con una plataforma de varias cuentas, "Instagram @marca"; con una sola, solo "Instagram" (no hay nada que aclarar).
 */
export function accountFilterLabel(account: InboxAccount, multiPlatforms: string[]): string {
  return multiPlatforms.includes(account.platform) ? `${platformLabel(account.platform)} ${account.label}` : platformLabel(account.platform);
}

/**
 * La cuenta de un toque de atribucion, guardada en `contact_touches.raw` (`account_id`, `account_label`).
 *
 * El `id` es la clave de la cuenta en el PROVEEDOR (`channels.late_account_id`: el id de Zernio, o
 * `evolution:<instancia>` / `email:<direccion>`), no el uuid del canal: asi un comentario, que llega por la cuenta de
 * publicacion y no por un canal, apunta a la misma cuenta que un mensaje directo. El `label` queda escrito en el toque
 * (el mismo "@usuario" de la bandeja): si despues la cuenta cambia de nombre o se desconecta, el toque sigue diciendo
 * por cual cuenta entro.
 */
export interface TouchAccount {
  id: string;
  label: string;
}

export function touchAccountOf(channel: {
  late_account_id: string;
  platform: string;
  username?: string | null;
  display_name?: string | null;
}): TouchAccount {
  return { id: channel.late_account_id, label: accountLabel(channel) };
}
