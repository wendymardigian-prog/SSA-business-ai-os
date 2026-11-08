/**
 * Guards de las pantallas del Diseñador IA (F4, §11.1).
 *
 * El plano pide que una pantalla del Diseñador IA sin el permiso responda 404
 * (no redirige como `requirePermission`): quien no ve el módulo no tiene por
 * qué saber que existe una pieza en esa dirección. Las Server Actions usan
 * `getPermissionAction(<clave>)` como el resto de la app.
 *
 * Solo servidor.
 */

import { notFound } from "next/navigation";
import { getPermissionContext, type PermissionContext } from "@/lib/auth/guards";

export type DesignerPermission = "designer.view" | "designer.edit" | "designer.publish" | "designer.generate" | "designer.manage";

/** Exige la clave del Diseñador IA en una página; sin ella, 404. */
export async function requireDesigner(key: DesignerPermission): Promise<PermissionContext> {
  let ctx: PermissionContext;
  try {
    ctx = await getPermissionContext();
  } catch {
    notFound();
  }
  if (!ctx.can(key)) notFound();
  return ctx;
}

/** Qué puede hacer la persona en el Diseñador IA (para ocultar lo que el permiso no da, nunca deshabilitarlo). */
export interface DesignerAbilities {
  view: boolean;
  edit: boolean;
  publish: boolean;
  generate: boolean;
  manage: boolean;
}

export function designerAbilities(ctx: Pick<PermissionContext, "can">): DesignerAbilities {
  return {
    view: ctx.can("designer.view"),
    edit: ctx.can("designer.edit"),
    publish: ctx.can("designer.publish"),
    generate: ctx.can("designer.generate"),
    manage: ctx.can("designer.manage"),
  };
}
