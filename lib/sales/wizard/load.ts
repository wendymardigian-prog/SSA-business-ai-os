/**
 * La configuración del asistente de venta, leída en el servidor con el cliente de QUIEN MIRA
 * (el catálogo lo puede leer cualquier miembro). La usan la lista de Ventas, la ficha del
 * contacto y el panel de la Agenda: un solo lugar, para que ofrezcan lo mismo.
 */
import type { PermissionContext } from "@/lib/auth/guards";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { workspaceMethods } from "@/lib/sales/workspace-methods";
import { localToday } from "@/lib/sales/dates";
import { buildWizardCatalog } from "./catalog";
import type { WizardConfig } from "@/components/sales/wizard/types";

export function hasSalesAllScope(ctx: Pick<PermissionContext, "role" | "scope">): boolean {
  return ctx.role === "owner" || ctx.role === "admin" || ctx.scope("sales") === "all";
}

export async function loadWizardConfig(ctx: PermissionContext): Promise<WizardConfig> {
  const { supabase, workspace, user } = ctx;
  const w = workspace as unknown as { timezone?: string; max_discount_percent?: number | null };
  const methods = workspaceMethods(workspace);

  const [products, variants, members, viewerTz] = await Promise.all([
    supabase.from("products").select("id, name, product_type, status").eq("workspace_id", workspace.id),
    supabase.from("product_variants").select("id, product_id, name, duration_type, duration_value, billing_type, billing_interval, display_order, price, archived_at").eq("workspace_id", workspace.id),
    getWorkspaceMembers(workspace.id),
    resolveViewerTimezone(workspace.timezone),
  ]);

  return {
    catalog: buildWizardCatalog(products.data ?? [], variants.data ?? []),
    members: members.map((m) => ({ id: m.userId, name: m.name })),
    enabledMethods: methods.enabledKeys,
    methods: methods.defs,
    maxDiscountPercent: w.max_discount_percent == null ? null : Number(w.max_discount_percent),
    hasAllScope: hasSalesAllScope(ctx),
    today: localToday(new Date(), w.timezone ?? "UTC"),
    // La zona con la que MIRA la persona (fechas de las agendas); la de las reglas es la del workspace.
    timeZone: viewerTz,
    currentUserId: user.id,
    canManageCatalog: ctx.can("products.manage"),
  };
}
