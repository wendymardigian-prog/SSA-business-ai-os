// @plantilla-quitar(servicios)
/**
 * El interruptor del modulo de Servicios (F97, decision 447).
 *
 * `workspaces.services_enabled` no tiene pantalla: lo prende y apaga la plataforma con
 * `app_servicio.set_module_enabled` (solo service_role). Apagado:
 *  - el grupo Servicios del menu muestra solo Afiliados (es de BAIOS);
 *  - las rutas de Clientes y Portal responden 404;
 *  - la columna Servicio de Ventas no se muestra;
 *  - las pestanas Camino del cliente, Servicio y Portal de la variante no aparecen;
 *  - el editor de automatizaciones no ofrece sus disparadores ni sus pasos (los ya guardados se siguen viendo).
 * Esta es la UNICA regla que lo decide en la pantalla.
 */

export interface ModuleFlags {
  servicesEnabled: boolean;
}

/** Que muestra la app segun el interruptor. */
export function isModuleEnabled(workspace: { services_enabled?: boolean | null } | null | undefined): boolean {
  return workspace?.services_enabled === true;
}

export type ServicesSurface = "menu.clientes" | "menu.portal" | "route.clientes" | "route.portal" | "sales.column" | "variant.tabs" | "automations";

/** Si una parte de la pantalla del modulo se muestra. Todas dependen solo del interruptor. */
export function moduleShows(surface: ServicesSurface, flags: ModuleFlags): boolean {
  switch (surface) {
    case "menu.clientes":
    case "menu.portal":
    case "route.clientes":
    case "route.portal":
    case "sales.column":
    case "variant.tabs":
    case "automations":
      return flags.servicesEnabled;
    default:
      return false;
  }
}

/** Lee el interruptor del negocio (cualquier miembro puede leer su workspace). */
export async function loadServicesEnabled(
  supabase: { from: (t: string) => unknown },
  workspaceId: string,
): Promise<boolean> {
  try {
    const query = (supabase.from("workspaces") as {
      select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { services_enabled?: boolean } | null }> } };
    })
      .select("services_enabled")
      .eq("id", workspaceId);
    const { data } = await query.maybeSingle();
    return data?.services_enabled === true;
  } catch {
    return false;
  }
}
