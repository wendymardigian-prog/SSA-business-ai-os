"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import {
  checkName,
  checkPrice,
  isProductStatus,
  isValidColor,
  nextColor,
  type TaxonomyItem,
} from "@/lib/content/taxonomy";
import {
  createProduct as createCatalogProduct,
  setProductStatus,
  setVariantPrice,
  updateProduct as updateCatalogProduct,
} from "@/lib/actions/products";

/**
 * Pilares y productos (F89). Las "ofertas" pasaron a ser productos con precio y
 * estado en la 00134 y, con Ventas (00160), viven en `products`: las acciones de
 * producto de acá abajo son atajos de `lib/actions/products.ts` (el catálogo),
 * que es quien escribe.
 *
 * Todo pide `settings.manage`, y ademas lo aplica la RLS de la 00116: la
 * pantalla decide que botones muestra, la barrera es la base.
 *
 * NO hay una accion de borrar, y no es un olvido: archivar saca el pilar del
 * selector sin tocar lo ya publicado, y la tabla no tiene policy de DELETE.
 * `lib/content/taxonomy.test.ts` falla si alguien agrega una.
 *
 * Los selectores de la idea y de la pieza ofrecen "+ Crear" al final para no
 * frenar la carga: esa accion es `createPillar` / `createProduct`, que devuelve
 * el id nuevo para que el selector lo deje elegido. Quien no tiene el permiso
 * no ve el "+ Crear" (y si llamara igual, la accion lo rechaza).
 */

const SETTINGS_PATH = "/dashboard/settings/productos";
const CONTENT_PATH = "/dashboard/content";

const NO_PERMISSION = "Solo quien puede cambiar la configuracion maneja los pilares y los productos";

export type TaxonomyResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

type Table = "content_pillars";

// Para los mensajes: "el pilar". Los productos ya no pasan por aca: viven en el
// catalogo de Ventas (`lib/actions/products.ts`).
const KIND: Record<Table, { label: string; audit: string; the: string; that: string; it: string }> = {
  content_pillars: { label: "pilar", audit: "content_pillar", the: "el", that: "ese", it: "o" },
};

async function manageContext() {
  return getPermissionAction("settings.manage");
}

/** Los nombres de todas las filas, para validar el duplicado. */
async function loadItems(
  supabase: NonNullable<Awaited<ReturnType<typeof manageContext>>>["supabase"],
  table: Table,
  workspaceId: string,
): Promise<TaxonomyItem[]> {
  const { data } = await supabase
    .from(table)
    .select("id, name, archived_at")
    .eq("workspace_id", workspaceId);
  return (data ?? []).map((row) => ({ id: row.id, name: row.name, archivedAt: row.archived_at ?? null }));
}

function uniqueViolation(error: { code?: string; message?: string }): boolean {
  return error.code === "23505" || /duplicate key|uq_content_/i.test(error.message ?? "");
}

async function create(
  table: Table,
  rawName: string,
  color?: string | null,
): Promise<TaxonomyResult<{ id: string; name: string; color: string | null }>> {
  const ctx = await manageContext();
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const { workspace, supabase, user } = ctx;

  const items = await loadItems(supabase, table, workspace.id);
  const checked = checkName(rawName, items);
  if (!checked.ok) return checked;

  const row: Record<string, unknown> = {
    workspace_id: workspace.id,
    name: checked.name,
    created_by: user.id,
  };

  let usedColor: string | null = null;
  if (table === "content_pillars") {
    if (color != null && !isValidColor(color)) return { ok: false, error: "Ese color no es valido" };
    // Sin color elegido, el siguiente libre de la paleta: asi dos pilares
    // creados de apuro no quedan del mismo color.
    const { data: taken } = await supabase
      .from("content_pillars")
      .select("color, archived_at")
      .eq("workspace_id", workspace.id);
    usedColor = color ?? nextColor((taken ?? []).filter((r) => !r.archived_at).map((r) => r.color));
    row.color = usedColor;
  }

  const { data, error } = await supabase.from(table).insert(row as never).select("id").single();

  if (error || !data) {
    // Dos personas creando el mismo nombre a la vez: la validacion de arriba
    // no lo ve, el indice unico si.
    if (error && uniqueViolation(error)) return { ok: false, error: `Ya existe "${checked.name}"` };
    console.error(`[content-taxonomy] no pude crear ${KIND[table].label}:`, error?.message);
    return { ok: false, error: `No pude crear ${KIND[table].the} ${KIND[table].label}` };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "workspace", entityId: workspace.id,
    action: "create",
    metadata: { section: KIND[table].audit, name: checked.name },
    performedBy: user.id,
  });

  revalidatePath(SETTINGS_PATH);
  revalidatePath(CONTENT_PATH);
  return { ok: true, data: { id: data.id, name: checked.name, color: usedColor } };
}

async function rename(table: Table, id: string, rawName: string): Promise<TaxonomyResult> {
  const ctx = await manageContext();
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const { workspace, supabase, user } = ctx;

  const items = await loadItems(supabase, table, workspace.id);
  if (!items.some((i) => i.id === id)) return { ok: false, error: `No encontre ${KIND[table].that} ${KIND[table].label}` };

  const checked = checkName(rawName, items, id);
  if (!checked.ok) return checked;

  const { error } = await supabase
    .from(table)
    .update({ name: checked.name })
    .eq("id", id)
    .eq("workspace_id", workspace.id);

  if (error) {
    if (uniqueViolation(error)) return { ok: false, error: `Ya existe "${checked.name}"` };
    console.error(`[content-taxonomy] no pude renombrar ${KIND[table].label}:`, error.message);
    return { ok: false, error: "No pude guardar el nombre" };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "workspace", entityId: workspace.id,
    action: "update",
    metadata: { section: KIND[table].audit, id, name: checked.name },
    performedBy: user.id,
  });

  revalidatePath(SETTINGS_PATH);
  revalidatePath(CONTENT_PATH);
  return { ok: true };
}

async function setArchived(table: Table, id: string, archived: boolean): Promise<TaxonomyResult> {
  const ctx = await manageContext();
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const { workspace, supabase, user } = ctx;

  const items = await loadItems(supabase, table, workspace.id);
  const target = items.find((i) => i.id === id);
  if (!target) return { ok: false, error: `No encontre ${KIND[table].that} ${KIND[table].label}` };

  // Restaurar vuelve a ocupar el nombre: si mientras tanto se creo otro con el
  // mismo, hay que avisar en vez de chocar con el indice unico.
  if (!archived) {
    const checked = checkName(target.name, items, id);
    if (!checked.ok) {
      return { ok: false, error: `${checked.error}. Renombra uno de los dos antes de restaurar.` };
    }
  }

  const { error } = await supabase
    .from(table)
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error(`[content-taxonomy] no pude archivar ${KIND[table].label}:`, error.message);
    return { ok: false, error: archived ? `No pude archivarl${KIND[table].it}` : `No pude restaurarl${KIND[table].it}` };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "workspace", entityId: workspace.id,
    action: "update",
    metadata: { section: KIND[table].audit, id, archived },
    performedBy: user.id,
  });

  revalidatePath(SETTINGS_PATH);
  revalidatePath(CONTENT_PATH);
  return { ok: true };
}

export async function createPillar(input: { name: string; color?: string | null }) {
  return create("content_pillars", input.name, input.color);
}

export async function renamePillar(input: { id: string; name: string }) {
  return rename("content_pillars", input.id, input.name);
}

export async function setPillarColor(input: { id: string; color: string }): Promise<TaxonomyResult> {
  const ctx = await manageContext();
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  if (!isValidColor(input.color)) return { ok: false, error: "Ese color no es valido" };

  const { error } = await ctx.supabase
    .from("content_pillars")
    .update({ color: input.color })
    .eq("id", input.id)
    .eq("workspace_id", ctx.workspace.id);

  if (error) {
    console.error("[content-taxonomy] no pude cambiar el color:", error.message);
    return { ok: false, error: "No pude cambiar el color" };
  }

  revalidatePath(SETTINGS_PATH);
  revalidatePath(CONTENT_PATH);
  return { ok: true };
}

export async function archivePillar(input: { id: string }) {
  return setArchived("content_pillars", input.id, true);
}

export async function restorePillar(input: { id: string }) {
  return setArchived("content_pillars", input.id, false);
}

// ---------------------------------------------------------------------------
// Productos (lo que se vende): atajos del catalogo de Ventas
// ---------------------------------------------------------------------------

export interface ProductData {
  id: string;
  name: string;
  priceUsd: number;
  status: "active" | "inactive" | "discontinued";
}

/**
 * Crea un producto desde Contenido. El precio (siempre en USD) es obligatorio: un
 * producto sin precio no sirve para medir que contenido empuja cuanto. Nace
 * activo, con su variante "Estandar" y ese precio.
 */
export async function createProduct(input: { name: string; priceUsd: unknown }): Promise<TaxonomyResult<ProductData>> {
  const price = checkPrice(input.priceUsd);
  if (!price.ok) return price;

  const created = await createCatalogProduct({ name: input.name, priceUsd: price.price, requirePrice: true });
  if (!created.ok) return created;

  return { ok: true, data: { id: created.data.id, name: created.data.name, priceUsd: price.price, status: "active" } };
}

/**
 * Edita un producto: nombre, precio y/o estado (lo que no viene no se toca).
 *
 *  - El estado y el archivado van juntos (CHECK de la 00159): activo = sin
 *    archivar; inactivo o discontinuado = archivado. Nunca se borra.
 *  - El PRECIO vive en la variante por defecto (la de menor orden, no archivada).
 *    Cambiarlo es inmediato y queda en el historial general (lo escribe la base).
 */
export async function updateProduct(input: {
  id: string;
  name?: string;
  priceUsd?: unknown;
  status?: unknown;
}): Promise<TaxonomyResult> {
  const ctx = await manageContext();
  if (!ctx) return { ok: false, error: NO_PERMISSION };

  // Se valida todo antes de escribir algo.
  if (input.status !== undefined && !isProductStatus(input.status)) return { ok: false, error: "Ese estado no es valido" };
  let newPrice: number | null = null;
  if (input.priceUsd !== undefined) {
    const checked = checkPrice(input.priceUsd);
    if (!checked.ok) return checked;
    newPrice = checked.price;
  }

  if (input.name !== undefined) {
    const renamed = await updateCatalogProduct({ id: input.id, name: input.name });
    if (!renamed.ok) return renamed;
  }

  if (newPrice !== null) {
    const { data: variants } = await ctx.supabase
      .from("product_variants")
      .select("id, display_order, archived_at")
      .eq("product_id", input.id)
      .eq("workspace_id", ctx.workspace.id);
    const live = (variants ?? []).filter((v) => !v.archived_at).sort((a, b) => a.display_order - b.display_order);
    const target = live[0];
    if (!target) return { ok: false, error: "Ese producto no tiene una variante para cambiarle el precio" };

    const priced = await setVariantPrice({ variantId: target.id, priceUsd: newPrice });
    if (!priced.ok) return priced;
  }

  if (input.status !== undefined) {
    const changed = await setProductStatus({ id: input.id, status: input.status });
    if (!changed.ok) return changed;
  }

  revalidatePath(SETTINGS_PATH);
  revalidatePath(CONTENT_PATH);
  return { ok: true };
}
