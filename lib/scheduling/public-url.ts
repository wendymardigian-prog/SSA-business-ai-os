/**
 * La direccion base de las paginas publicas de agenda.
 *
 * `workspaces.scheduling_public_base_url` (dominio propio, F42) gana sobre
 * `NEXT_PUBLIC_APP_URL`. Sin barra final, para concatenar sin dudar.
 */

import { appUrl } from "@/lib/app-url";

export function publicBaseUrl(workspace: { scheduling_public_base_url?: string | null } | null | undefined): string {
  const custom = workspace?.scheduling_public_base_url?.trim();
  if (custom && /^https?:\/\//i.test(custom)) return custom.replace(/\/$/, "");
  return appUrl();
}

/** El link publico de un evento: <base>/calendario/<usuario>/<slug>. */
export function eventPublicUrl(base: string, username: string, slug: string): string {
  return `${base.replace(/\/$/, "")}/calendario/${username}/${slug}`;
}

/** El link para gestionar una agenda: <base>/calendario/agenda/<uid>. */
export function bookingPublicUrl(base: string, uid: string): string {
  return `${base.replace(/\/$/, "")}/calendario/agenda/${uid}`;
}
