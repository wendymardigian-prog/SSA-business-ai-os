// @plantilla-quitar(servicios)
/**
 * La columna «Servicio» de Ventas (F95), armada para el punto de extensión de `lib/sales/module-columns.ts`. Solo
 * servidor. Con el módulo apagado (o sin `services.view`) no hay columna.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModuleColumn } from "@/lib/sales/module-columns";
import { loadSaleServices } from "./load-services";
import { salesServiceCell } from "./service";

type Db = SupabaseClient<any, any, any>;

export async function servicesSalesColumn(supabase: Db, workspaceId: string, saleIds: string[], can: (k: string) => boolean): Promise<ModuleColumn | null> {
  if (!can("services.view")) return null;
  const info = await loadSaleServices(supabase, workspaceId, saleIds);
  const cells: ModuleColumn["cells"] = {};
  for (const id of saleIds) {
    const i = info.get(id);
    const v = salesServiceCell(i ? { serviceId: i.serviceId, status: i.status, phaseName: i.phaseName, light: i.light, extendsProductName: i.extendsProductName } : null, can("services.create"));
    if (v.kind === "service") cells[id] = { label: v.label, href: v.href, tone: v.light === "red" ? "bad" : v.light === "yellow" ? "warn" : v.light === "green" ? "good" : "muted" };
    else if (v.kind === "extends") cells[id] = { label: v.label, href: v.href, tone: "muted" };
    else if (v.kind === "create") cells[id] = { label: "Crear servicio", href: `/dashboard/ventas/${id}?crearServicio=1`, tone: "action" };
  }
  return { key: "servicios", header: "Servicio", cells };
}
