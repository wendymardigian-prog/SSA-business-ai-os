/**
 * URL publica a la que los proveedores mandan sus webhooks.
 *
 * Mientras la app corre en local no tiene URL publica, asi que el receptor es
 * la Edge Function de Supabase (supabase/functions/channel-webhook). Cuando la
 * app se deploye a Railway se puede volver a apuntar a /api/webhooks/... sin
 * tocar la base: alcanza con cambiar esta funcion y reconfigurar el webhook en
 * cada proveedor.
 */

export type WebhookChannel = "evolution" | "zernio";

export function channelWebhookUrl(channel: WebhookChannel): string {
  const base =
    process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL?.trim().replace(/\/$/, "") ||
    `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/$/, "")}/functions/v1`;

  if (!base || base === "/functions/v1") {
    throw new Error(
      "No puedo armar la URL del webhook: falta NEXT_PUBLIC_SUPABASE_URL en el entorno",
    );
  }
  return `${base}/channel-webhook/${channel}`;
}
