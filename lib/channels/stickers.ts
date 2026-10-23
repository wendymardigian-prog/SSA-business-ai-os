/**
 * Que canal manda stickers (y GIFs, que salen como sticker animado).
 *
 * Es el UNICO lugar que decide esto: lo consultan el composer (el boton de
 * stickers solo aparece donde se puede), la accion que prepara el envio y la
 * ruta de mensajes (que rechaza lo que llegue igual).
 *
 *   | canal                 | stickers                                     |
 *   |-----------------------|----------------------------------------------|
 *   | WhatsApp (evolution)  | si (`/message/sendSticker`, webp o animado)  |
 *   | Instagram (zernio)    | no: el SDK de Zernio no tiene stickers       |
 *   | email (resend)        | no                                           |
 *
 * Un GIF por WhatsApp no se manda como GIF: Evolution 2.3.7 fuerza
 * `gifPlayback = false` en `sendMedia`, y llegaria como video con boton de
 * play. Por eso un GIF se guarda y se manda como sticker animado.
 *
 * Rama EXPLICITA por proveedor, nunca un `else`. Puro.
 */

export type StickerCapability = { supported: true; reason: null } | { supported: false; reason: string };

export function stickerCapability(provider: string | null | undefined): StickerCapability {
  switch (provider) {
    case "evolution":
      return { supported: true, reason: null };
    case "zernio":
      return { supported: false, reason: "Instagram no permite mandar stickers desde acá." };
    case "resend":
      return { supported: false, reason: "El email no admite stickers." };
    default:
      return { supported: false, reason: "Este canal no admite stickers." };
  }
}
