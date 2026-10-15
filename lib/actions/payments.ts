"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPermissionAction } from "@/lib/auth/guards";
import { diffFields, logAudit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { wallClockToUtc } from "@/lib/scheduling/time/tz";
import { localToday } from "@/lib/sales/dates";
import { totalPaidCents } from "@/lib/sales/money";
import { workspaceMethods } from "@/lib/sales/workspace-methods";
import type { PaymentMethodDef } from "@/lib/sales/payment-methods";
import {
  planAddPayment, planFeeCorrection, planMarkPaid, planRefund, planReschedule, planRevert, planUncollectible, REVERT_CLEARED_FIELDS,
  type PartialOffer,
} from "@/lib/sales/payments-rules";
import { checkReceipt, receiptPath, receiptPathBelongsTo, RECEIPT_BUCKET, RECEIPT_MAX_BYTES, RECEIPT_SIGNED_URL_SECONDS } from "@/lib/sales/receipts";
import { refreshContactPaymentHealth } from "@/lib/sales/payment-health-run";
import { markPaidCore, rescheduleCore } from "@/lib/sales/payments-core";
import { syncPaymentRelativeJobs } from "@/lib/sales/automation/relative";
import type { Json } from "@/lib/types/database";

/**
 * Pagos de una venta (plano F29, F32 y F28): cobrar, cobro parcial, revertir, reprogramar,
 * incobrable, reembolso, agregar un pago y comprobantes.
 *
 * Quién escribe: SIEMPRE el servidor, con el cliente de servicio, DESPUÉS de
 * `getPermissionAction("payments.manage")` y de leer el pago con la sesión de QUIEN PIDE (la RLS
 * de `payments` la limita a las ventas que ve). Cada cambio de estado lo emite el trigger de la
 * base (un cambio = un evento) y recalcula la venta; acá solo se escribe la fila.
 */

const NO_PERMISSION = "No tenés permiso para cambiar los pagos";
const CLOSED_SALE = ["cancelled", "refunded", "subscription_cancelled"];

export type PaymentActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const uuid = z.string().uuid();
const PAYMENT_COLUMNS =
  "id, workspace_id, sale_id, type, status, amount, due_date, original_due_date, reschedule_count, paid_on, payment_method, provider_fee_amount, receipt_path, notes";

type Ctx = NonNullable<Awaited<ReturnType<typeof getPermissionAction>>>;

interface Loaded {
  ctx: Ctx;
  payment: { id: string; workspace_id: string; sale_id: string; type: string; status: string; amount: number; due_date: string | null; original_due_date: string | null; reschedule_count: number; paid_on: string | null; payment_method: string | null; provider_fee_amount: number | null; receipt_path: string | null; notes: string | null };
  sale: { id: string; workspace_id: string; contact_id: string; sale_date: string; status: string; financing_type: string; final_amount: number };
  tz: string;
  graceDays: number;
  enabledMethods: string[];
  methods: PaymentMethodDef[];
}

function settingsOf(ctx: Ctx) {
  const w = ctx.workspace as unknown as { timezone?: string; overdue_grace_days?: number | null };
  const { defs, enabledKeys } = workspaceMethods(ctx.workspace);
  return { tz: w.timezone ?? "UTC", graceDays: Number(w.overdue_grace_days) || 0, enabledMethods: enabledKeys, methods: defs };
}

async function loadPayment(paymentId: string): Promise<{ error: string } | Loaded> {
  const ctx = await getPermissionAction("payments.manage");
  if (!ctx) return { error: NO_PERMISSION };
  if (!uuid.safeParse(paymentId).success) return { error: "Los datos no son válidos" };
  const { data: payment } = await ctx.supabase.from("payments").select(PAYMENT_COLUMNS).eq("id", paymentId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!payment) return { error: "Este pago no existe o no tenés acceso" };
  const { data: sale } = await ctx.supabase.from("sales").select("id, workspace_id, contact_id, sale_date, status, financing_type, final_amount").eq("id", payment.sale_id).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!sale) return { error: "Esta venta no existe o no tenés acceso" };
  return { ctx, payment: payment as Loaded["payment"], sale: sale as Loaded["sale"], ...settingsOf(ctx) };
}

const isError = (l: { error: string } | Loaded): l is { error: string } => "error" in l;

async function writePayment(paymentId: string, workspaceId: string, expectedStatus: string, patch: object, userId: string): Promise<boolean> {
  const service = await createServiceClient();
  // Condicional sobre el estado que se leyó: dos pedidos a la vez no escriben dos veces.
  const { data, error } = await service
    .from("payments")
    .update({ ...patch, updated_by: userId } as never)
    .eq("id", paymentId)
    .eq("workspace_id", workspaceId)
    .eq("status", expectedStatus as "scheduled")
    .select("id");
  if (error) {
    console.error("[payments] no pude escribir el pago:", error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

function revalidate(saleId: string) {
  revalidatePath(`/dashboard/ventas/${saleId}`);
  revalidatePath("/dashboard/ventas");
  revalidatePath("/dashboard/ventas/pagos");
}

// ── F29: marcar cobrado ───────────────────────────────────────────────

export interface MarkPaidInput {
  paymentId: string;
  /** Lo que entró. Por defecto, el monto programado. */
  amount?: number;
  /** Fecha efectiva (local). Por defecto, hoy en la zona del workspace. */
  paidOn?: string;
  method: string;
  notes?: string | null;
}

export async function markPaymentPaid(input: MarkPaidInput): Promise<PaymentActionResult<{ partial: PartialOffer | null; overpaidBy: number }>> {
  const loaded = await loadPayment(input.paymentId);
  if (isError(loaded)) return fail(loaded.error);
  const { ctx, payment, sale, tz, graceDays, enabledMethods, methods } = loaded;
  const service = await createServiceClient();
  const result = await markPaidCore(
    { service, workspaceId: ctx.workspace.id, payment, sale, tz, graceDays, enabledMethods, methods, actor: { kind: "user", userId: ctx.user.id } },
    { amount: input.amount, paidOn: input.paidOn, method: input.method, notes: input.notes },
  );
  if (!result.ok) return fail(result.error);
  revalidate(sale.id);
  return { ok: true, partial: result.partial, overpaidBy: result.overpaidBy };
}

// ── F29: revertir un cobro (o un incobrable) ──────────────────────────

export async function revertPayment(input: { paymentId: string; reason: string }): Promise<PaymentActionResult<{ status: "scheduled" | "overdue" }>> {
  const loaded = await loadPayment(input.paymentId);
  if (isError(loaded)) return fail(loaded.error);
  const { ctx, payment, sale, tz, graceDays } = loaded;
  if (CLOSED_SALE.includes(sale.status)) return fail("Esta venta ya no admite cambios en sus pagos");

  const planned = planRevert(payment, input.reason, localToday(new Date(), tz), graceDays);
  if (!planned.ok) return fail(planned.error);

  const wasPaid = payment.status === "paid";
  const patch = { status: planned.target, revert_reason: input.reason.trim(), ...(wasPaid ? REVERT_CLEARED_FIELDS : {}) };
  const written = await writePayment(payment.id, ctx.workspace.id, payment.status, patch, ctx.user.id);
  if (!written) return fail("Este pago cambió mientras lo revertías. Recargá para verlo.");

  const service = await createServiceClient();
  await refreshContactPaymentHealth(service, ctx.workspace.id, sale.contact_id);
  await syncPaymentRelativeJobs(service, { paymentId: payment.id });
  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "payment", entityId: payment.id,
    action: wasPaid ? "payment.reverted" : "payment.restored",
    changes: diffFields({ status: payment.status }, { status: planned.target }),
    metadata: { sale_id: sale.id, reason: input.reason.trim() },
    performedBy: ctx.user.id,
  });
  revalidate(sale.id);
  return { ok: true, status: planned.target };
}

// ── Extra I, MP, F6: corregir la comisión del procesador de un cobro ──

export async function correctPaymentFee(input: { paymentId: string; feeAmount: number; reason: string }): Promise<PaymentActionResult<{ feeAmount: number }>> {
  const loaded = await loadPayment(input.paymentId);
  if (isError(loaded)) return fail(loaded.error);
  const { ctx, payment, sale } = loaded;
  if (CLOSED_SALE.includes(sale.status)) return fail("Esta venta ya no admite cambios en sus pagos");

  const planned = planFeeCorrection(payment, input);
  if (!planned.ok) return fail(planned.error);
  // Solo cambia el total; el % y el fijo quedan como registro de lo que se calculó.
  const written = await writePayment(payment.id, ctx.workspace.id, payment.status, { provider_fee_amount: planned.feeAmount }, ctx.user.id);
  if (!written) return fail("Este pago cambió mientras lo corregías. Recargá para verlo.");

  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "payment", entityId: payment.id, action: "payment.fee_corrected",
    changes: diffFields({ provider_fee_amount: payment.provider_fee_amount }, { provider_fee_amount: planned.feeAmount }),
    metadata: { sale_id: sale.id, reason: input.reason.trim() },
    performedBy: ctx.user.id,
  });
  revalidate(sale.id);
  return { ok: true, feeAmount: planned.feeAmount };
}

// ── F32: reprogramar ──────────────────────────────────────────────────

export async function reschedulePayment(input: { paymentId: string; newDate: string; reason: string }): Promise<PaymentActionResult<{ status: "scheduled" | "overdue" }>> {
  const loaded = await loadPayment(input.paymentId);
  if (isError(loaded)) return fail(loaded.error);
  const { ctx, payment, sale, tz, graceDays, enabledMethods, methods } = loaded;
  const service = await createServiceClient();
  const result = await rescheduleCore(
    { service, workspaceId: ctx.workspace.id, payment, sale, tz, graceDays, enabledMethods, methods, actor: { kind: "user", userId: ctx.user.id } },
    { newDate: input.newDate, reason: input.reason },
  );
  if (!result.ok) return fail(result.error);
  revalidate(sale.id);
  return { ok: true, status: result.status };
}

// ── F32: incobrable ───────────────────────────────────────────────────

export async function markUncollectible(input: { paymentId: string; reason: string }): Promise<PaymentActionResult> {
  const loaded = await loadPayment(input.paymentId);
  if (isError(loaded)) return fail(loaded.error);
  const { ctx, payment, sale } = loaded;
  if (CLOSED_SALE.includes(sale.status)) return fail("Esta venta ya no admite cambios en sus pagos");

  const planned = planUncollectible(payment, input.reason);
  if (!planned.ok) return fail(planned.error);
  const written = await writePayment(payment.id, ctx.workspace.id, payment.status, { status: "uncollectible", uncollectible_reason: input.reason.trim() }, ctx.user.id);
  if (!written) return fail("Este pago cambió mientras lo marcabas. Recargá para verlo.");

  const service = await createServiceClient();
  await refreshContactPaymentHealth(service, ctx.workspace.id, sale.contact_id);
  await syncPaymentRelativeJobs(service, { paymentId: payment.id });
  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "payment", entityId: payment.id, action: "payment.uncollectible",
    changes: diffFields({ status: payment.status }, { status: "uncollectible" }),
    metadata: { sale_id: sale.id, reason: input.reason.trim() },
    performedBy: ctx.user.id,
  });
  revalidate(sale.id);
  return { ok: true };
}

// ── F32: reembolso ────────────────────────────────────────────────────

/**
 * Un reembolso es una FILA NUEVA (`type 'refund'`, monto negativo, `paid`, sin comisión). El pago
 * original no cambia de estado. Si cubre todo lo cobrado, la venta pasa a `refunded` (estado
 * escrito, ANTES de crear la fila: así el trigger no la recalcula ni emite un estado intermedio) y
 * sus pagos programados y morosos se anulan; si es parcial, el saldo lo refleja y el estado se
 * sigue derivando.
 */
export async function createRefund(input: { saleId: string; amount: number; date: string; reason: string; refundOfPaymentId?: string | null }): Promise<PaymentActionResult<{ scope: "total" | "partial" }>> {
  const ctx = await getPermissionAction("payments.manage");
  if (!ctx) return fail(NO_PERMISSION);
  if (!uuid.safeParse(input.saleId).success) return fail("Los datos no son válidos");
  const { data: sale } = await ctx.supabase.from("sales").select("id, workspace_id, contact_id, sale_date, status").eq("id", input.saleId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!sale) return fail("Esta venta no existe o no tenés acceso");
  if (sale.status === "cancelled" || sale.status === "refunded") return fail("Esta venta ya está cerrada");

  const { data: payments } = await ctx.supabase.from("payments").select("id, type, status, amount").eq("sale_id", sale.id);
  const { tz } = settingsOf(ctx);
  const today = localToday(new Date(), tz);
  const planned = planRefund(input, { netPaidCents: totalPaidCents(payments ?? []), saleDate: sale.sale_date, todayLocal: today });
  if (!planned.ok) return fail(planned.error);
  if (input.refundOfPaymentId && !(payments ?? []).some((p) => p.id === input.refundOfPaymentId && p.status === "paid" && p.type !== "refund")) return fail("El pago que se reembolsa no es de esta venta");

  const service = await createServiceClient();
  const now = new Date();
  const paidAt = input.date === today ? now : wallClockToUtc(input.date, "12:00", tz);

  if (planned.total) {
    const { data: moved, error: saleError } = await service.from("sales").update({ status: "refunded", updated_by: ctx.user.id } as never).eq("id", sale.id).eq("status", sale.status).select("id");
    if (saleError || (moved ?? []).length === 0) return fail("La venta cambió mientras la reembolsabas. Recargá para verla.");
    await service.from("payments").update({ status: "cancelled", updated_by: ctx.user.id } as never).eq("sale_id", sale.id).in("status", ["scheduled", "overdue"]);
  }

  const { data: refund, error } = await service
    .from("payments")
    .insert({
      workspace_id: ctx.workspace.id, sale_id: sale.id, type: "refund", amount: -planned.amountCents / 100, status: "paid",
      due_date: input.date, original_due_date: input.date, paid_at: paidAt.toISOString(), paid_on: input.date,
      provider_fee_amount: null, refund_reason: input.reason.trim(), refund_of_payment_id: input.refundOfPaymentId ?? null,
      created_by: ctx.user.id, updated_by: ctx.user.id,
    } as never)
    .select("id")
    .single();
  if (error || !refund) {
    console.error("[payments] no pude crear el reembolso:", error?.message);
    // Vuelve atrás lo único que ya se escribió.
    if (planned.total) await service.from("sales").update({ status: sale.status, updated_by: ctx.user.id } as never).eq("id", sale.id).eq("status", "refunded");
    return fail("No pude registrar el reembolso");
  }

  await refreshContactPaymentHealth(service, ctx.workspace.id, sale.contact_id);
  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "payment", entityId: refund.id, action: "payment.refund",
    metadata: { sale_id: sale.id, amount: -planned.amountCents / 100, scope: planned.scope, reason: input.reason.trim() as Json },
    performedBy: ctx.user.id,
  });
  if (planned.total) {
    await logAudit({
      supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "sale", entityId: sale.id, action: "sale.refunded",
      changes: diffFields({ status: sale.status }, { status: "refunded" }), metadata: { reason: input.reason.trim() }, performedBy: ctx.user.id,
    });
  }
  revalidate(sale.id);
  return { ok: true, scope: planned.scope };
}

// ── F28: agregar un pago a mano ───────────────────────────────────────

/** Una cuota a mano (p. ej. la diferencia de un cobro parcial). Nace programada. */
export async function addPayment(input: { saleId: string; amount: number; dueDate: string; method?: string | null }): Promise<PaymentActionResult<{ id: string }>> {
  const ctx = await getPermissionAction("payments.manage");
  if (!ctx) return fail(NO_PERMISSION);
  if (!uuid.safeParse(input.saleId).success) return fail("Los datos no son válidos");
  const { data: sale } = await ctx.supabase.from("sales").select("id, status").eq("id", input.saleId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!sale) return fail("Esta venta no existe o no tenés acceso");
  if (CLOSED_SALE.includes(sale.status)) return fail("Esta venta ya no admite pagos nuevos");

  const { enabledMethods, methods } = settingsOf(ctx);
  const planned = planAddPayment(input, enabledMethods, methods);
  if (!planned.ok) return fail(planned.error);

  const service = await createServiceClient();
  const { data, error } = await service
    .from("payments")
    .insert({
      workspace_id: ctx.workspace.id, sale_id: sale.id, type: "installment", amount: planned.amount, status: "scheduled",
      due_date: input.dueDate, original_due_date: input.dueDate, payment_method: input.method ?? null, created_by: ctx.user.id, updated_by: ctx.user.id,
    } as never)
    .select("id")
    .single();
  if (error || !data) {
    console.error("[payments] no pude agregar el pago:", error?.message);
    return fail("No pude agregar el pago");
  }
  await syncPaymentRelativeJobs(service, { paymentId: data.id });
  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "payment", entityId: data.id, action: "payment.created",
    metadata: { sale_id: sale.id, amount: planned.amount, due_date: input.dueDate }, performedBy: ctx.user.id,
  });
  revalidate(sale.id);
  return { ok: true, id: data.id };
}

// ── F27: comprobantes ─────────────────────────────────────────────────

/** Sube el comprobante (campos `paymentId` y `file`). Valida por los BYTES y el tope de 10 MB. */
export async function uploadPaymentReceipt(formData: FormData): Promise<PaymentActionResult<{ path: string }>> {
  const loaded = await loadPayment(String(formData.get("paymentId") ?? ""));
  if (isError(loaded)) return fail(loaded.error);
  const { ctx, payment, sale } = loaded;
  if (payment.type === "refund") return fail("Un reembolso no lleva comprobante");

  const file = formData.get("file");
  if (!(file instanceof File)) return fail("Elegí un archivo");
  if (file.size > RECEIPT_MAX_BYTES) return fail("El comprobante pesa más de 10 MB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = checkReceipt(bytes);
  if (!checked.ok) return fail(checked.error);

  const path = receiptPath({ workspaceId: ctx.workspace.id, saleId: sale.id, paymentId: payment.id, fileId: randomUUID(), ext: checked.ext });
  const service = await createServiceClient();
  const { error: uploadError } = await service.storage.from(RECEIPT_BUCKET).upload(path, bytes, { contentType: checked.mime, upsert: false });
  if (uploadError) {
    console.error("[payments] no pude subir el comprobante:", uploadError.message);
    return fail("No pude subir el comprobante. Probá de nuevo.");
  }
  const { error } = await service.from("payments").update({ receipt_path: path, updated_by: ctx.user.id } as never).eq("id", payment.id).eq("workspace_id", ctx.workspace.id);
  if (error) {
    await service.storage.from(RECEIPT_BUCKET).remove([path]);
    return fail("No pude guardar el comprobante");
  }
  // El anterior se borra: no queda un archivo huérfano.
  if (payment.receipt_path && receiptPathBelongsTo(payment.receipt_path, { workspaceId: ctx.workspace.id, saleId: sale.id, paymentId: payment.id })) {
    await service.storage.from(RECEIPT_BUCKET).remove([payment.receipt_path]);
  }
  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "payment", entityId: payment.id, action: "payment.receipt_uploaded",
    metadata: { sale_id: sale.id, mime: checked.mime }, performedBy: ctx.user.id,
  });
  revalidate(sale.id);
  return { ok: true, path };
}

/** El link del comprobante: 60 segundos, y solo si quien pide VE la venta (la RLS decide). */
export async function getPaymentReceiptUrl(input: { paymentId: string }): Promise<PaymentActionResult<{ url: string }>> {
  const ctx = await getPermissionAction("sales.view");
  if (!ctx) return fail("No tenés permiso para ver las ventas");
  if (!uuid.safeParse(input.paymentId).success) return fail("Los datos no son válidos");
  const { data: payment } = await ctx.supabase.from("payments").select("id, sale_id, receipt_path").eq("id", input.paymentId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!payment || !receiptPathBelongsTo(payment.receipt_path, { workspaceId: ctx.workspace.id, saleId: payment.sale_id, paymentId: payment.id })) return fail("No encontré ese comprobante");
  const service = await createServiceClient();
  const { data, error } = await service.storage.from(RECEIPT_BUCKET).createSignedUrl(payment.receipt_path as string, RECEIPT_SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) {
    console.error("[payments] no pude firmar el comprobante");
    return fail("No pudimos abrir el comprobante. Probá de nuevo.");
  }
  return { ok: true, url: data.signedUrl };
}
