"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPermissionAction } from "@/lib/auth/guards";
import { diffFields, logAudit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { financeContextOf, memberBelongs, vendorBelongs, UUID_RE } from "@/lib/finance/context";
import { planCreateExpense, planPayExpense, planRevertExpense, planUpdateExpense, planVoidExpense, type ExpenseRowLite } from "@/lib/finance/expense-rules";
import { EXPENSE_RECEIPT_BUCKET, RECEIPT_SIGNED_URL_SECONDS, checkExpenseReceipt, receiptPath, receiptPathBelongsTo } from "@/lib/finance/receipts";
import type { Json } from "@/lib/types/database";

/**
 * Gastos (GF7 a GF10): alta, edición, pagar, revertir, anular y comprobante.
 *
 * Quién escribe: la SESIÓN de quien pide, DESPUÉS de `getPermissionAction("expenses.manage")`. La RLS y los
 * triggers de la base (`expenses_guard`) son la segunda barrera. El cliente no decide estados: el servidor calcula
 * `unpaidStatusFor` con su reloj y la zona del workspace. Los ids de proveedor y responsable se verifican contra el
 * workspace de la sesión.
 */

const NO_PERMISSION = "No tenés permiso para cambiar los gastos";
const NO_VIEW = "No tenés permiso para ver los gastos";

export type FinanceActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const uuid = z.string().regex(UUID_RE);
const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const createSchema = z.object({
  concept: z.string().max(400),
  vendorId: uuid.nullable().optional(),
  categoryKey: z.string().min(1).max(60),
  amount: z.union([z.number(), z.string()]).nullable().optional(),
  amountToConfirm: z.boolean().optional(),
  scheduledDate: dateText,
  responsibleId: uuid.nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  paid: z.boolean().optional(),
  paidDate: dateText.nullable().optional(),
});

const updateSchema = z.object({
  concept: z.string().max(400),
  vendorId: uuid.nullable().optional(),
  categoryKey: z.string().min(1).max(60),
  amount: z.union([z.number(), z.string()]).nullable().optional(),
  scheduledDate: dateText,
  responsibleId: uuid.nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

const EXPENSE_COLUMNS =
  "id, workspace_id, concept, vendor_id, category_key, amount, status, scheduled_date, paid_date, origin, responsible_id, notes, receipt_path, receipt_name, recurring_expense_id, adjusts_expense_id, updated_at";

type ExpenseRow = ExpenseRowLite & { id: string; workspace_id: string; receipt_path: string | null; receipt_name: string | null; updated_at: string };

function revalidate(id?: string) {
  revalidatePath("/dashboard/finanzas");
  revalidatePath("/dashboard/finanzas/gastos");
  if (id) revalidatePath(`/dashboard/finanzas/gastos/${id}`);
}

async function loadExpense(ctx: NonNullable<Awaited<ReturnType<typeof getPermissionAction>>>, id: string): Promise<ExpenseRow | null> {
  if (!UUID_RE.test(id)) return null;
  const { data } = await ctx.supabase.from("expenses").select(EXPENSE_COLUMNS).eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle();
  return (data as unknown as ExpenseRow | null) ?? null;
}

async function checkRefs(ctx: NonNullable<Awaited<ReturnType<typeof getPermissionAction>>>, vendorId: string | null | undefined, responsibleId: string | null | undefined): Promise<string | null> {
  if (!(await vendorBelongs(ctx, vendorId))) return "Ese proveedor no existe";
  if (!(await memberBelongs(ctx, responsibleId))) return "Esa persona no es del equipo";
  return null;
}

// ── Alta ──────────────────────────────────────────────────────────────

export async function createExpense(input: unknown): Promise<FinanceActionResult<{ id: string; highAmount: boolean }>> {
  const ctx = await getPermissionAction("expenses.manage");
  if (!ctx) return fail(NO_PERMISSION);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail("Los datos no son válidos");
  const f = financeContextOf(ctx);

  const planned = planCreateExpense(parsed.data, { todayLocal: f.todayLocal, categories: f.settings.expense_categories });
  if (!planned.ok) return fail(planned.error);
  const refsError = await checkRefs(ctx, parsed.data.vendorId, parsed.data.responsibleId);
  if (refsError) return fail(refsError);

  const { data, error } = await ctx.supabase
    .from("expenses")
    .insert({
      workspace_id: ctx.workspace.id,
      ...planned.row,
      paid_by: planned.row.status === "pagado" ? ctx.user.id : null,
      created_by: ctx.user.id,
      updated_by: ctx.user.id,
    } as never)
    .select("id")
    .single();
  if (error || !data) {
    console.error("[finance] no pude crear el gasto:", error?.message);
    return fail("No pude guardar el gasto");
  }
  const id = (data as { id: string }).id;
  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "expense", entityId: id, action: "expense.created",
    changes: diffFields({}, { concept: planned.row.concept, amount: planned.row.amount, status: planned.row.status, category_key: planned.row.category_key, scheduled_date: planned.row.scheduled_date }),
    metadata: { origin: "manual" }, performedBy: ctx.user.id,
  });
  revalidate(id);
  return { ok: true, id, highAmount: planned.highAmount };
}

// ── Edición ───────────────────────────────────────────────────────────

export async function updateExpense(id: string, input: unknown, expectedUpdatedAt?: string | null): Promise<FinanceActionResult<{ highAmount: boolean }>> {
  const ctx = await getPermissionAction("expenses.manage");
  if (!ctx) return fail(NO_PERMISSION);
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return fail("Los datos no son válidos");
  const existing = await loadExpense(ctx, id);
  if (!existing) return fail("Este gasto no existe");
  if (expectedUpdatedAt && existing.updated_at !== expectedUpdatedAt) return fail("Alguien cambió este gasto mientras lo editabas. Recargá para ver lo último.");
  const f = financeContextOf(ctx);

  const planned = planUpdateExpense(existing, parsed.data, { todayLocal: f.todayLocal, categories: f.settings.expense_categories });
  if (!planned.ok) return fail(planned.error);
  const refsError = await checkRefs(ctx, parsed.data.vendorId, parsed.data.responsibleId);
  if (refsError) return fail(refsError);

  const { data, error } = await ctx.supabase
    .from("expenses")
    .update({ ...planned.patch, updated_by: ctx.user.id } as never)
    .eq("id", id).eq("workspace_id", ctx.workspace.id).eq("status", existing.status as "programado")
    .select("id");
  if (error) {
    console.error("[finance] no pude editar el gasto:", error.message);
    return fail("No pude guardar el cambio");
  }
  if ((data ?? []).length === 0) return fail("Este gasto cambió mientras lo editabas. Recargá para verlo.");

  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "expense", entityId: id, action: "expense.updated",
    changes: diffFields(
      { concept: existing.concept, vendor_id: existing.vendor_id, category_key: existing.category_key, amount: existing.amount, scheduled_date: existing.scheduled_date, responsible_id: existing.responsible_id, notes: existing.notes, status: existing.status },
      { ...planned.patch },
    ),
    performedBy: ctx.user.id,
  });
  revalidate(id);
  return { ok: true, highAmount: planned.highAmount };
}

// ── Pagar / revertir / anular ─────────────────────────────────────────

const paySchema = z.object({ paidDate: dateText.nullable().optional(), amount: z.union([z.number(), z.string()]).nullable().optional() });

export async function markExpensePaid(id: string, input: unknown): Promise<FinanceActionResult<object>> {
  const ctx = await getPermissionAction("expenses.manage");
  if (!ctx) return fail(NO_PERMISSION);
  const parsed = paySchema.safeParse(input ?? {});
  if (!parsed.success) return fail("Los datos no son válidos");
  const existing = await loadExpense(ctx, id);
  if (!existing) return fail("Este gasto no existe");
  const f = financeContextOf(ctx);

  const planned = planPayExpense(existing, parsed.data, { todayLocal: f.todayLocal, categories: f.settings.expense_categories });
  if (!planned.ok) {
    revalidate(id);
    return fail(planned.error);
  }
  const { data, error } = await ctx.supabase
    .from("expenses")
    .update({ ...planned.patch, paid_by: ctx.user.id, updated_by: ctx.user.id } as never)
    .eq("id", id).eq("workspace_id", ctx.workspace.id).eq("status", existing.status as "programado")
    .select("id");
  if (error) {
    console.error("[finance] no pude marcar el gasto como pagado:", error.message);
    return fail("No pude guardar el cambio");
  }
  if ((data ?? []).length === 0) return fail("Este gasto cambió mientras lo pagabas. Recargá para verlo.");
  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "expense", entityId: id, action: "expense.paid",
    changes: diffFields({ status: existing.status, amount: existing.amount }, { status: "pagado", amount: planned.patch.amount }),
    metadata: { paid_date: planned.patch.paid_date }, performedBy: ctx.user.id,
  });
  revalidate(id);
  return { ok: true };
}

export async function revertExpensePayment(id: string, reason: string): Promise<FinanceActionResult<{ status: "programado" | "vencido" }>> {
  const ctx = await getPermissionAction("expenses.manage");
  if (!ctx) return fail(NO_PERMISSION);
  const existing = await loadExpense(ctx, id);
  if (!existing) return fail("Este gasto no existe");
  const f = financeContextOf(ctx);
  const planned = planRevertExpense(existing, reason, { todayLocal: f.todayLocal, categories: f.settings.expense_categories });
  if (!planned.ok) return fail(planned.error);

  const { data, error } = await ctx.supabase
    .from("expenses")
    .update({ status: planned.target, paid_date: null, paid_by: null, updated_by: ctx.user.id } as never)
    .eq("id", id).eq("workspace_id", ctx.workspace.id).eq("status", "pagado")
    .select("id");
  if (error) {
    console.error("[finance] no pude revertir el pago:", error.message);
    return fail("No pude guardar el cambio");
  }
  if ((data ?? []).length === 0) return fail("Este gasto cambió mientras lo revertías. Recargá para verlo.");
  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "expense", entityId: id, action: "expense.payment_reverted",
    changes: diffFields({ status: "pagado", paid_date: existing.paid_date }, { status: planned.target, paid_date: null }),
    metadata: { reason: reason.trim() }, performedBy: ctx.user.id,
  });
  revalidate(id);
  return { ok: true, status: planned.target };
}

export async function voidExpense(id: string, reason: string): Promise<FinanceActionResult<object>> {
  const ctx = await getPermissionAction("expenses.manage");
  if (!ctx) return fail(NO_PERMISSION);
  const existing = await loadExpense(ctx, id);
  if (!existing) return fail("Este gasto no existe");
  const planned = planVoidExpense(existing, reason);
  if (!planned.ok) return fail(planned.error);

  const { data, error } = await ctx.supabase
    .from("expenses")
    .update({ status: "anulado", void_reason: planned.reason, void_kind: "manual", voided_at: new Date().toISOString(), voided_by: ctx.user.id, updated_by: ctx.user.id } as never)
    .eq("id", id).eq("workspace_id", ctx.workspace.id).eq("status", existing.status as "programado")
    .select("id");
  if (error) {
    console.error("[finance] no pude anular el gasto:", error.message);
    return fail("No pude guardar el cambio");
  }
  if ((data ?? []).length === 0) return fail("Este gasto cambió mientras lo anulabas. Recargá para verlo.");
  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "expense", entityId: id, action: "expense.voided",
    changes: diffFields({ status: existing.status }, { status: "anulado" }),
    metadata: { reason: planned.reason }, performedBy: ctx.user.id,
  });
  revalidate(id);
  return { ok: true };
}

// ── Comprobante ───────────────────────────────────────────────────────

/** Sube el comprobante (campos `expenseId` y `file`). Valida por los BYTES y el tope de 10 MB. Reemplazar NO borra el anterior. */
export async function uploadExpenseReceipt(formData: FormData): Promise<FinanceActionResult<{ path: string }>> {
  const ctx = await getPermissionAction("expenses.manage");
  if (!ctx) return fail(NO_PERMISSION);
  const expenseId = String(formData.get("expenseId") ?? "");
  const file = formData.get("file");
  if (!UUID_RE.test(expenseId) || !(file instanceof File)) return fail("Los datos no son válidos");
  const existing = await loadExpense(ctx, expenseId);
  if (!existing) return fail("Este gasto no existe");
  if (existing.status === "anulado") return fail("Un gasto anulado no se edita");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = checkExpenseReceipt(bytes, file.type);
  if (!checked.ok) return fail(checked.error);

  const path = receiptPath({ workspaceId: ctx.workspace.id, expenseId, fileId: randomUUID(), ext: checked.ext });
  const service = await createServiceClient();
  const { error: upError } = await service.storage.from(EXPENSE_RECEIPT_BUCKET).upload(path, bytes, { contentType: checked.mime, upsert: false });
  if (upError) {
    console.error("[finance] no pude subir el comprobante:", upError.message);
    return fail("No pude subir el comprobante");
  }
  const name = file.name.replace(/[\r\n]/g, " ").slice(0, 200) || `comprobante.${checked.ext}`;
  const { error } = await ctx.supabase
    .from("expenses")
    .update({ receipt_path: path, receipt_name: name, updated_by: ctx.user.id } as never)
    .eq("id", expenseId).eq("workspace_id", ctx.workspace.id);
  if (error) {
    console.error("[finance] no pude guardar el comprobante:", error.message);
    return fail("No pude guardar el comprobante");
  }
  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "expense", entityId: expenseId, action: "expense.receipt_uploaded",
    changes: diffFields({ receipt_path: existing.receipt_path }, { receipt_path: path }),
    metadata: { name, previous_path: existing.receipt_path ?? null }, performedBy: ctx.user.id,
  });
  revalidate(expenseId);
  return { ok: true, path };
}

/** Quitar deja la columna en null; el archivo queda en el bucket (permanente mientras exista el gasto). */
export async function removeExpenseReceipt(expenseId: string): Promise<FinanceActionResult<object>> {
  const ctx = await getPermissionAction("expenses.manage");
  if (!ctx) return fail(NO_PERMISSION);
  const existing = await loadExpense(ctx, expenseId);
  if (!existing) return fail("Este gasto no existe");
  if (existing.status === "anulado") return fail("Un gasto anulado no se edita");
  if (!existing.receipt_path) return { ok: true };
  const { error } = await ctx.supabase.from("expenses").update({ receipt_path: null, receipt_name: null, updated_by: ctx.user.id } as never).eq("id", expenseId).eq("workspace_id", ctx.workspace.id);
  if (error) return fail("No pude guardar el cambio");
  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "expense", entityId: expenseId, action: "expense.receipt_removed",
    metadata: { previous_path: existing.receipt_path as unknown as Json }, performedBy: ctx.user.id,
  });
  revalidate(expenseId);
  return { ok: true };
}

/** URL firmada de 60 s, generada con el servicio DESPUÉS de comprobar `expenses.view` y que el path cuelgue del gasto. */
export async function getExpenseReceiptUrl(expenseId: string): Promise<FinanceActionResult<{ url: string }>> {
  const ctx = await getPermissionAction("expenses.view");
  if (!ctx) return fail(NO_VIEW);
  if (!UUID_RE.test(expenseId)) return fail("Los datos no son válidos");
  const { data } = await ctx.supabase.from("expenses").select("id, receipt_path").eq("id", expenseId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  const path = (data as { receipt_path: string | null } | null)?.receipt_path;
  if (!path || !receiptPathBelongsTo(path, { workspaceId: ctx.workspace.id, expenseId })) return fail("Este gasto no tiene comprobante");
  const service = await createServiceClient();
  const { data: signed, error } = await service.storage.from(EXPENSE_RECEIPT_BUCKET).createSignedUrl(path, RECEIPT_SIGNED_URL_SECONDS);
  if (error || !signed) return fail("No pude abrir el comprobante");
  return { ok: true, url: signed.signedUrl };
}
