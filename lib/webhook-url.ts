/**
 * URL publica a la que los proveedores mandan sus webhooks.
 *
 * Los dos receptores viven en la app (app/api/webhooks/), que es donde corre el
 * motor de flows. Hubo un tiempo en que apuntaban a una Edge Function de
 * Supabase, porque la app corria en localhost y no era alcanzable desde
 * internet; con la app publicada en Railway eso dejo de hacer falta.
 */

import { appUrl } from "@/lib/app-url";

export type WebhookChannel = "evolution" | "zernio";

/** La ruta que atiende cada proveedor. */
const WEBHOOK_PATHS: Record<WebhookChannel, string> = {
  // "late" es el nombre historico de Zernio y quedo en la ruta: cambiarlo
  // obligaria a reconfigurar el webhook en Zernio sin ganar nada.
  zernio: "/api/webhooks/late",
  evolution: "/api/webhooks/evolution",
};

/**
 * Devuelve la URL a registrar en el proveedor.
 *
 * Se niega a devolver una URL local. No es paranoia: el webhook de Zernio quedo
 * registrado en `http://localhost:3000` durante semanas y ningun DM entro nunca,
 * sin que nada avisara. Es mejor fallar al registrar que descubrirlo despues.
 */
export function channelWebhookUrl(channel: WebhookChannel): string {
  const base = appUrl();

  if (!base) {
    throw new Error(
      "No puedo armar la URL del webhook: falta NEXT_PUBLIC_APP_URL en el entorno",
    );
  }

  if (isLocalUrl(base)) {
    throw new Error(
      `No puedo registrar un webhook apuntando a "${base}": el proveedor le pega desde internet ` +
        "y una direccion local nunca le va a responder. Configura NEXT_PUBLIC_APP_URL con el " +
        "dominio publico de la app.",
    );
  }

  return `${base}${WEBHOOK_PATHS[channel]}`;
}

/** True para localhost, 127.0.0.1, ::1 y el resto de las direcciones caseras. */
export function isLocalUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }

  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  );
}

/**
 * La direccion de retorno del OAuth de un proveedor.
 *
 * Tiene que coincidir EXACTAMENTE con la que se carga en el panel del
 * proveedor, incluida la barra final (no la lleva). Se arma igual que la de
 * los webhooks y con la misma regla: se niega a devolver una direccion local,
 * porque un cliente OAuth apuntando a localhost no falla, simplemente nunca
 * vuelve a la app desplegada.
 */
export function oauthCallbackUrl(provider: string): string {
  const base = appUrl();

  if (!base) {
    throw new Error(
      "No puedo armar la direccion de retorno: falta NEXT_PUBLIC_APP_URL en el entorno",
    );
  }
  if (isLocalUrl(base)) {
    throw new Error(
      `No puedo usar "${base}" como direccion de retorno de OAuth: es local y el proveedor no puede llegar ahi`,
    );
  }

  return `${base.replace(/\/+$/, "")}/api/oauth/${provider}/callback`;
}
