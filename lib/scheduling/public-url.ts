/**
 * La direccion base de las paginas publicas de agenda.
 *
 * Es la de todos los links publicos del negocio (`lib/public-url.ts`): su dominio propio
 * (`workspaces.scheduling_public_base_url`) o el principal de la instalacion. Sin barra final.
 */

export { publicBaseUrl } from "@/lib/public-url";

/** El link publico de un evento: <base>/calendario/<usuario>/<slug>. */
export function eventPublicUrl(base: string, username: string, slug: string): string {
  return `${base.replace(/\/$/, "")}/calendario/${username}/${slug}`;
}

/** El link para gestionar una agenda: <base>/calendario/agenda/<uid>. */
export function bookingPublicUrl(base: string, uid: string): string {
  return `${base.replace(/\/$/, "")}/calendario/agenda/${uid}`;
}
