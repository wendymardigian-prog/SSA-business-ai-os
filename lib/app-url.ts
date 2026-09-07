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
