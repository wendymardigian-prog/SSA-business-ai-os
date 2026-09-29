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
  /** Un color propio, para el punto del selector. */
  color?: string;
  /**
   * Todavia no existe: aparece en la lista, apagado y con su pastilla. Figura
   * en el prototipo y en F14 porque saber que viene es parte de la respuesta a
   * "¿cuanto me cuesta el agente?".
   */
  comingSoon?: boolean;
}

export const DASHBOARDS: DashboardOption[] = [
  {
    key: "chat",
    label: "Chat",
    description: "Conversaciones, agente y equipo",
    href: "/dashboard/dashboards/chat",
    permission: "dashboards.chat.view",
    color: "var(--c-agent)",
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
  {
    key: "ai-spend",
    label: "Gasto de IA",
    description: "Costos del agente en el período",
    href: "/dashboard/dashboards/chat",
    permission: "dashboards.chat.view",
    comingSoon: true,
  },
];

/**
 * Los que puede abrir quien esta mirando.
 *
 * Los que todavia no existen quedan afuera: se listan aparte, apagados, asi
 * nadie hace clic en algo que no lleva a ningun lado.
 */
export function availableDashboards(can: (permission: string) => boolean): DashboardOption[] {
  return DASHBOARDS.filter((dashboard) => !dashboard.comingSoon && can(dashboard.permission));
}

/** Los que se anuncian como "Próximamente" para quien tiene su permiso. */
export function comingSoonDashboards(can: (permission: string) => boolean): DashboardOption[] {
  return DASHBOARDS.filter((dashboard) => dashboard.comingSoon && can(dashboard.permission));
}

/**
 * Cual esta abierto, a partir de la ruta.
 *
 * Los que todavia no existen no se consideran: comparten la ruta de Chat y
 * marcarian el selector con el nombre equivocado.
 */
export function activeDashboard(pathname: string | null | undefined): DashboardOption | null {
  if (!pathname) return null;
  return DASHBOARDS.find((d) => !d.comingSoon && pathname.startsWith(d.href)) ?? null;
}
