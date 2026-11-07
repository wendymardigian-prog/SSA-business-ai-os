/**
 * Que hace cada canal con la vista previa de un link.
 *
 * Es el UNICO lugar que lo decide. La tarjeta de la bandeja la armamos nosotros leyendo la pagina: no es la que ve la otra
 * persona, que la decide su app. Por eso el composer avisa, y el aviso no promete nada.
 *
 *   | canal                 | tarjeta en la bandeja | quien decide lo que ve la otra persona                         |
 *   |-----------------------|-----------------------|----------------------------------------------------------------|
 *   | WhatsApp (evolution)  | si                    | Evolution la arma al mandar, si puede leer la pagina           |
 *   | Zernio (Instagram…)   | si                    | cada red: el SDK no tiene ninguna opcion de preview en mensajes |
 *   | email (resend)        | no                    | no existe: el link sale como link                               |
 *
 * La rama por proveedor es EXPLICITA, nunca un `else`: un proveedor desconocido no muestra tarjeta. Puro.
 */
import { platformLabel } from "@/lib/platforms";

export interface LinkPreviewCapability {
  /** Se dibuja la tarjeta en los mensajes y en el composer. */
  card: boolean;
  /** Lo que se le aclara a quien escribe. */
  notice: string | null;
}

const NONE: LinkPreviewCapability = { card: false, notice: null };

export function linkPreviewCapability(provider: string | null | undefined, platform?: string | null): LinkPreviewCapability {
  switch (provider) {
    case "evolution":
      return { card: true, notice: "Puede verse distinto en WhatsApp." };
    case "zernio":
      return { card: true, notice: `${platform ? platformLabel(platform) : "La red"} decide si la muestra.` };
    case "resend":
      return NONE;
    default:
      return NONE;
  }
}
