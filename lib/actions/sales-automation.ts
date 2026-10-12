"use server";

import { getWorkspace } from "@/lib/workspace";
import { getWorkspaceMembers } from "@/lib/workspace-members";

/**
 * Las opciones de los filtros de los triggers de Ventas en el editor de flujos (plano F37):
 * productos (los que la persona ve: el catálogo lo lee cualquier miembro) y personas del equipo
 * (solo id y nombre, lo mismo que ya muestran los desplegables de setter y vendedor).
 */
export interface SalesTriggerOptions {
  products: Array<{ id: string; name: string }>;
  members: Array<{ id: string; name: string }>;
}

export async function loadSalesTriggerOptions(): Promise<SalesTriggerOptions> {
  const { workspace, supabase } = await getWorkspace();
  const [products, members] = await Promise.all([
    supabase.from("products").select("id, name").eq("workspace_id", workspace.id).order("name", { ascending: true }),
    getWorkspaceMembers(workspace.id),
  ]);
  return {
    products: (products.data ?? []).map((p) => ({ id: p.id, name: p.name })),
    members: members.map((m) => ({ id: m.userId, name: m.name })),
  };
}
