"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPermissionAction } from "@/lib/auth/guards";
import { diffFields, logAudit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { addDays, isDateOnly } from "@/lib/finance/dates";
import { financeContextOf } from "@/lib/finance/context";
import { fromCents, toCents } from "@/lib/shared/money";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import type { Json } from "@/lib/types/database";
import { commissionAdjustmentSchema, refundSuggestion } from "@/lib/commissions/adjustment";
import type { CommissionActionResult, PayoutExcluded, PayoutExpense, PayoutResult, RefundSuggestionResult, RefundSuggestionRow } from "@/lib/commissions/action-types";
import { commissionDbError } from "@/lib/commissions/errors";
import { EXCLUDED_MESSAGES, type ExcludedCode } from "@/lib/commissions/selection";
import { missingMembers, missingRows, readCommissionSettings } from "@/lib/commissions/server-refs";

/**
 * Acciones sobre las comisiones (Extra I, F60 a F64).
 *
 * Quién escribe: el cliente de SERVICIO (`commissions` es de solo lectura para la app, y la base lo exige: CM003),
 * DESPUÉS de comprobar el permiso de cada acción y siempre filtrando por el workspace de la SESIÓN. Las personas,
 * ventas y pagos que manda el cliente se comprueban contra ese workspace. Todo lo que cambia queda en `audit_log`.
 *
 *   Liquidar (convertir en gastos)   commissions.manage Y expenses.manage
 *   Asignar persona / anular / ajustar / sugerir por reembolso   commissions.manage
 */

const NO_PERMISSION = "No tenés permiso para administrar las comisiones";
const NO_PAYOUT_PERMISSION = "Para generar un gasto de comisiones necesitás poder administrar las comisiones y los gastos";
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const UUID = z.uuid();

function revalidate(extra: readonly string[] = []) {
  revalidatePath("/dashboard/finanzas/comisiones", "layout");
  for (const path of extra) revalidatePath(path);
}

type CommissionRow = {
  id: string;
  kind: "earned" | "adjustment";
  role: string | null;
  user_id: string | null;
  payment_id: string | null;
  sale_id: string | null;
  amount: unknown;
  expense_id: string | null;
  voided_at: string | null;
};

const COMMISSION_COLUMNS = "id, kind, role, user_id, payment_id, sale_id, amount, expense_id, voided_at";

async function chunkedAudit(tasks: Array<() => Promise<unknown>>, size = 20): Promise<void> {
  for (let i = 0; i < tasks.length; i += size) await Promise.all(tasks.slice(i, i + size).map((run) => run()));
}

// ── Generar el gasto de una liquidación (F60) ──────────────────────────

const payoutSchema = z.object({
  ids: z.array(UUID).min(1, "Elegí al menos una comisión").max(500, "Hasta 500 comisiones por vez"),
  mode: z.enum(["per_person", "single"]),
  scheduledDate: z.string().refine(isDateOnly, "La fecha programada no es válida"),
  /** `{ [userId]: concepto }` en el modo por persona, `{ single: concepto }` en el otro. Lo vacío usa el concepto de siempre. */
  concepts: z.record(z.string().regex(/^(single|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i), z.string().max(200, "El concepto puede tener hasta 200 caracteres")).default({}),
  notes: z.string().trim().max(2000, "Las notas pueden tener hasta 2000 caracteres").nullish(),
});

/**
 * Convierte comisiones en gastos de liquidación (uno por persona, o uno solo). La base vuelve a excluir lo que no
 * corresponde con las comisiones bloqueadas (anuladas, sin persona, ya en un gasto, retenidas): acá se devuelve por
 * qué, en palabras. Necesita los DOS permisos: crea gastos.
 */
export async function generateCommissionPayout(input: unknown): Promise<CommissionActionResult<PayoutResult>> {
  const ctx = await getPermissionAction("commissions.manage");
  if (!ctx) return fail(NO_PAYOUT_PERMISSION);
  if (!(await getPermissionAction("expenses.manage"))) return fail(NO_PAYOUT_PERMISSION);
  const parsed = payoutSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Los datos no son válidos");
  const { ids, mode, scheduledDate, concepts, notes } = parsed.data;
  const ws = ctx.workspace.id;
  const todayLocal = financeContextOf(ctx).todayLocal;
  if (scheduledDate < addDays(todayLocal, -60)) return fail("La fecha programada no puede ser anterior a hace 60 días");

  const service = await createServiceClient();
  const { data, error } = await service.rpc("create_commission_payout", {
    p_workspace: ws,
    p_commission_ids: [...new Set(ids)],
    p_mode: mode,
    p_scheduled_date: scheduledDate,
    p_concepts: concepts as unknown as Json,
    p_notes: notes?.trim() ? notes.trim() : null,
    p_actor: ctx.user.id,
    p_today: todayLocal,
  });
  if (error || !data) {
    console.error("[comisiones] no pude generar el gasto:", error?.message);
    return fail(commissionDbError(error, "No pude generar el gasto"));
  }

  const result = data as { expenses?: Array<{ id: string; user_id: string | null; amount: unknown; count: number; commission_ids: string[] }>; excluded?: Array<{ id: string; reason: string }> };
  const expenses: PayoutExpense[] = (result.expenses ?? []).map((e) => ({
    id: e.id,
    userId: e.user_id ?? null,
    amountCents: toCents(e.amount),
    count: Number(e.count) || (e.commission_ids ?? []).length,
    commissionIds: e.commission_ids ?? [],
  }));
  const excluded: PayoutExcluded[] = (result.excluded ?? []).map((e) => ({
    id: e.id,
    reason: e.reason as ExcludedCode | "not_found",
    message: e.reason === "not_found" ? "No existe" : EXCLUDED_MESSAGES[e.reason as ExcludedCode] ?? "No se pudo incluir",
  }));

  // El historial: un renglón por gasto creado y uno por cada comisión que entró. Nunca frena el resultado.
  try {
    const { data: created } = expenses.length
      ? await service.from("expenses").select("id, concept, status, scheduled_date").eq("workspace_id", ws).in("id", expenses.map((e) => e.id))
      : { data: [] };
    const byId = new Map(((created ?? []) as Array<{ id: string; concept: string; status: string; scheduled_date: string }>).map((e) => [e.id, e]));
    const audits: Array<() => Promise<unknown>> = [];
    for (const expense of expenses) {
      const row = byId.get(expense.id);
      audits.push(() =>
        logAudit({
          supabase: ctx.supabase, workspaceId: ws, entityType: "expense", entityId: expense.id, action: "expense.created",
          changes: diffFields({}, { concept: row?.concept, amount: fromCents(expense.amountCents), status: row?.status, category_key: "commissions", scheduled_date: row?.scheduled_date ?? scheduledDate }),
          metadata: { origin: "commission_payout", mode, commission_ids: expense.commissionIds, count: expense.count, user_id: expense.userId },
          performedBy: ctx.user.id,
        }),
      );
      for (const commissionId of expense.commissionIds) {
        audits.push(() =>
          logAudit({
            supabase: ctx.supabase, workspaceId: ws, entityType: "commission", entityId: commissionId, action: "commission.payout_assigned",
            changes: { expense_id: { old: null, new: expense.id } }, metadata: { expense_id: expense.id, mode }, performedBy: ctx.user.id,
          }),
        );
      }
    }
    await chunkedAudit(audits);
  } catch (e) {
    console.error("[comisiones] no pude escribir el historial de la liquidación:", e instanceof Error ? e.message : String(e));
  }

  revalidate(["/dashboard/finanzas/gastos", "/dashboard/finanzas"]);
  return { ok: true, expenses, excluded };
}

// ── Asignar persona (F62) ──────────────────────────────────────────────

async function loadCommission(service: Awaited<ReturnType<typeof createServiceClient>>, workspaceId: string, id: string): Promise<CommissionRow | null> {
  if (!UUID.safeParse(id).success) return null;
  const { data } = await service.from("commissions").select(COMMISSION_COLUMNS).eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
  return (data as unknown as CommissionRow | null) ?? null;
}

/** A una comisión «Sin persona» (no anulada y sin gasto) se le pone la persona a la que se le debe. */
export async function assignCommissionPerson(id: string, userId: string): Promise<CommissionActionResult> {
  const ctx = await getPermissionAction("commissions.manage");
  if (!ctx) return fail(NO_PERMISSION);
  if (!UUID.safeParse(userId).success) return fail("Elegí una persona");
  const service = await createServiceClient();
  const existing = await loadCommission(service, ctx.workspace.id, id);
  if (!existing) return fail("Esa comisión no existe");
  if (existing.voided_at) return fail("Esa comisión está anulada");
  if (existing.expense_id) return fail("Esa comisión ya está en un gasto");
  if (existing.user_id) return fail("Esa comisión ya tiene persona");
  if ((await missingMembers(ctx.workspace.id, [userId])).length) return fail("Esa persona no es del equipo");

  const { data, error } = await service
    .from("commissions")
    .update({ user_id: userId } as never)
    .eq("id", id)
    .eq("workspace_id", ctx.workspace.id)
    .is("user_id", null)
    .is("voided_at", null)
    .is("expense_id", null)
    .select("id");
  if (error) {
    console.error("[comisiones] no pude asignar la persona:", error.message);
    return fail(commissionDbError(error, "No pude asignar la persona"));
  }
  if ((data ?? []).length === 0) return fail("Esta comisión cambió mientras la asignabas. Recargá para verla.");

  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "commission", entityId: id, action: "commission.person_assigned",
    changes: { user_id: { old: null, new: userId } }, metadata: { role: existing.role, sale_id: existing.sale_id, payment_id: existing.payment_id }, performedBy: ctx.user.id,
  });
  revalidate();
  return { ok: true };
}

// ── Anular (F63) ───────────────────────────────────────────────────────

/** Anula una comisión Pendiente, Retenida o Sin persona, con un motivo. Una que está en un gasto (o pagada) no se anula: se anula el gasto. */
export async function voidCommission(id: string, reason: string): Promise<CommissionActionResult> {
  const ctx = await getPermissionAction("commissions.manage");
  if (!ctx) return fail(NO_PERMISSION);
  const text = typeof reason === "string" ? reason.trim() : "";
  if (!text) return fail("Contá por qué la anulás");
  if (text.length > 500) return fail("El motivo puede tener hasta 500 caracteres");
  const service = await createServiceClient();
  const existing = await loadCommission(service, ctx.workspace.id, id);
  if (!existing) return fail("Esa comisión no existe");
  if (existing.voided_at) return fail("Esa comisión ya está anulada");
  if (existing.expense_id) return fail("Esa comisión ya está en un gasto: para anularla, anulá primero el gasto");

  const { data, error } = await service
    .from("commissions")
    .update({ voided_at: new Date().toISOString(), voided_by: ctx.user.id, void_reason: text } as never)
    .eq("id", id)
    .eq("workspace_id", ctx.workspace.id)
    .is("voided_at", null)
    .is("expense_id", null)
    .select("id");
  if (error) {
    console.error("[comisiones] no pude anular la comisión:", error.message);
    return fail(commissionDbError(error, "No pude anular la comisión"));
  }
  if ((data ?? []).length === 0) return fail("Esta comisión cambió mientras la anulabas. Recargá para verla.");

  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "commission", entityId: id, action: "commission.voided",
    changes: { void_reason: { old: null, new: text } },
    metadata: { role: existing.role, amount_cents: toCents(existing.amount), payment_id: existing.payment_id, sale_id: existing.sale_id }, performedBy: ctx.user.id,
  });
  revalidate();
  return { ok: true };
}

// ── Ajustes (F64) ──────────────────────────────────────────────────────

/** Un ajuste a mano (puede restar). Sin regla; se puede liquidar enseguida. */
export async function createCommissionAdjustment(input: unknown): Promise<CommissionActionResult<{ id: string }>> {
  const ctx = await getPermissionAction("commissions.manage");
  if (!ctx) return fail(NO_PERMISSION);
  const parsed = commissionAdjustmentSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Los datos no son válidos");
  const adj = parsed.data;
  const ws = ctx.workspace.id;
  const service = await createServiceClient();

  if ((await missingMembers(ws, [adj.userId])).length) return fail("Esa persona no es del equipo");
  if ((await missingRows(service, "sales", ws, [adj.saleId])).length) return fail("Esa venta no existe");
  let saleId = adj.saleId;
  if (adj.paymentId) {
    const { data } = await service.from("payments").select("id, sale_id").eq("id", adj.paymentId).eq("workspace_id", ws).maybeSingle();
    const payment = data as { id: string; sale_id: string } | null;
    if (!payment) return fail("Ese pago no existe");
    if (saleId && payment.sale_id !== saleId) return fail("Ese pago no es de esa venta");
    saleId = payment.sale_id;
  }
  if (adj.role) {
    const settings = await readCommissionSettings(service, ws);
    if (!settings) return fail("No pude guardar el ajuste");
    if (!settings.roles.some((r) => r.key === adj.role)) return fail("Ese rol no existe");
  }

  const today = financeContextOf(ctx).todayLocal;
  const { data, error } = await service
    .from("commissions")
    .insert({
      workspace_id: ws, kind: "adjustment", role: adj.role, user_id: adj.userId, payment_id: adj.paymentId, sale_id: saleId, rule_id: null,
      amount: fromCents(adj.amountCents), paid_on: today, available_on: today, notes: adj.notes, created_by: ctx.user.id,
    } as never)
    .select("id")
    .single();
  if (error || !data) {
    console.error("[comisiones] no pude crear el ajuste:", error?.message);
    return fail(commissionDbError(error, "No pude guardar el ajuste"));
  }
  const id = (data as { id: string }).id;
  await logAudit({
    supabase: ctx.supabase, workspaceId: ws, entityType: "commission", entityId: id, action: "commission.adjustment_created",
    changes: diffFields({}, { amount: fromCents(adj.amountCents), user_id: adj.userId, role: adj.role, notes: adj.notes }),
    metadata: { sale_id: saleId, payment_id: adj.paymentId }, performedBy: ctx.user.id,
  });
  revalidate();
  return { ok: true, id };
}

/**
 * Por un reembolso: qué ajuste sugiere el sistema para cada persona que cobró comisión por el pago original
 * (`refundSuggestion` de cada persona, proporcional a lo reembolsado). NO CREA NADA: la persona decide y carga el ajuste.
 */
export async function suggestRefundAdjustments(paymentId: string): Promise<CommissionActionResult<RefundSuggestionResult>> {
  const ctx = await getPermissionAction("commissions.manage");
  if (!ctx) return fail(NO_PERMISSION);
  if (!UUID.safeParse(paymentId).success) return fail("Ese pago no existe");
  const ws = ctx.workspace.id;
  const service = await createServiceClient();

  const { data: refundRow } = await service.from("payments").select("id, sale_id, type, amount, refund_of_payment_id").eq("id", paymentId).eq("workspace_id", ws).maybeSingle();
  const refund = refundRow as { id: string; sale_id: string; type: string; amount: unknown; refund_of_payment_id: string | null } | null;
  if (!refund) return fail("Ese pago no existe");
  if (refund.type !== "refund") return fail("Ese pago no es un reembolso");
  if (!refund.refund_of_payment_id) return fail("Este reembolso no dice de qué pago salió");

  const { data: originalRow } = await service.from("payments").select("id, amount").eq("id", refund.refund_of_payment_id).eq("workspace_id", ws).maybeSingle();
  const original = originalRow as { id: string; amount: unknown } | null;
  if (!original) return fail("No encuentro el pago original del reembolso");

  const refundedCents = Math.abs(toCents(refund.amount));
  const paidCents = Math.abs(toCents(original.amount));

  const { data: earnedRows } = await service
    .from("commissions")
    .select("id, role, user_id, amount")
    .eq("workspace_id", ws)
    .eq("payment_id", original.id)
    .eq("kind", "earned")
    .is("voided_at", null);
  const { data: adjustedRows } = await service
    .from("commissions")
    .select("user_id, amount")
    .eq("workspace_id", ws)
    .eq("payment_id", refund.id)
    .eq("kind", "adjustment")
    .is("voided_at", null);

  const members = new Map((await getWorkspaceMembers(ws)).map((m) => [m.userId, m.name]));
  const adjusted = new Map<string, number>();
  for (const row of (adjustedRows ?? []) as Array<{ user_id: string | null; amount: unknown }>) {
    if (row.user_id) adjusted.set(row.user_id, (adjusted.get(row.user_id) ?? 0) + toCents(row.amount));
  }

  const byUser = new Map<string, RefundSuggestionRow>();
  for (const row of (earnedRows ?? []) as Array<{ id: string; role: string | null; user_id: string | null; amount: unknown }>) {
    if (!row.user_id) continue; // «Sin persona»: no hay a quién ajustarle
    const slot = byUser.get(row.user_id) ?? {
      userId: row.user_id, userName: members.get(row.user_id) ?? null, commissions: [], originalCents: 0, suggestedCents: 0, alreadyAdjustedCents: adjusted.get(row.user_id) ?? 0,
    };
    const cents = toCents(row.amount);
    slot.commissions.push({ id: row.id, role: row.role, amountCents: cents });
    slot.originalCents += cents;
    byUser.set(row.user_id, slot);
  }
  const suggestions = [...byUser.values()].map((s) => ({ ...s, suggestedCents: refundSuggestion(s.originalCents, refundedCents, paidCents) }));

  return { ok: true, refundPaymentId: refund.id, originalPaymentId: original.id, saleId: refund.sale_id, refundedCents, paidCents, suggestions };
}
