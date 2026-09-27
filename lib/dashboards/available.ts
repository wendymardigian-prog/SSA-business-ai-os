/**
 * Que dashboards se pueden abrir, en un solo lugar (B3).
 *
 * Antes cada pantalla decidia por su cuenta que opciones mostrar: Chat y
 * Contenido no pasaban nada y se quedaban con el default de dos, asi que
 * **Meta Ads y Unificado eran inalcanzables**. El menu lateral tiene una
 * sola entrada, que lleva a Chat, asi que la unica forma de llegar era
 * escribir la URL.
 *
 * La disponibilidad sale del permiso y de nada mas. Una opcion que no se ve
 * es una opcion que no existe: si Meta no esta conectado, la pantalla lo
 * dice y ofrece conectarlo, que es mucho mas util que esconderla.
 *
 * Puro y sin dependencias: lo importa la barra superior, que es del
 * navegador.
 */

export interface DashboardOption {
  key: string;
  label: string;
  /** Una linea que explica que se ve ahi, como en el prototipo. */
  description: string;
  href: string;
  /** El permiso que hace falta para verlo. */
  permission: string;
}

export const DASHBOARDS: DashboardOption[] = [
  {
    key: "chat",
    label: "Chat",
    description: "Conversaciones, agente y equipo",
    href: "/dashboard/dashboards/chat",
    permission: "dashboards.chat.view",
  },
  {
    key: "content",
    label: "Contenido organico",
    description: "Alcance, seguidores y publicaciones por red",
    href: "/dashboard/dashboards/content",
    permission: "dashboards.content.view",
  },
  {
    key: "ads",
    // "Meta Ads" y no "Anuncios": es el nombre del producto y es lo que se
    // busca cuando algo no cuadra.
    label: "Meta Ads",
    description: "Gasto, leads y costo por lead",
    href: "/dashboard/dashboards/ads",
    permission: "dashboards.ads.view",
  },
  {
    key: "unified",
    label: "Unificado",
    description: "Organico y pagado juntos",
    href: "/dashboard/dashboards/unified",
    // El unificado cruza organico y pagado: quien lo ve, ve los montos.
    permission: "dashboards.ads.view",
  },
];

/** Los que puede abrir quien esta mirando. */
export function availableDashboards(can: (permission: string) => boolean): DashboardOption[] {
  return DASHBOARDS.filter((dashboard) => can(dashboard.permission));
}

/** Cual esta abierto, a partir de la ruta. */
export function activeDashboard(pathname: string | null | undefined): DashboardOption | null {
  if (!pathname) return null;
  return DASHBOARDS.find((d) => pathname.startsWith(d.href)) ?? null;
}
