"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { archivedAtFor, checkName, isProductStatus } from "@/lib/content/taxonomy";
import { normalizeProductType, productInputSchema } from "@/lib/catalog/products";
import { checkPrice } from "@/lib/catalog/price";
import { parseVariantInput } from "@/lib/catalog/variants";
import type { CatalogResult } from "@/lib/catalog/result";

/**
 * Productos y variantes (F3 a F6).
 *
 * Todo pide `products.manage` (lo repite la RLS de la 00159). El workspace sale
 * SIEMPRE de la sesion, nunca del pedido.
 *
 *  - Nada se borra: un producto pasa a inactivo o discontinuado y una variante se
 *    archiva. Lo unico que se borra es lo que se acaba de crear cuando el alta falla
 *    a la mitad, y eso va con el cliente de servicio.
 *  - El precio vive en la variante (`product_variants.price`, 00169). Cambiarlo es
 *    inmediato.
 *  - **El historial NO se escribe aca**: lo escribe la base (trigger `catalog_audit`,
 *    00170), asi que queda registrado venga el cambio de donde venga. Por eso este
 *    archivo no llama a `logAudit` (`products-audit.test.ts` lo exige): duplicaria
 *    cada fila.
 */

const SETTINGS_PATH = "/dashboard/settings/productos";
const CONTENT_PATH = "/dashboard/content";
const NOT_ALLOWED = "Solo quien puede cambiar la configuración maneja los productos";

type Ctx = NonNullable<Awaited<ReturnType<typeof getPermissionAction>>>;

async function manage(): Promise<Ctx | null> {
  return getPermissionAction("products.manage");
}

function uniqueViolation(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && (error.code === "23505" || /duplicate key|uq_products_name/i.test(error.message ?? ""));
}

function refresh(productId?: string) {
  revalidatePath(SETTINGS_PATH);
  if (productId) revalidatePath(`${SETTINGS_PATH}/${productId}`);
  revalidatePath(CONTENT_PATH);
}

async function productNames(ctx: Ctx) {
  const { data } = await ctx.supabase.from("products").select("id, name, archived_at").eq("workspace_id", ctx.workspace.id);
  return (data ?? []).map((r) => ({ id: r.id, name: r.name, archivedAt: r.archived_at ?? null }));
}

async function loadProduct(ctx: Ctx, id: string) {
  if (typeof id !== "string" || !id) return null;
  const { data } = await ctx.supabase
    .from("products")
    .select("id, name, description, product_type, status, archived_at, display_order")
    .eq("id", id)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  return data ?? null;
}

async function loadVariant(ctx: Ctx, id: string) {
  if (typeof id !== "string" || !id) return null;
  const { data } = await ctx.supabase
    .from("product_variants")
    .select("id, product_id, name, duration_type, duration_value, event_date, billing_type, billing_interval, display_order, price, archived_at")
    .eq("id", id)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  return data ?? null;
}

// ── Productos ─────────────────────────────────────────────────────────────

export interface CreatedProduct {
  id: string;
  name: string;
  variantId: string;
}

/**
 * Crea un producto con su variante "Estándar".
 *  - Sin precio: la variante nace sin precio (0) y no se puede vender hasta cargarlo.
 *    Es lo que hace "+ Nuevo producto" en Ajustes.
 *  - Con `requirePrice`: el precio es obligatorio. Es lo que hace el alta desde Contenido.
 */
export async function createProduct(input: {
  name: string;
  type?: string;
  description?: string | null;
  priceUsd?: unknown;
  requirePrice?: boolean;
}): Promise<CatalogResult<CreatedProduct>> {
  const ctx = await manage();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const parsed = productInputSchema.safeParse({ name: input.name, type: input.type, description: input.description });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos de producto inválidos" };
  const name = checkName(parsed.data.name, await productNames(ctx));
  if (!name.ok) return { ok: false, error: `Ya existe un producto con ese nombre` };

  let price = 0;
  if (input.priceUsd !== undefined && input.priceUsd !== null && String(input.priceUsd).trim() !== "") {
    const checked = checkPrice(input.priceUsd);
    if (!checked.ok) return checked;
    price = checked.price;
  } else if (input.requirePrice) {
    return { ok: false, error: "Poné el precio en dólares" };
  }

  const { data: product, error: pErr } = await ctx.supabase
    .from("products")
    .insert({
      workspace_id: ctx.workspace.id,
      name: name.name,
      product_type: parsed.data.type,
      description: parsed.data.description?.trim() || null,
      status: "active",
      created_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (pErr || !product) {
    if (uniqueViolation(pErr)) return { ok: false, error: "Ya existe un producto con ese nombre" };
    console.error("[products] no pude crear el producto:", pErr?.message);
    return { ok: false, error: "No pude crear el producto" };
  }

  const { data: variant, error: vErr } = await ctx.supabase
    .from("product_variants")
    .insert({ workspace_id: ctx.workspace.id, product_id: product.id, name: "Estándar", duration_type: "lifetime", billing_type: "one_time", price, created_by: ctx.user.id })
    .select("id")
    .single();
  if (vErr || !variant) {
    console.error("[products] no pude crear la variante:", vErr?.message);
    // Recién creado: nada lo referencia todavía. Se limpia para no dejar un producto sin variante.
    const service = await createServiceClient();
    await service.from("products").delete().eq("id", product.id);
    return { ok: false, error: "No pude crear el producto" };
  }

  refresh(product.id);
  return { ok: true, data: { id: product.id, name: name.name, variantId: variant.id } };
}

/** Nombre, tipo y descripción (lo que no viene no se toca). El estado va aparte (`setProductStatus`). */
export async function updateProduct(input: {
  id: string;
  name?: string;
  type?: string;
  description?: string | null;
}): Promise<CatalogResult> {
  const ctx = await manage();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const before = await loadProduct(ctx, input.id);
  if (!before) return { ok: false, error: "No encontré ese producto" };

  const parsed = productInputSchema.safeParse({
    name: input.name ?? before.name,
    // Un producto que todavía dice «otro» (antes de la 00264) se lee como «producto».
    type: input.type ?? normalizeProductType(before.product_type),
    description: input.description === undefined ? before.description : input.description,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos de producto inválidos" };

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== before.name) {
    const checked = checkName(parsed.data.name, await productNames(ctx), input.id);
    if (!checked.ok) return { ok: false, error: "Ya existe un producto con ese nombre" };
    patch.name = checked.name;
  }
  if (parsed.data.type !== before.product_type) patch.product_type = parsed.data.type;
  const description = parsed.data.description?.trim() || null;
  if (description !== (before.description ?? null)) patch.description = description;
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await ctx.supabase
    .from("products")
    .update({ ...patch, updated_by: ctx.user.id } as never)
    .eq("id", input.id)
    .eq("workspace_id", ctx.workspace.id);
  if (error) {
    if (uniqueViolation(error)) return { ok: false, error: "Ya existe un producto con ese nombre" };
    console.error("[products] no pude guardar el producto:", error.message);
    return { ok: false, error: "No pude guardar el producto" };
  }

  refresh(input.id);
  return { ok: true };
}

/**
 * Activo, inactivo o discontinuado. El estado y `archived_at` se escriben JUNTOS
 * (CHECK de la 00159). Volver a activo ocupa el nombre de nuevo: si mientras tanto
 * se creó otro activo con el mismo, se avisa.
 */
export async function setProductStatus(input: { id: string; status: unknown }): Promise<CatalogResult> {
  const ctx = await manage();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (!isProductStatus(input.status)) return { ok: false, error: "Ese estado no es válido" };
  const before = await loadProduct(ctx, input.id);
  if (!before) return { ok: false, error: "No encontré ese producto" };
  if (before.status === input.status) return { ok: true };

  if (input.status === "active") {
    const clash = checkName(before.name, await productNames(ctx), input.id);
    if (!clash.ok) return { ok: false, error: "Ya hay un producto activo con ese nombre. Renombrá uno de los dos antes de reactivarlo." };
  }

  const archivedAt = archivedAtFor(input.status, before.archived_at ?? null, new Date());
  const { error } = await ctx.supabase
    .from("products")
    .update({ status: input.status, archived_at: archivedAt, updated_by: ctx.user.id })
    .eq("id", input.id)
    .eq("workspace_id", ctx.workspace.id);
  if (error) {
    if (uniqueViolation(error)) return { ok: false, error: "Ya hay un producto activo con ese nombre" };
    console.error("[products] no pude cambiar el estado:", error.message);
    return { ok: false, error: "No pude cambiar el estado del producto" };
  }

  refresh(input.id);
  return { ok: true };
}

/** Atajos: archivar = pasar a inactivo; restaurar = volver a activo. */
export async function archiveProduct(id: string): Promise<CatalogResult> {
  return setProductStatus({ id, status: "inactive" });
}
export async function restoreProduct(id: string): Promise<CatalogResult> {
  return setProductStatus({ id, status: "active" });
}

// ── Variantes ─────────────────────────────────────────────────────────────

export async function createVariant(input: {
  productId: string;
  priceUsd?: unknown;
  [field: string]: unknown;
}): Promise<CatalogResult<{ id: string }>> {
  const ctx = await manage();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const product = await loadProduct(ctx, input.productId);
  if (!product) return { ok: false, error: "No encontré ese producto" };

  const parsed = parseVariantInput(input, product.product_type);
  if (!parsed.ok) return parsed;

  let price = 0;
  if (input.priceUsd !== undefined && input.priceUsd !== null && String(input.priceUsd).trim() !== "") {
    const checked = checkPrice(input.priceUsd);
    if (!checked.ok) return checked;
    price = checked.price;
  }

  const { data: siblings } = await ctx.supabase.from("product_variants").select("display_order").eq("product_id", product.id);
  const order = (siblings ?? []).reduce((max, s) => Math.max(max, Number(s.display_order) || 0), -1) + 1;

  const { data: variant, error } = await ctx.supabase
    .from("product_variants")
    .insert({ workspace_id: ctx.workspace.id, product_id: product.id, display_order: order, price, created_by: ctx.user.id, ...parsed.fields })
    .select("id")
    .single();
  if (error || !variant) {
    console.error("[products] no pude crear la variante:", error?.message);
    return { ok: false, error: "No pude crear la variante" };
  }

  refresh(product.id);
  return { ok: true, data: { id: variant.id } };
}

export async function updateVariant(input: { id: string; [field: string]: unknown }): Promise<CatalogResult> {
  const ctx = await manage();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const before = await loadVariant(ctx, input.id);
  if (!before) return { ok: false, error: "No encontré esa variante" };
  const product = await loadProduct(ctx, before.product_id);
  if (!product) return { ok: false, error: "No encontré ese producto" };

  const parsed = parseVariantInput(input, product.product_type);
  if (!parsed.ok) return parsed;

  const { error } = await ctx.supabase
    .from("product_variants")
    .update({ ...parsed.fields, updated_by: ctx.user.id })
    .eq("id", input.id)
    .eq("workspace_id", ctx.workspace.id);
  if (error) {
    console.error("[products] no pude guardar la variante:", error.message);
    return { ok: false, error: "No pude guardar la variante" };
  }

  refresh(before.product_id);
  return { ok: true };
}

export async function archiveVariant(id: string): Promise<CatalogResult> {
  return setVariantArchived(id, true);
}
export async function restoreVariant(id: string): Promise<CatalogResult> {
  return setVariantArchived(id, false);
}

async function setVariantArchived(id: string, archived: boolean): Promise<CatalogResult> {
  const ctx = await manage();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const before = await loadVariant(ctx, id);
  if (!before) return { ok: false, error: "No encontré esa variante" };
  if (!!before.archived_at === archived) return { ok: true };

  const { error } = await ctx.supabase
    .from("product_variants")
    .update({ archived_at: archived ? new Date().toISOString() : null, updated_by: ctx.user.id })
    .eq("id", id)
    .eq("workspace_id", ctx.workspace.id);
  if (error) {
    console.error("[products] no pude cambiar la variante:", error.message);
    return { ok: false, error: "No pude cambiar la variante" };
  }

  refresh(before.product_id);
  return { ok: true };
}

/** Copia una variante con su precio. Queda como "<nombre> (copia)". */
export async function duplicateVariant(id: string): Promise<CatalogResult<{ id: string }>> {
  const ctx = await manage();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const source = await loadVariant(ctx, id);
  if (!source) return { ok: false, error: "No encontré esa variante" };

  const { data: siblings } = await ctx.supabase.from("product_variants").select("display_order").eq("product_id", source.product_id);
  const order = (siblings ?? []).reduce((max, s) => Math.max(max, Number(s.display_order) || 0), -1) + 1;

  const copyName = `${source.name} (copia)`.slice(0, 120);
  const { data: variant, error } = await ctx.supabase
    .from("product_variants")
    .insert({
      workspace_id: ctx.workspace.id,
      product_id: source.product_id,
      name: copyName,
      duration_type: source.duration_type,
      duration_value: source.duration_value,
      event_date: source.event_date,
      billing_type: source.billing_type,
      billing_interval: source.billing_interval,
      display_order: order,
      price: Number(source.price) || 0,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (error || !variant) {
    console.error("[products] no pude duplicar la variante:", error?.message);
    return { ok: false, error: "No pude duplicar la variante" };
  }

  refresh(source.product_id);
  return { ok: true, data: { id: variant.id } };
}

// ── Precio ────────────────────────────────────────────────────────────────

/**
 * Cambia el precio de una variante. Es inmediato; el cambio (precio de antes y de ahora,
 * quién y cuándo) queda en el historial general, que lo escribe la base. Lo usa la pestaña
 * Precio de Ajustes y el cambio de precio de un producto desde Contenido.
 */
export async function setVariantPrice(input: { variantId: string; priceUsd: unknown }): Promise<CatalogResult> {
  const ctx = await manage();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const variant = await loadVariant(ctx, input.variantId);
  if (!variant) return { ok: false, error: "No encontré esa variante" };
  const checked = checkPrice(input.priceUsd);
  if (!checked.ok) return checked;
  if (checked.price === (Number(variant.price) || 0)) return { ok: true };

  const { error } = await ctx.supabase
    .from("product_variants")
    .update({ price: checked.price, updated_by: ctx.user.id })
    .eq("id", variant.id)
    .eq("workspace_id", ctx.workspace.id);
  if (error) {
    console.error("[products] no pude guardar el precio:", error.message);
    return { ok: false, error: "No pude guardar el precio" };
  }

  refresh(variant.product_id);
  return { ok: true };
}
