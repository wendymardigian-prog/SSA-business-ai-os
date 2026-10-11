"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { diffFields, logAudit } from "@/lib/audit";
import { archivedAtFor, checkName, isProductStatus } from "@/lib/content/taxonomy";
import { productInputSchema } from "@/lib/sales/catalog/products";
import { parseVariantInput } from "@/lib/sales/catalog/variants";
import {
  PLACEHOLDER_NOTE,
  PUBLISHED_VERSION_MESSAGE,
  canDeleteVersion,
  canEditVersion,
  canPublish,
  checkVersionInput,
} from "@/lib/sales/catalog/versions";
import { versionSalesCounts } from "@/lib/sales/catalog/usage";
import type { CatalogResult } from "@/lib/sales/catalog/result";

/**
 * Productos, variantes y versiones (Ventas, plano F3 a F6).
 *
 * Todo pide `settings.manage` (lo repite la RLS de la 00159). El workspace sale
 * SIEMPRE de la sesion, nunca del pedido.
 *
 *  - Nada se borra: un producto pasa a inactivo o discontinuado, una variante se
 *    archiva, una version se depreca. Lo unico que se borra es un BORRADOR de
 *    version, y eso va con el cliente de servicio (la tabla no tiene policy de
 *    DELETE) despues de comprobar que es borrador y que no tiene ventas.
 *  - Publicar es una funcion SQL (`publish_product_version`): la activa pasa a
 *    deprecated y la nueva a active en UNA transaccion. Solo service_role.
 *  - Una version publicada no se edita nunca: se crea otra.
 */

const SETTINGS_PATH = "/dashboard/settings/productos";
const CONTENT_PATH = "/dashboard/content";
const NOT_ALLOWED = "Solo quien puede cambiar la configuración maneja los productos";

type Ctx = NonNullable<Awaited<ReturnType<typeof getPermissionAction>>>;

async function manage(): Promise<Ctx | null> {
  return getPermissionAction("settings.manage");
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
    .select("id, product_id, name, duration_type, duration_value, guarantee_duration_type, guarantee_duration_value, billing_type, billing_interval, display_order, archived_at")
    .eq("id", id)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  return data ?? null;
}

async function loadVersion(ctx: Ctx, id: string) {
  if (typeof id !== "string" || !id) return null;
  const { data } = await ctx.supabase
    .from("product_versions")
    .select("id, product_variant_id, version_number, price, change_notes, status")
    .eq("id", id)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  return data ? { ...data, price: Number(data.price) || 0 } : null;
}

async function audit(
  ctx: Ctx,
  entityType: "product" | "product_variant" | "product_version",
  entityId: string,
  action: Parameters<typeof logAudit>[0]["action"],
  changes?: Parameters<typeof logAudit>[0]["changes"],
  metadata?: Record<string, unknown>,
) {
  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType,
    entityId,
    action,
    changes: changes ?? undefined,
    metadata: metadata as never,
    performedBy: ctx.user.id,
  });
}

// ── Productos ─────────────────────────────────────────────────────────────

export interface CreatedProduct {
  id: string;
  name: string;
  variantId: string;
  versionId: string;
}

/**
 * Crea un producto con su variante "Estándar" y su versión 1.
 *  - Sin precio: la versión 1 queda en borrador (precio 0 con una nota) y hay que
 *    cargarlo y publicar. Es lo que hace "+ Nuevo producto" en Ajustes.
 *  - Con precio y `publish`: la versión 1 queda activa. Es lo que hace el alta
 *    desde Contenido.
 */
export async function createProduct(input: {
  name: string;
  type?: string;
  description?: string | null;
  priceUsd?: unknown;
  publish?: boolean;
}): Promise<CatalogResult<CreatedProduct>> {
  const ctx = await manage();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const parsed = productInputSchema.safeParse({ name: input.name, type: input.type, description: input.description });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos de producto inválidos" };
  const name = checkName(parsed.data.name, await productNames(ctx));
  if (!name.ok) return { ok: false, error: `Ya existe un producto con ese nombre` };

  let price = 0;
  let notes: string | null = PLACEHOLDER_NOTE;
  if (input.priceUsd !== undefined && input.priceUsd !== null && String(input.priceUsd).trim() !== "") {
    const checked = checkVersionInput(input.priceUsd, "Precio inicial");
    if (!checked.ok) return checked;
    price = checked.price;
    notes = null;
  } else if (input.publish) {
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

  const service = await createServiceClient();
  const rollback = async (variantId?: string) => {
    // Recién creado: nada lo referencia todavía. Se limpia para no dejar un producto sin variante.
    if (variantId) await service.from("product_versions").delete().eq("product_variant_id", variantId);
    if (variantId) await service.from("product_variants").delete().eq("id", variantId);
    await service.from("products").delete().eq("id", product.id);
  };

  const { data: variant, error: vErr } = await ctx.supabase
    .from("product_variants")
    .insert({ workspace_id: ctx.workspace.id, product_id: product.id, name: "Estándar", duration_type: "lifetime", billing_type: "one_time", created_by: ctx.user.id })
    .select("id")
    .single();
  if (vErr || !variant) {
    console.error("[products] no pude crear la variante:", vErr?.message);
    await rollback();
    return { ok: false, error: "No pude crear el producto" };
  }

  const { data: version, error: verErr } = await ctx.supabase
    .from("product_versions")
    .insert({
      workspace_id: ctx.workspace.id,
      product_variant_id: variant.id,
      version_number: 1,
      price,
      change_notes: notes,
      status: "draft",
      created_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (verErr || !version) {
    console.error("[products] no pude crear la versión:", verErr?.message);
    await rollback(variant.id);
    return { ok: false, error: "No pude crear el producto" };
  }

  if (input.publish) {
    const published = await service.rpc("publish_product_version", { p_version_id: version.id, p_actor_id: ctx.user.id });
    if (published.error) {
      console.error("[products] no pude publicar la versión 1:", published.error.message);
      await rollback(variant.id);
      return { ok: false, error: "No pude crear el producto" };
    }
  }

  await audit(ctx, "product", product.id, "product.created", undefined, { name: name.name, price_usd: input.publish ? price : null });
  refresh(product.id);
  return { ok: true, data: { id: product.id, name: name.name, variantId: variant.id, versionId: version.id } };
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
    type: input.type ?? before.product_type,
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

  await audit(ctx, "product", input.id, "product.updated", diffFields(before as never, { ...before, ...patch } as never));
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

  await audit(ctx, "product", input.id, "product.status_changed", { status: { old: before.status, new: input.status } });
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
}): Promise<CatalogResult<{ id: string; versionId: string }>> {
  const ctx = await manage();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const product = await loadProduct(ctx, input.productId);
  if (!product) return { ok: false, error: "No encontré ese producto" };

  const parsed = parseVariantInput(input);
  if (!parsed.ok) return parsed;

  let price = 0;
  let notes: string | null = PLACEHOLDER_NOTE;
  if (input.priceUsd !== undefined && input.priceUsd !== null && String(input.priceUsd).trim() !== "") {
    const checked = checkVersionInput(input.priceUsd, "Precio inicial");
    if (!checked.ok) return checked;
    price = checked.price;
    notes = null;
  }

  const { data: siblings } = await ctx.supabase.from("product_variants").select("display_order").eq("product_id", product.id);
  const order = (siblings ?? []).reduce((max, s) => Math.max(max, Number(s.display_order) || 0), -1) + 1;

  const { data: variant, error } = await ctx.supabase
    .from("product_variants")
    .insert({ workspace_id: ctx.workspace.id, product_id: product.id, display_order: order, created_by: ctx.user.id, ...parsed.fields })
    .select("id")
    .single();
  if (error || !variant) {
    console.error("[products] no pude crear la variante:", error?.message);
    return { ok: false, error: "No pude crear la variante" };
  }

  const { data: version, error: verErr } = await ctx.supabase
    .from("product_versions")
    .insert({ workspace_id: ctx.workspace.id, product_variant_id: variant.id, version_number: 1, price, change_notes: notes, status: "draft", created_by: ctx.user.id })
    .select("id")
    .single();
  if (verErr || !version) {
    console.error("[products] no pude crear la versión de la variante:", verErr?.message);
    const service = await createServiceClient();
    await service.from("product_variants").delete().eq("id", variant.id);
    return { ok: false, error: "No pude crear la variante" };
  }

  await audit(ctx, "product_variant", variant.id, "variant.created", undefined, { product_id: product.id, name: parsed.fields.name });
  refresh(product.id);
  return { ok: true, data: { id: variant.id, versionId: version.id } };
}

export async function updateVariant(input: { id: string; [field: string]: unknown }): Promise<CatalogResult> {
  const ctx = await manage();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const before = await loadVariant(ctx, input.id);
  if (!before) return { ok: false, error: "No encontré esa variante" };

  const parsed = parseVariantInput(input);
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

  await audit(ctx, "product_variant", input.id, "variant.updated", diffFields(before as never, { ...before, ...parsed.fields } as never));
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

  await audit(ctx, "product_variant", id, archived ? "variant.archived" : "variant.restored");
  refresh(before.product_id);
  return { ok: true };
}

/** Copia una variante: la versión activa (o, si no hay, la última) pasa como borrador de la nueva. */
export async function duplicateVariant(id: string): Promise<CatalogResult<{ id: string; versionId: string }>> {
  const ctx = await manage();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const source = await loadVariant(ctx, id);
  if (!source) return { ok: false, error: "No encontré esa variante" };

  const { data: versions } = await ctx.supabase
    .from("product_versions")
    .select("price, status, version_number")
    .eq("product_variant_id", id);
  const ordered = [...(versions ?? [])].sort((a, b) => b.version_number - a.version_number);
  const base = ordered.find((v) => v.status === "active") ?? ordered[0];
  const price = Number(base?.price) || 0;

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
      guarantee_duration_type: source.guarantee_duration_type,
      guarantee_duration_value: source.guarantee_duration_value,
      billing_type: source.billing_type,
      billing_interval: source.billing_interval,
      display_order: order,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (error || !variant) {
    console.error("[products] no pude duplicar la variante:", error?.message);
    return { ok: false, error: "No pude duplicar la variante" };
  }

  const { data: version, error: verErr } = await ctx.supabase
    .from("product_versions")
    .insert({
      workspace_id: ctx.workspace.id,
      product_variant_id: variant.id,
      version_number: 1,
      price,
      change_notes: price > 0 ? `Copia de "${source.name}"` : PLACEHOLDER_NOTE,
      status: "draft",
      created_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (verErr || !version) {
    console.error("[products] no pude copiar la versión:", verErr?.message);
    const service = await createServiceClient();
    await service.from("product_variants").delete().eq("id", variant.id);
    return { ok: false, error: "No pude duplicar la variante" };
  }

  await audit(ctx, "product_variant", variant.id, "variant.duplicated", undefined, { from: id });
  refresh(source.product_id);
  return { ok: true, data: { id: variant.id, versionId: version.id } };
}

// ── Versiones ─────────────────────────────────────────────────────────────

export async function createVersionDraft(input: {
  variantId: string;
  priceUsd: unknown;
  changeNotes?: string | null;
}): Promise<CatalogResult<{ id: string; versionNumber: number }>> {
  const ctx = await manage();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const variant = await loadVariant(ctx, input.variantId);
  if (!variant) return { ok: false, error: "No encontré esa variante" };
  const checked = checkVersionInput(input.priceUsd, input.changeNotes);
  if (!checked.ok) return checked;

  const { data: existing } = await ctx.supabase.from("product_versions").select("version_number").eq("product_variant_id", variant.id);
  const next = (existing ?? []).reduce((max, v) => Math.max(max, Number(v.version_number) || 0), 0) + 1;

  const { data, error } = await ctx.supabase
    .from("product_versions")
    .insert({
      workspace_id: ctx.workspace.id,
      product_variant_id: variant.id,
      version_number: next,
      price: checked.price,
      change_notes: input.changeNotes?.trim() || null,
      status: "draft",
      created_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[products] no pude crear el borrador:", error?.message);
    return { ok: false, error: "No pude crear la versión" };
  }

  await audit(ctx, "product_version", data.id, "version.draft_created", undefined, { variant_id: variant.id, price: checked.price });
  refresh(variant.product_id);
  return { ok: true, data: { id: data.id, versionNumber: next } };
}

export async function updateVersionDraft(input: { id: string; priceUsd: unknown; changeNotes?: string | null }): Promise<CatalogResult> {
  const ctx = await manage();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const before = await loadVersion(ctx, input.id);
  if (!before) return { ok: false, error: "No encontré esa versión" };
  const editable = canEditVersion(before.status);
  if (!editable.ok) return editable;
  const checked = checkVersionInput(input.priceUsd, input.changeNotes);
  if (!checked.ok) return checked;

  const patch = { price: checked.price, change_notes: input.changeNotes?.trim() || null };
  const { error } = await ctx.supabase.from("product_versions").update(patch).eq("id", input.id).eq("workspace_id", ctx.workspace.id).eq("status", "draft");
  if (error) {
    console.error("[products] no pude guardar el borrador:", error.message);
    return { ok: false, error: "No pude guardar la versión" };
  }

  await audit(ctx, "product_version", input.id, "version.draft_updated", diffFields(before as never, { ...before, ...patch } as never));
  const variant = await loadVariant(ctx, before.product_variant_id);
  refresh(variant?.product_id);
  return { ok: true };
}

export async function deleteVersionDraft(id: string): Promise<CatalogResult> {
  const ctx = await manage();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const version = await loadVersion(ctx, id);
  if (!version) return { ok: false, error: "No encontré esa versión" };
  const counts = await versionSalesCounts(ctx.supabase, [id]);
  const allowed = canDeleteVersion(version, counts[id] ?? 0);
  if (!allowed.ok) return allowed;

  const service = await createServiceClient();
  const { error } = await service.from("product_versions").delete().eq("id", id).eq("workspace_id", ctx.workspace.id).eq("status", "draft");
  if (error) {
    console.error("[products] no pude borrar el borrador:", error.message);
    return { ok: false, error: "No pude borrar el borrador" };
  }

  await audit(ctx, "product_version", id, "version.draft_deleted", undefined, { variant_id: version.product_variant_id });
  const variant = await loadVariant(ctx, version.product_variant_id);
  refresh(variant?.product_id);
  return { ok: true };
}

/** Publica un borrador: la activa pasa a deprecated y esta a active, en una transacción. */
export async function publishVersion(id: string): Promise<CatalogResult> {
  const ctx = await manage();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const version = await loadVersion(ctx, id);
  if (!version) return { ok: false, error: "No encontré esa versión" };
  const check = canPublish(version);
  if (!check.ok) return check;

  const service = await createServiceClient();
  const { data, error } = await service.rpc("publish_product_version", { p_version_id: id, p_actor_id: ctx.user.id });
  if (error) {
    console.error("[products] no pude publicar:", error.message);
    return { ok: false, error: /version_not_draft/.test(error.message) ? PUBLISHED_VERSION_MESSAGE : "No pude publicar la versión" };
  }

  await audit(ctx, "product_version", id, "version.published", undefined, {
    variant_id: version.product_variant_id,
    price: version.price,
    replaced: (data as { deprecated_version_id?: string | null } | null)?.deprecated_version_id ?? null,
  });
  const variant = await loadVariant(ctx, version.product_variant_id);
  refresh(variant?.product_id);
  return { ok: true };
}

/**
 * Cambia el precio de la versión vigente de una variante: crea un borrador con el
 * precio nuevo y lo publica. Lo usa Contenido cuando alguien edita el precio de un
 * producto ahí (la versión anterior queda deprecated, nada se pisa).
 */
export async function setVariantPrice(input: { variantId: string; priceUsd: unknown; changeNotes?: string | null }): Promise<CatalogResult> {
  const created = await createVersionDraft({ variantId: input.variantId, priceUsd: input.priceUsd, changeNotes: input.changeNotes });
  if (!created.ok) return created;
  return publishVersion(created.data.id);
}
