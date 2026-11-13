/**
 * Las pestañas de Mi cuenta. Conexiones (12/11/2026) trae lo que antes era «Mis conexiones» en Integraciones: el
 * Google Calendar y el Fathom propios de cada persona. La elegida vive en `?tab=` (sin el parametro,
 * Perfil), asi "Notificaciones" del menu de usuario abre directo la suya.
 */

export const ACCOUNT_TABS = [
  { value: "perfil", label: "Perfil" },
  { value: "notificaciones", label: "Notificaciones" },
  { value: "conexiones", label: "Conexiones" },
] as const;

export type AccountTab = (typeof ACCOUNT_TABS)[number]["value"];

export const ACCOUNT_PATH = "/dashboard/cuenta";

export function parseAccountTab(raw: string | string[] | null | undefined): AccountTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "notificaciones" || value === "conexiones" ? value : "perfil";
}

export function accountTabHref(tab: AccountTab): string {
  return tab === "perfil" ? ACCOUNT_PATH : `${ACCOUNT_PATH}?tab=${tab}`;
}
