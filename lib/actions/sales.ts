"use server";

import { workspaceMethods } from "@/lib/sales/workspace-methods";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { snapshotProductId } from "@/lib/sales/sale-text";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { findOrCreateContact } from "@/lib/contacts/find-or-create";
import { logAudit } from "@/lib/audit";
import { sanitizeSearch } from "@/lib/url-params";
import { isProductStatus } from "@/lib/content/taxonomy";
import { LOCKED_REASON, hasEditConflict, isLockedForEdit, lockedEditError, planRepricing, type EditField } from "@/lib/sales/edit";
import { resolveSaleAttribution, TOUCH_COLUMNS, type TouchRow } from "@/lib/attribution/attribution";
import { attributionRequestSchema } from "@/lib/sales/create";
import { registerManualSaleTouch } from "@/lib/sales/manual-touch";
import { diffFields } from "@/lib/audit";
import { validatePlanBalances } from "@/lib/sales/payment-plan";
import { applySaleRules, createSaleInputSchema, mapCreateSaleError, type CreateSaleInput, type SaleCode } from "@/lib/sales/create";
import { manualContactSchema, resolveFoundContact, type ManualContactInput } from "@/lib/sales/contacts";
import { buildProductSnapshot } from "@/lib/sales/sale-math";
import { hasPrice } from "@/lib/catalog/price";
import { toCents } from "@/lib/shared/money";
import { syncPaymentRelativeJobs } from "@/lib/sales/automation/relative";
import type { Json } from "@/lib/types/database";

/**
 * Ventas: crear, y el alta rápida de un contacto desde el asistente (plano F18, F22).
 *
 * Quién escribe: SIEMPRE el servidor, con el cliente de servicio, DESPUÉS de
 * `requirePermission("sales.manage")` y de chequear el alcance. `has_permission` en SQL no
 * conoce al Member de sistema (sus permisos viven en el código), por eso las tablas de ventas
 * no tienen policies de escritura y `create_sale` es solo para `service_role`.
 *
 * Lo que se LEE para decidir (el contacto, el catálogo) se lee con el cliente de QUIEN CARGA:
 * la RLS decide qué contactos ve. El workspace sale siempre de la sesión, nunca del pedido.
 */

const NOT_ALLOWED = "No tenés permiso para cargar ventas";

export type CreateSaleResult =
  | { ok: true; id: string }
  | { ok: false; code: SaleCode; error: string; diffCents?: number; newPrice?: number };

const fail = (code: SaleCode, error: string, extra: { diffCents?: number; newPrice?: number } = {}): CreateSaleResult => ({ ok: false, code, error, ...extra });

export async function createSale(rawInput: CreateSaleInput): Promise<CreateSaleResult> {
  const ctx = await getPermissionAction("sales.manage");
  if (!ctx) return fail("scope", NOT_ALLOWED);
  const { workspace, supabase, user } = ctx;

  const parsed = createSaleInputSchema.safeParse(rawInput);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Los datos de la venta no son válidos");
  const input = parsed.data;

  // 1. El contacto: lo que la RLS deja ver a quien carga.
  const { data: contact } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", input.contactId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!contact) return fail("invalid_contact", "No encontré ese contacto");

  // Setter y vendedor tienen que ser miembros del workspace.
  const people = [input.setterId, input.vendedorId].filter((v): v is string => !!v);
  if (people.length > 0) {
    const { data: members } = await supabase.from("workspace_members").select("user_id").eq("workspace_id", workspace.id).in("user_id", people);
    if ((members ?? []).length !== new Set(people).size) return fail("invalid", "Esa persona no es miembro del workspace");
  }

  // 2. El catálogo, RELEÍDO: la variante y su precio EN ESTE MOMENTO.
  const { data: variant } = await supabase
    .from("product_variants")
    .select("id, product_id, name, duration_type, duration_value, event_date, billing_type, billing_interval, price, archived_at")
    .eq("id", input.variantId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!variant) return fail("invalid", "No encontré esa variante del producto");
  const { data: product } = await supabase
    .from("products")
    .select("id, name, product_type, status")
    .eq("id", variant.product_id)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!product || variant.archived_at || !isProductStatus(product.status) || product.status !== "active") {
    return fail("invalid", "Ese producto ya no se ofrece");
  }
  if (!hasPrice(variant.price)) return fail("invalid", "Esa variante no tiene precio: cargalo en Ajustes › Productos");
  const currentPrice = Number(variant.price) || 0;
  if (toCents(input.shownPrice) !== toCents(currentPrice)) {
    return fail("price_changed", "El precio del producto cambió mientras cargabas la venta", { newPrice: currentPrice });
  }

  const snapshot = buildProductSnapshot(product, variant);

  // 3. Las reglas del servidor: descuento, fechas, métodos, alcance y cuadre.
  const w = workspace as unknown as {
    timezone?: string;
    max_discount_percent?: number | null;
  };
  const methods = workspaceMethods(workspace);
  // `manual_channel` (F47): el toque se crea DESPUES de validar todo lo demas (una venta rechazada no deja un toque
  // huerfano). Para las reglas alcanza con un valor neutro: el modo real se pone al armar el payload.
  const manualChannel = input.attribution.mode === "manual_channel" ? input.attribution : null;
  const rulesInput = manualChannel ? { ...input, attribution: { mode: "last_touch" as const } } : input;
  const ruled = applySaleRules(rulesInput, {
    timeZone: w.timezone ?? "UTC",
    now: new Date(),
    enabledMethods: methods.enabledKeys,
    methods: methods.defs,
    maxDiscountPercent: w.max_discount_percent == null ? null : Number(w.max_discount_percent),
    hasAllScope: ctx.role === "owner" || ctx.role === "admin" || ctx.scope("sales") === "all",
    userId: user.id,
    variant: { id: variant.id, price: currentPrice },
    snapshot,
  });
  if (!ruled.ok) return fail(ruled.code, ruled.error, { diffCents: ruled.diffCents });

  // 4. Una transacción en la base: venta + pagos + estado + eventos + auditoría.
  const service = await createServiceClient();
  let payload: Record<string, unknown> = ruled.payload;
  if (manualChannel) {
    // El servidor crea el toque (origin = 'manual', mediodia del dia de la venta) y la venta se atribuye a el.
    // La clave es la del asistente: enviar dos veces la misma venta deja UN solo toque.
    const touch = await registerManualSaleTouch(service, {
      workspaceId: workspace.id,
      contactId: input.contactId,
      choice: manualChannel.choice,
      saleDate: input.saleDate,
      timeZone: w.timezone ?? "UTC",
      saleKey: input.idempotencyKey ?? globalThis.crypto.randomUUID(),
    });
    if (!touch.ok) return fail("invalid_manual", touch.error);
    payload = { ...payload, attribution: { mode: "touch", touch_id: touch.touchId } };
  }
  const { data, error } = await service.rpc("create_sale", {
    p_payload: { ...payload, workspace_id: workspace.id } as unknown as Json,
    p_actor_id: user.id,
  });
  if (error) {
    const mapped = mapCreateSaleError(error.message);
    if (mapped.code === "server") console.error("[sales] create_sale falló:", error.message);
    return fail(mapped.code, mapped.error, { diffCents: mapped.diffCents, newPrice: mapped.newPrice });
  }

  const saleId = (data as { sale_id?: string } | null)?.sale_id;
  if (!saleId) return fail("server", "No pude crear la venta");

  // 5. Los recordatorios relativos de los pagos (se completan en el Bloque 4).
  await syncPaymentRelativeJobs(service, { saleId });

  revalidatePath("/dashboard/ventas");
  revalidatePath(`/dashboard/contacts/${input.contactId}`);
  return { ok: true, id: saleId };
}

// ── F18: el alta rápida de un contacto ────────────────────────────────────

export type ContactForSaleResult =
  | { ok: true; contactId: string; created: boolean; notice: string | null }
  | { ok: false; error: string };

/**
 * Resuelve el contacto del asistente. Busca por TELÉFONO primero y después por email con
 * la regla única (`find_or_create_contact`): con un contacto existente se usa ese; si no, se crea
 * uno nuevo. Nunca `find_or_link_contact` ni deduplicar por nombre.
 *
 * Un Member con alcance `own` queda como setter del contacto nuevo: si no, no podría verlo
 * después de crearlo (la RLS de contactos lo esconde).
 */
export async function createContactForSale(input: ManualContactInput): Promise<ContactForSaleResult> {
  const ctx = await getPermissionAction("sales.manage");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const { workspace, user } = ctx;

  const parsed = manualContactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Los datos del contacto no son válidos" };
  const { name } = parsed.data;
  const email = parsed.data.email?.trim() || null;
  const phone = parsed.data.phone?.trim() || null;

  const service = await createServiceClient();
  const ownsOnly = !(ctx.role === "owner" || ctx.role === "admin" || ctx.scope("leads") === "all");

  // La regla unica (00200): teléfono primero, después email, con el teléfono normalizado; busca y, si no
  // está, crea el contacto (con bloqueo por dato). Un error de la base ya NO se toma como "no está".
  let result;
  try {
    result = await findOrCreateContact(service, {
      workspaceId: workspace.id,
      identity: { phone, email },
      defaults: { display_name: name, ...(ownsOnly ? { setter_id: user.id } : {}) },
      mode: "create",
    });
  } catch (err) {
    console.error("[sales] no pude buscar o crear el contacto:", err instanceof Error ? err.message : "error desconocido");
    return { ok: false, error: "No pude crear el contacto" };
  }
  if (result.status === "no_identity" || !result.contactId) {
    return { ok: false, error: "Poné un email o un teléfono válido (con código de país)" };
  }
  if (!result.created) {
    const resolution = resolveFoundContact({ contact_id: result.contactId, matched_by: result.matchedBy, conflict_contact_id: result.conflictContactId });
    if (resolution.kind === "existing") {
      return { ok: true, contactId: resolution.contactId, created: false, notice: resolution.notice };
    }
  }

  const data = { id: result.contactId };

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: workspace.id,
    entityType: "contact",
    entityId: data.id,
    action: "create",
    metadata: { source: "sale_wizard" },
    performedBy: user.id,
  });
  return { ok: true, contactId: data.id, created: true, notice: null };
}

export interface SaleContactOption {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

/** El buscador del asistente: solo los contactos que quien busca puede ver (la RLS acota). */
export async function searchContactsForSale(query: string): Promise<SaleContactOption[]> {
  const ctx = await getPermissionAction("sales.view");
  if (!ctx) return [];
  const q = sanitizeSearch(query, 60);
  if (q.length < 2) return [];
  const { data } = await ctx.supabase
    .from("contacts")
    .select("id, display_name, email, phone")
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .or(`display_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%,whatsapp_phone.ilike.%${q}%,instagram_username.ilike.%${q}%`)
    .order("display_name", { ascending: true })
    .limit(8);
  return (data ?? []).map((c) => ({ id: c.id, name: c.display_name || c.email || "Sin nombre", email: c.email ?? null, phone: c.phone ?? null }));
}

// ── F26: editar, cancelar y rearmar el plan ──────────────────────────────

export type SaleActionResult =
  | { ok: true; message?: string }
  | { ok: false; code: "permission" | "not_found" | "locked" | "conflict" | "confirm_required" | "reason_required" | "discount" | "invalid" | "server"; error: string; paidAmount?: number };

const fail2 = (code: Exclude<SaleActionResult, { ok: true }>["code"], error: string, extra: { paidAmount?: number } = {}): SaleActionResult => ({ ok: false, code, error, ...extra });

export interface UpdateSaleInput {
  saleId: string;
  /** El `updated_at` que tenía la ficha al abrirse: si cambió, hay un conflicto de edición. */
  expectedUpdatedAt?: string | null;
  contactId?: string;
  setterId?: string | null;
  vendedorId?: string | null;
  attribution?: unknown;
  discount?: { type: "amount" | "percent"; value: unknown } | null;
  discountReason?: string | null;
  /** Cambiar a otra variante del catálogo, con el precio que se mostró. */
  variantId?: string;
  shownPrice?: number;
  notes?: string | null;
  serviceStartsAt?: string | null;
  confirmRepricing?: boolean;
  repricingReason?: string | null;
}

const SALE_COLUMNS =
  "id, workspace_id, contact_id, status, financing_type, sale_date, base_amount, discount_amount, final_amount, discount_reason, product_snapshot, product_variant_id, setter_id, vendedor_id, attribution, attribution_touch_id, attribution_type, notes, service_starts_at, plan_unbalanced, updated_at";

/**
 * Edita una venta. Pide `sales.manage` y que la persona VEA la venta (RLS). Una venta
 * cancelada, reembolsada o en disputa solo admite notas. Cambiar el producto o el precio con
 * cobros exige `confirmRepricing` + motivo, reescribe el snapshot (el anterior queda en el
 * historial) y NO toca lo cobrado.
 */
export async function updateSale(input: UpdateSaleInput): Promise<SaleActionResult> {
  const ctx = await getPermissionAction("sales.manage");
  if (!ctx) return fail2("permission", NOT_ALLOWED);
  const { workspace, supabase, user } = ctx;

  const { data: sale } = await supabase.from("sales").select(SALE_COLUMNS).eq("id", input.saleId).eq("workspace_id", workspace.id).maybeSingle();
  if (!sale) return fail2("not_found", "Esta venta no existe o no tenés acceso");
  if (hasEditConflict(input.expectedUpdatedAt, sale.updated_at)) {
    return fail2("conflict", "Alguien modificó esta venta mientras la editabas. Recargá para ver los cambios.");
  }

  const fields: EditField[] = [];
  if (input.contactId !== undefined && input.contactId !== sale.contact_id) fields.push("contact");
  if (input.setterId !== undefined && input.setterId !== sale.setter_id) fields.push("setter");
  if (input.vendedorId !== undefined && input.vendedorId !== sale.vendedor_id) fields.push("vendedor");
  if (input.attribution !== undefined) fields.push("attribution");
  if (input.discount !== undefined || input.variantId !== undefined) fields.push("pricing");
  if (input.serviceStartsAt !== undefined && input.serviceStartsAt !== sale.service_starts_at) fields.push("serviceStartsAt");
  const locked = lockedEditError(sale.status, fields);
  if (locked) return fail2("locked", locked);

  const patch: Record<string, unknown> = {};
  const w = workspace as unknown as { max_discount_percent?: number | null };
  const hasAllScope = ctx.role === "owner" || ctx.role === "admin" || ctx.scope("sales") === "all";

  // Contacto y personas.
  if (fields.includes("contact") && input.contactId) {
    const { data: contact } = await supabase.from("contacts").select("id").eq("id", input.contactId).eq("workspace_id", workspace.id).is("deleted_at", null).maybeSingle();
    if (!contact) return fail2("invalid", "No encontré ese contacto");
    patch.contact_id = input.contactId;
  }
  for (const [key, column] of [["setterId", "setter_id"], ["vendedorId", "vendedor_id"]] as const) {
    const value = input[key];
    if (value === undefined || value === sale[column]) continue;
    if (value) {
      const { data: member } = await supabase.from("workspace_members").select("user_id").eq("workspace_id", workspace.id).eq("user_id", value).maybeSingle();
      if (!member) return fail2("invalid", "Esa persona no es miembro del workspace");
    }
    patch[column] = value;
  }
  const afterSetter = (patch.setter_id as string | null | undefined) ?? sale.setter_id;
  const afterVendedor = (patch.vendedor_id as string | null | undefined) ?? sale.vendedor_id;
  if (!hasAllScope && afterSetter !== user.id && afterVendedor !== user.id) {
    return fail2("invalid", "Tenés que quedar como setter o como vendedor de la venta para poder verla");
  }

  // Atribución: otro toque del historial o cargada a mano. NO existe "recalcular desde el último toque actual".
  let attributionAudit: { old: Json; new: Json } | null = null;
  if (input.attribution !== undefined) {
    const request = attributionRequestSchema.safeParse(input.attribution);
    if (!request.success) return fail2("invalid", "La atribución no es válida");
    const contactId = (patch.contact_id as string | undefined) ?? sale.contact_id;
    // `manual_channel` (F47): se crea el toque con la fecha de la venta y la venta pasa a apuntar a el.
    let touchRequest: Parameters<typeof resolveSaleAttribution>[0];
    if (request.data.mode === "manual_channel") {
      const created = await registerManualSaleTouch(await createServiceClient(), {
        workspaceId: workspace.id,
        contactId,
        choice: request.data.choice,
        saleDate: sale.sale_date,
        timeZone: (workspace as unknown as { timezone?: string }).timezone ?? "UTC",
        saleKey: sale.id,
      });
      if (!created.ok) return fail2("invalid", created.error);
      touchRequest = { mode: "touch", touchId: created.touchId };
    } else {
      touchRequest = request.data.mode === "touch" ? { mode: "touch", touchId: request.data.touchId } : request.data.mode === "manual" ? { mode: "manual", manual: request.data.manual } : { mode: "last_touch" };
    }
    const { data: touches } = await supabase.from("contact_touches").select(TOUCH_COLUMNS).eq("contact_id", contactId).eq("workspace_id", workspace.id);
    const resolved = resolveSaleAttribution(
      touchRequest,
      { attribution: null },
      (touches ?? []) as unknown as TouchRow[],
    );
    if (!resolved.ok) return fail2("invalid", resolved.error);
    patch.attribution = resolved.attribution as unknown as Json;
    patch.attribution_touch_id = resolved.attribution_touch_id;
    patch.attribution_type = resolved.attribution_type;
    attributionAudit = { old: { type: sale.attribution_type, attribution: sale.attribution } as unknown as Json, new: { type: resolved.attribution_type, attribution: resolved.attribution } as unknown as Json };
  }

  // Precio y producto.
  let repricing: ReturnType<typeof planRepricing> | null = null;
  if (fields.includes("pricing")) {
    let snapshot: ReturnType<typeof buildProductSnapshot> | null = null;
    if (input.variantId && input.variantId !== sale.product_variant_id) {
      const { data: variant } = await supabase
        .from("product_variants")
        .select("id, product_id, name, duration_type, duration_value, event_date, billing_type, billing_interval, price, archived_at")
        .eq("id", input.variantId)
        .eq("workspace_id", workspace.id)
        .maybeSingle();
      const { data: product } = variant
        ? await supabase.from("products").select("id, name, product_type, status").eq("id", variant.product_id).eq("workspace_id", workspace.id).maybeSingle()
        : { data: null };
      if (!variant || !product) return fail2("invalid", "Ese producto ya no existe");
      if (variant.archived_at || product.status !== "active") return fail2("invalid", "Ese producto ya no se ofrece");
      if (!hasPrice(variant.price)) return fail2("invalid", "Esa variante no tiene precio: cargalo en Ajustes › Productos");
      if (input.shownPrice !== undefined && toCents(input.shownPrice) !== toCents(Number(variant.price) || 0)) {
        return fail2("invalid", "El precio de ese producto cambió: volvé a elegirlo");
      }
      snapshot = buildProductSnapshot(product, variant);
    }
    const { data: pays } = await supabase.from("payments").select("type, status, amount").eq("sale_id", sale.id);
    repricing = planRepricing(
      sale,
      pays ?? [],
      { snapshot, variantId: snapshot ? snapshot.variant_id : null, discount: input.discount as never, discountReason: input.discountReason ?? undefined },
      { maxPercent: w.max_discount_percent == null ? null : Number(w.max_discount_percent), hasAllScope, confirmRepricing: input.confirmRepricing === true, repricingReason: input.repricingReason ?? null },
    );
    if (!repricing.ok) return fail2(repricing.code, repricing.error, { paidAmount: repricing.paidCents });
    if (repricing.changed) {
      Object.assign(patch, repricing.patch);
      patch.plan_unbalanced = repricing.planUnbalanced;
    }
  }

  if (input.notes !== undefined && (input.notes ?? null) !== sale.notes) patch.notes = input.notes?.trim() || null;
  if (fields.includes("serviceStartsAt")) patch.service_starts_at = input.serviceStartsAt ?? null;

  if (Object.keys(patch).length === 0) return { ok: true };

  const service = await createServiceClient();
  // El UPDATE es condicional sobre `updated_at`: si alguien guardó entre medio, no se pisa.
  const { data: written, error } = await service
    .from("sales")
    .update({ ...patch, updated_by: user.id } as never)
    .eq("id", sale.id)
    .eq("workspace_id", workspace.id)
    .eq("updated_at", sale.updated_at)
    .select("id");
  if (error) {
    console.error("[sales] no pude editar la venta:", error.message);
    return fail2("server", "No pude guardar los cambios");
  }
  if (!written || written.length === 0) return fail2("conflict", "Alguien modificó esta venta mientras la editabas. Recargá para ver los cambios.");

  // Auditoría: el diff legible, y las dos acciones que piden su propio registro.
  const plainPatch = Object.fromEntries(Object.entries(patch).filter(([k]) => !["attribution", "attribution_touch_id", "attribution_type", "product_snapshot"].includes(k)));
  const changes = diffFields(sale as never, plainPatch as never) ?? {};
  if (attributionAudit) {
    await logAudit({ supabase, workspaceId: workspace.id, entityType: "sale", entityId: sale.id, action: "sale.attribution_changed", changes: { attribution: attributionAudit }, performedBy: user.id });
  }
  if (repricing && repricing.ok && repricing.changed) {
    await logAudit({
      supabase, workspaceId: workspace.id, entityType: "sale", entityId: sale.id, action: "sale.repriced",
      changes: { ...changes, product_snapshot: { old: repricing.previous.product_snapshot as Json, new: repricing.patch.product_snapshot as Json } },
      metadata: { reason: input.repricingReason ?? null, paid_amount: repricing.paidCents / 100, plan_unbalanced: repricing.planUnbalanced },
      performedBy: user.id,
    });
  } else if (Object.keys(changes).length > 0) {
    await logAudit({ supabase, workspaceId: workspace.id, entityType: "sale", entityId: sale.id, action: "sale.updated", changes, performedBy: user.id });
  }

  revalidatePath("/dashboard/ventas");
  revalidatePath(`/dashboard/ventas/${sale.id}`);
  return { ok: true };
}

/** Cancelar es DEFINITIVO: no hay vuelta a activa. Anula los pagos programados y morosos y conserva lo cobrado. */
export async function cancelSale(input: { saleId: string; reason: string }): Promise<SaleActionResult> {
  const ctx = await getPermissionAction("sales.manage");
  if (!ctx) return fail2("permission", NOT_ALLOWED);
  const { workspace, supabase, user } = ctx;
  const reason = (input.reason ?? "").trim();
  if (!reason) return fail2("reason_required", "Explicá el motivo de la cancelación");

  const { data: sale } = await supabase.from("sales").select("id, status").eq("id", input.saleId).eq("workspace_id", workspace.id).maybeSingle();
  if (!sale) return fail2("not_found", "Esta venta no existe o no tenés acceso");
  if (sale.status === "cancelled") return fail2("locked", "Esta venta ya está cancelada");
  if (isLockedForEdit(sale.status)) return fail2("locked", LOCKED_REASON[sale.status] ?? "Esta venta no se puede cancelar");

  const service = await createServiceClient();
  const { data, error } = await service.rpc("cancel_sale", { p_sale_id: sale.id, p_reason: reason, p_actor_id: user.id });
  if (error) {
    console.error("[sales] cancel_sale falló:", error.message);
    return fail2("server", "No pude cancelar la venta");
  }
  // Los recordatorios pendientes de los pagos anulados se cancelan.
  await syncPaymentRelativeJobs(service, { saleId: sale.id });
  const paid = await supabase.from("payments").select("amount").eq("sale_id", sale.id).eq("status", "paid");
  const hadCollected = (paid.data ?? []).length > 0;
  revalidatePath("/dashboard/ventas");
  revalidatePath(`/dashboard/ventas/${sale.id}`);
  void data;
  return { ok: true, message: hadCollected ? "Venta cancelada. Había cobros: registrá el reembolso si corresponde." : "Venta cancelada." };
}

/** Solo una suscripción: pasa a `subscription_cancelled` (estado escrito) con su motivo. */
export async function cancelSubscription(input: { saleId: string; reason: string }): Promise<SaleActionResult> {
  const ctx = await getPermissionAction("sales.manage");
  if (!ctx) return fail2("permission", NOT_ALLOWED);
  const { workspace, supabase, user } = ctx;
  const reason = (input.reason ?? "").trim();
  if (!reason) return fail2("reason_required", "Explicá el motivo de la baja");

  const { data: sale } = await supabase.from("sales").select("id, status, financing_type").eq("id", input.saleId).eq("workspace_id", workspace.id).maybeSingle();
  if (!sale) return fail2("not_found", "Esta venta no existe o no tenés acceso");
  if (sale.financing_type !== "subscription") return fail2("invalid", "Solo se puede dar de baja una suscripción");
  if (sale.status !== "subscription_active") return fail2("locked", "Esta suscripción ya no está activa");

  const service = await createServiceClient();
  const { error } = await service
    .from("sales")
    .update({ status: "subscription_cancelled", subscription_cancelled_at: new Date().toISOString(), subscription_cancel_reason: reason, updated_by: user.id } as never)
    .eq("id", sale.id)
    .eq("workspace_id", workspace.id)
    .eq("status", "subscription_active");
  if (error) {
    console.error("[sales] no pude cancelar la suscripción:", error.message);
    return fail2("server", "No pude dar de baja la suscripción");
  }
  await logAudit({ supabase, workspaceId: workspace.id, entityType: "sale", entityId: sale.id, action: "sale.subscription_cancelled", changes: { status: { old: sale.status, new: "subscription_cancelled" } }, metadata: { reason }, performedBy: user.id });
  revalidatePath(`/dashboard/ventas/${sale.id}`);
  revalidatePath("/dashboard/ventas");
  return { ok: true };
}

/**
 * «Rearmar el plan» (cuando un cambio de precio lo descuadró): anula los pagos programados y
 * morosos y crea los nuevos. Lo cobrado NO se toca. El plan nuevo tiene que cuadrar con lo que
 * falta cobrar (final − cobrado neto).
 */
export async function rebuildPlan(input: { saleId: string; payments: Array<{ amount: number; date: string; method?: string | null }> }): Promise<SaleActionResult> {
  const ctx = await getPermissionAction("payments.manage");
  if (!ctx) return fail2("permission", "No tenés permiso para cambiar el plan de pagos");
  const { workspace, supabase, user } = ctx;

  const { data: sale } = await supabase.from("sales").select("id, status, financing_type, final_amount").eq("id", input.saleId).eq("workspace_id", workspace.id).maybeSingle();
  if (!sale) return fail2("not_found", "Esta venta no existe o no tenés acceso");
  if (isLockedForEdit(sale.status)) return fail2("locked", LOCKED_REASON[sale.status] ?? "Esta venta no se puede editar");
  if (sale.financing_type === "subscription") return fail2("invalid", "Una suscripción no tiene plan para rearmar");

  const { data: current } = await supabase.from("payments").select("id, type, status, amount").eq("sale_id", sale.id);
  const collected = (current ?? []).filter((p) => p.status === "paid");
  const collectedCents = collected.reduce((acc, p) => acc + Math.round(Number(p.amount) * 100), 0);
  const remaining = Math.round(Number(sale.final_amount) * 100) - collectedCents;
  const balance = validatePlanBalances(remaining / 100, input.payments.map((p) => ({ amount: p.amount })));
  if (!balance.ok) return fail2("invalid", balance.diffCents > 0 ? "Falta asignar parte de lo que queda por cobrar" : "El plan nuevo se pasa de lo que queda por cobrar");
  if (input.payments.some((p) => !(p.amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(p.date))) return fail2("invalid", "Cada cuota necesita un monto y una fecha");

  const service = await createServiceClient();
  const old = (current ?? []).filter((p) => p.status === "scheduled" || p.status === "overdue").map((p) => p.id);
  if (old.length > 0) {
    const { error } = await service.from("payments").update({ status: "cancelled", updated_by: user.id } as never).in("id", old);
    if (error) return fail2("server", "No pude rearmar el plan");
  }
  if (input.payments.length > 0) {
    const { error } = await service.from("payments").insert(
      input.payments.map((p) => ({ workspace_id: workspace.id, sale_id: sale.id, type: "installment", amount: p.amount, status: "scheduled", due_date: p.date, payment_method: p.method ?? null, created_by: user.id, updated_by: user.id })) as never,
    );
    if (error) {
      console.error("[sales] no pude crear el plan nuevo:", error.message);
      return fail2("server", "No pude rearmar el plan");
    }
  }
  await service.from("sales").update({ plan_unbalanced: false, updated_by: user.id } as never).eq("id", sale.id);
  await logAudit({ supabase, workspaceId: workspace.id, entityType: "sale", entityId: sale.id, action: "sale.updated", metadata: { rebuilt_plan: true, payments: input.payments.length }, performedBy: user.id });
  await syncPaymentRelativeJobs(service, { saleId: sale.id });
  revalidatePath(`/dashboard/ventas/${sale.id}`);
  return { ok: true };
}

// ── Contexto del contacto para el asistente (F18, F24) ────────────────────

export interface SaleContactContext {
  name: string;
  touchCount: number;
  doNotContact: boolean;
  overduePayments: number;
  setterId: string | null;
  vendedorId: string | null;
  /** Ventas del contacto (con el producto del snapshot) para el aviso de venta duplicada. */
  sales: Array<{ id: string; status: string; productId: string | null }>;
  /** Agendas PASADAS del contacto que la persona ve, de la más nueva a la más vieja. */
  bookings: Array<{ id: string; startAt: string; status: string; hostUserId: string | null; eventTypeTitle: string | null }>;
}

/** Lo que el paso 1 necesita saber del contacto elegido. La RLS decide qué ve cada persona. */
export async function getSaleContactContext(contactId: string): Promise<SaleContactContext | null> {
  const ctx = await getPermissionAction("sales.view");
  if (!ctx || !z.string().uuid().safeParse(contactId).success) return null;
  const { supabase, workspace } = ctx;

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, display_name, email, setter_id, vendedor_id, do_not_contact")
    .eq("id", contactId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!contact) return null;

  const [touches, salesRes, bookingsRes] = await Promise.all([
    supabase.from("contact_touches").select("id", { count: "exact", head: true }).eq("contact_id", contactId).eq("workspace_id", workspace.id),
    supabase.from("sales").select("id, status, product_snapshot").eq("contact_id", contactId).eq("workspace_id", workspace.id),
    supabase.from("bookings").select("id, start_at, status, host_user_id, event_type_id").eq("contact_id", contactId).eq("workspace_id", workspace.id).lt("start_at", new Date().toISOString()).order("start_at", { ascending: false }).limit(20),
  ]);

  const sales = salesRes.data ?? [];
  const saleIds = sales.map((s) => s.id);
  const { count: overdue } = saleIds.length
    ? await supabase.from("payments").select("id", { count: "exact", head: true }).in("sale_id", saleIds).eq("status", "overdue")
    : { count: 0 };

  const eventTypeIds = [...new Set((bookingsRes.data ?? []).map((b) => b.event_type_id).filter((x): x is string => !!x))];
  const { data: eventTypes } = eventTypeIds.length
    ? await supabase.from("event_types").select("id, title").in("id", eventTypeIds)
    : { data: [] as Array<{ id: string; title: string }> };
  const titles = new Map((eventTypes ?? []).map((e) => [e.id, e.title]));

  return {
    name: contact.display_name || contact.email || "Sin nombre",
    touchCount: touches.count ?? 0,
    doNotContact: contact.do_not_contact === true,
    overduePayments: overdue ?? 0,
    setterId: contact.setter_id ?? null,
    vendedorId: contact.vendedor_id ?? null,
    sales: sales.map((s) => ({ id: s.id, status: s.status, productId: snapshotProductId(s.product_snapshot) })),
    bookings: (bookingsRes.data ?? []).map((b) => ({
      id: b.id,
      startAt: b.start_at,
      status: b.status,
      hostUserId: b.host_user_id ?? null,
      eventTypeTitle: b.event_type_id ? titles.get(b.event_type_id) ?? null : null,
    })),
  };
}
