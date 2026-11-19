/**
 * URL base de la app, para armar links que se mandan por fuera del navegador
 * (emails de invitacion, avisos).
 *
 * En local es http://localhost:3000; en Railway se setea NEXT_PUBLIC_APP_URL.
 * Se normaliza sin barra final para poder concatenar rutas sin dudar.
 */
export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
}

export function inviteUrl(inviteId: string): string {
  return `${appUrl()}/invite/${inviteId}`;
}

/**
 * La direccion absoluta de una ruta interna de la app, para redirigir desde el servidor. Siempre con `appUrl()`, nunca
 * con el host del pedido: detras de Railway `request.url` es `http://localhost:8080/...` y el navegador terminaria en
 * una pagina que no existe. Solo acepta rutas que empiezan con «/» (y no «//» ni «/\»); cualquier otra cosa va a la entrada.
 */
export function appRedirectUrl(pathWithQuery: string): string {
  const path = /^\/(?![/\\])/.test(pathWithQuery) ? pathWithQuery : "/login";
  return new URL(path, `${appUrl()}/`).toString();
}
