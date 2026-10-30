/**
 * Las dos pestañas de Mi cuenta. La elegida vive en `?tab=` (sin el parametro,
 * Perfil), asi "Notificaciones" del menu de usuario abre directo la suya.
 */

export const ACCOUNT_TABS = [
  { value: "perfil", label: "Perfil" },
  { value: "notificaciones", label: "Notificaciones" },
] as const;

export type AccountTab = (typeof ACCOUNT_TABS)[number]["value"];

export const ACCOUNT_PATH = "/dashboard/cuenta";

export function parseAccountTab(raw: string | string[] | null | undefined): AccountTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "notificaciones" ? "notificaciones" : "perfil";
}

export function accountTabHref(tab: AccountTab): string {
  return tab === "perfil" ? ACCOUNT_PATH : `${ACCOUNT_PATH}?tab=${tab}`;
}
