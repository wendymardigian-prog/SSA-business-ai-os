/**
 * Links externos del contacto: el @ de Instagram y el telefono de WhatsApp (F17).
 *
 * El bug que arregla `platformHandles`: `find(ch => ch.username)` no filtra
 * por plataforma, asi que un contacto que SOLO es de WhatsApp (sin ningun
 * canal de Instagram) mostraba `@<telefono>` en el panel -- el primer canal
 * con un `username` cargado, que para WhatsApp es el telefono (Evolution
 * manda `senderUsername: phone`).
 *
 * `getDmLink` vivia duplicada dentro de `channels-view.tsx`. Se mueve aca
 * para que el @ de Instagram y el telefono de WhatsApp (en el panel, el
 * detalle y "Canales vinculados") usen exactamente el mismo link que ya
 * usaba la pantalla de Canales, sin repetir la logica.
 *
 * Modulo PURO.
 */

import type { Platform } from "@/lib/platforms";

export interface DmLink {
  url: string | null;
  label: string;
}

/** El link de mensaje directo de un canal propio (`channels.username`), por plataforma. */
export function getDmLink(platform: Platform, username: string | null): DmLink {
  const handle = username || "";
  switch (platform) {
    case "instagram":
      return handle ? { url: `https://ig.me/m/${handle}`, label: `ig.me/m/${handle}` } : { url: null, label: "" };
    case "facebook":
      return handle ? { url: `https://m.me/${handle}`, label: `m.me/${handle}` } : { url: null, label: "" };
    case "telegram":
      return handle ? { url: `https://t.me/${handle}`, label: `t.me/${handle}` } : { url: null, label: "" };
    case "twitter":
      return handle ? { url: `https://x.com/${handle}`, label: `x.com/${handle}` } : { url: null, label: "" };
    case "reddit":
      return handle
        ? { url: `https://reddit.com/message/compose/?to=${handle}`, label: `reddit.com/.../to=${handle}` }
        : { url: null, label: "" };
    case "whatsapp": {
      // Zernio guarda el numero formateado para mostrar ("+34 902 80 82 90");
      // wa.me rechaza cualquier cosa que no sean digitos.
      const digits = handle.replace(/\D/g, "");
      return digits ? { url: `https://wa.me/${digits}`, label: `wa.me/${digits}` } : { url: null, label: "" };
    }
    default:
      return { url: null, label: "" };
  }
}

export interface ContactChannelHandle {
  platform: Platform | string;
  username: string | null;
}

export interface ContactForHandles {
  instagram_username: string | null;
  /** El telefono de WhatsApp, si el contacto lo tiene como propio. */
  whatsapp_phone?: string | null;
  phone?: string | null;
}

export interface PlatformHandles {
  /** `contacts.instagram_username` es la fuente; si falta, el canal instagram. */
  instagramUsername: string | null;
  instagramUrl: string | null;
  whatsappPhone: string | null;
  whatsappUrl: string | null;
}

/**
 * El @ de Instagram y el telefono de WhatsApp de un contacto, con sus links.
 *
 * `contacts.instagram_username` manda. Si falta, se busca el canal cuya
 * `platform` sea EXACTAMENTE `"instagram"` -- nunca "el primer canal con un
 * username", que es el bug de hoy.
 */
export function platformHandles(contact: ContactForHandles, channels: ContactChannelHandle[]): PlatformHandles {
  const instagramUsername =
    contact.instagram_username ?? channels.find((ch) => ch.platform === "instagram")?.username ?? null;
  const instagramUrl = instagramUsername ? `https://instagram.com/${instagramUsername}` : null;

  const whatsappPhone =
    contact.whatsapp_phone ?? channels.find((ch) => ch.platform === "whatsapp")?.username ?? contact.phone ?? null;
  const { url: whatsappUrl } = getDmLink("whatsapp", whatsappPhone);

  return { instagramUsername, instagramUrl, whatsappPhone, whatsappUrl };
}
