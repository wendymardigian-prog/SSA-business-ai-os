"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import {
  archivedAtFor,
  checkName,
  checkPrice,
  isProductStatus,
  isValidColor,
  nextColor,
  type TaxonomyItem,
} from "@/lib/content/taxonomy";

/**
 * Pilares y productos (F89; las "ofertas" pasaron a ser productos con precio y
 * estado en la 00134, pero la tabla sigue siendo `content_offers`).
 *
 * Todo pide `settings.manage`, y ademas lo aplica la RLS de la 00116: la
 * pantalla decide que botones muestra, la barrera es la base.
 *
 * NO hay una accion de borrar, y no es un olvido: archivar saca el pilar del
 * selector sin tocar lo ya publicado, y la tabla no tiene policy de DELETE.
 * `lib/content/taxonomy.test.ts` falla si alguien agrega una.
 *
 * Los selectores de la idea y de la pieza ofrecen "+ Crear" al final para no
 * frenar la carga: esa accion es `createPillar` / `createOffer`, que devuelve
 * el id nuevo para que el selector lo deje elegido. Quien no tiene el permiso
 * no ve el "+ Crear" (y si llamara igual, la accion lo rechaza).
 */

const SETTINGS_PATH = "/dashboard/settings/productos";
const CONTENT_PATH = "/dashboard/content";

const NO_PERMISSION = "Solo quien puede cambiar la configuracion maneja los pilares y los productos";

export type TaxonomyResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

type Table = "content_pillars" | "content_offers";

// Para los mensajes: "el pilar" / "el producto". Los productos tienen sus propias
// acciones (createProduct / updateProduct, mas abajo): precio y estado no
// entran en las genericas de pilares.
const KIND: Record<Table, { label: string; audit: string; the: string; that: string; it: string }> = {
  content_pillars: { label: "pilar", audit: "content_pillar", the: "el", that: "ese", it: "o" },
  content_offers: { label: "producto", audit: "content_offer", the: "el", that: "ese", it: "o" },
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
// Productos (lo que se vende): precio y estado (00134)
// ---------------------------------------------------------------------------

export interface ProductData {
  id: string;
  name: string;
  priceUsd: number;
  status: "active" | "inactive" | "discontinued";
}

/**
 * Crea un producto. El precio (siempre en USD) es obligatorio: un producto sin
 * precio no sirve para medir que contenido empuja cuanto. Nace activo.
 */
export async function createProduct(input: { name: string; priceUsd: unknown }): Promise<TaxonomyResult<ProductData>> {
  const ctx = await manageContext();
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const { workspace, supabase, user } = ctx;

  const items = await loadItems(supabase, "content_offers", workspace.id);
  const name = checkName(input.name, items);
  if (!name.ok) return name;
  const price = checkPrice(input.priceUsd);
  if (!price.ok) return price;

  const { data, error } = await supabase
    .from("content_offers")
    .insert({
      workspace_id: workspace.id,
      name: name.name,
      price_usd: price.price,
      status: "active",
      created_by: user.id,
    } as never)
    .select("id")
    .single();

  if (error || !data) {
    if (error && uniqueViolation(error)) return { ok: false, error: `Ya existe "${name.name}"` };
    console.error("[content-taxonomy] no pude crear el producto:", error?.message);
    return { ok: false, error: "No pude crear el producto" };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "workspace", entityId: workspace.id,
    action: "create",
    metadata: { section: KIND.content_offers.audit, name: name.name, price_usd: price.price },
    performedBy: user.id,
  });

  revalidatePath(SETTINGS_PATH);
  revalidatePath(CONTENT_PATH);
  return { ok: true, data: { id: data.id, name: name.name, priceUsd: price.price, status: "active" } };
}

/**
 * Edita un producto: nombre, precio y/o estado (lo que no viene no se toca).
 *
 * El estado y el archivado van juntos (CHECK de la 00134): activo = sin
 * archivar; inactivo o discontinuado = archivado, es decir, ya no se ofrece al
 * clasificar pero lo ya clasificado lo sigue mostrando. Nunca se borra.
 * Volver a activo vuelve a ocupar el nombre: si mientras tanto se creo otro
 * activo con el mismo, se avisa en vez de chocar con el indice unico.
 */
export async function updateProduct(input: {
  id: string;
  name?: string;
  priceUsd?: unknown;
  status?: unknown;
}): Promise<TaxonomyResult> {
  const ctx = await manageContext();
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const { workspace, supabase, user } = ctx;

  const { data: before } = await supabase
    .from("content_offers")
    .select("id, name, price_usd, status, archived_at")
    .eq("id", input.id)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!before) return { ok: false, error: "No encontre ese producto" };

  const items = await loadItems(supabase, "content_offers", workspace.id);
  const patch: Record<string, unknown> = {};
  const changes: Record<string, { old: string | number | null; new: string | number | null }> = {};

  let name = before.name;
  if (input.name !== undefined) {
    const checked = checkName(input.name, items, input.id);
    if (!checked.ok) return checked;
    name = checked.name;
    if (name !== before.name) {
      patch.name = name;
      changes.name = { old: before.name, new: name };
    }
  }

  if (input.priceUsd !== undefined) {
    const price = checkPrice(input.priceUsd);
    if (!price.ok) return price;
    const old = before.price_usd === null || before.price_usd === undefined ? null : Number(before.price_usd);
    if (price.price !== old) {
      patch.price_usd = price.price;
      changes.price_usd = { old, new: price.price };
    }
  }

  if (input.status !== undefined) {
    if (!isProductStatus(input.status)) return { ok: false, error: "Ese estado no es valido" };
    if (input.status !== before.status) {
      // Volver a activo ocupa el nombre de nuevo: se valida contra los activos.
      if (input.status === "active") {
        const clash = checkName(name, items, input.id);
        if (!clash.ok) return { ok: false, error: `${clash.error}. Renombra uno de los dos antes de reactivarlo.` };
      }
      patch.status = input.status;
      patch.archived_at = archivedAtFor(input.status, before.archived_at ?? null, new Date());
      changes.status = { old: before.status, new: input.status };
    }
  }

  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase
    .from("content_offers")
    .update(patch as never)
    .eq("id", input.id)
    .eq("workspace_id", workspace.id);

  if (error) {
    if (uniqueViolation(error)) return { ok: false, error: `Ya existe "${name}"` };
    console.error("[content-taxonomy] no pude guardar el producto:", error.message);
    return { ok: false, error: "No pude guardar el producto" };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "workspace", entityId: workspace.id,
    action: "update",
    metadata: { section: KIND.content_offers.audit, id: input.id },
    changes,
    performedBy: user.id,
  });

  revalidatePath(SETTINGS_PATH);
  revalidatePath(CONTENT_PATH);
  return { ok: true };
}
