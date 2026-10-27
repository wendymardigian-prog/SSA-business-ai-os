"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPermissionAction } from "@/lib/auth/guards";
import { diffFields, logAudit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { scheduleJob } from "@/lib/scheduler";
import { UUID_RE, financeContextOf } from "@/lib/finance/context";
import { FINANCE_DAILY_JOB } from "@/lib/jobs/handlers/finance-daily";
import { planAutoSettings, type AutoSection, type VendorNeed } from "@/lib/finance/auto-settings";
import { adjustmentConcept } from "@/lib/finance/expense-rules";
import { findActiveVendorByName, type VendorLite } from "@/lib/finance/vendors";
import { parseFinanceSettings } from "@/lib/finance/settings";
import { loadMetaAccounts } from "@/lib/finance/meta-accounts";
import { workspaceMethods } from "@/lib/sales/workspace-methods";
import { fromCents, toCents } from "@/lib/shared/money";
import type { Json } from "@/lib/types/database";

/**
 * Gastos automáticos (GF19 y GF22): la configuración, «Calcular ahora» y las dos salidas de una diferencia
 * (crear un ajuste o ignorarla). Escribe la sesión de quien pide DESPUÉS de `expenses.manage`; la configuración
 * (`workspaces` es de Admin en la base) la escribe el servicio, solo en las claves de esta sección y en el
 * workspace de la sesión.
 */

const NO_PERMISSION = "No tenés permiso para cambiar los gastos automáticos";

export type AutoActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

function revalidate(expenseId?: string) {
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/finanzas");
  revalidatePath("/dashboard/finanzas/gastos");
  if (expenseId) revalidatePath(`/dashboard/finanzas/gastos/${expenseId}`);
}

// ── Configuración ──────────────────────────────────────────────────────

const rowSchema = z.object({
  key: z.string().min(1).max(120),
  enabled: z.boolean(),
  chargeMode: z.enum(["automatic", "manual"]),
  categoryKey: z.string().max(60).nullable(),
  vendorId: z.string().nullable(),
});
const settingsSchema = z.object({
  processorFees: z.array(rowSchema).max(50),
  metaAds: z.array(rowSchema).max(50),
  autoCloseDays: z.union([z.number(), z.string()]),
});

async function resolveVendors(
  ctx: NonNullable<Awaited<ReturnType<typeof getPermissionAction>>>,
  needs: readonly VendorNeed[],
): Promise<{ ok: true; ids: Map<string, string> } | { ok: false; error: string }> {
  const ids = new Map<string, string>();
  if (needs.length === 0) return { ok: true, ids };
  const { data } = await ctx.supabase.from("vendors").select("id, name, archived_at, user_id").eq("workspace_id", ctx.workspace.id);
  const vendors = [...((data ?? []) as VendorLite[])];
  for (const need of needs) {
    const existing = findActiveVendorByName(vendors, need.name);
    if (existing) {
      ids.set(`${need.section}:${need.key}`, existing.id);
      continue;
    }
    const { data: created, error } = await ctx.supabase
      .from("vendors")
      .insert({ workspace_id: ctx.workspace.id, name: need.name, created_by: ctx.user.id, updated_by: ctx.user.id } as never)
      .select("id, name")
      .single();
    if (error || !created) {
      console.error("[finance] no pude crear el proveedor automático:", error?.message);
      return { ok: false, error: `No pude crear el proveedor «${need.name}»` };
    }
    const row = created as { id: string; name: string };
    vendors.push({ id: row.id, name: row.name, archived_at: null });
    ids.set(`${need.section}:${need.key}`, row.id);
    await logAudit({ supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "vendor", entityId: row.id, action: "vendor.created", changes: diffFields({}, { name: row.name }), metadata: { origin: "auto_settings" }, performedBy: ctx.user.id });
  }
  return { ok: true, ids };
}

export async function saveAutoExpenseSettings(input: unknown): Promise<AutoActionResult> {
  const ctx = await getPermissionAction("expenses.manage");
  if (!ctx) return fail(NO_PERMISSION);
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return fail("La configuración no es válida");

  const service = await createServiceClient();
  const { data: row, error: readError } = await service.from("workspaces").select("finance_settings, payment_methods").eq("id", ctx.workspace.id).maybeSingle();
  if (readError || !row) {
    console.error("[finance] no pude leer la configuración:", readError?.message);
    return fail("No pude guardar el cambio");
  }
  const currentJson = (row as { finance_settings?: unknown }).finance_settings;
  const current = parseFinanceSettings(currentJson);
  const methods = workspaceMethods(row).configs.map((m) => ({ key: m.key, name: m.name }));
  const metaAccounts = await loadMetaAccounts(ctx.workspace.id);

  const planned = planAutoSettings(parsed.data, current, { methods, metaAccounts, categories: current.expense_categories });
  if (!planned.ok) return fail(planned.error);

  const vendors = await resolveVendors(ctx, planned.plan.needsVendor);
  if (!vendors.ok) return fail(vendors.error);
  const fill = (section: AutoSection, map: Record<string, { enabled: boolean; vendor_id: string | null }>) => {
    for (const [key, setting] of Object.entries(map)) {
      const id = vendors.ids.get(`${section}:${key}`);
      if (setting.enabled && !setting.vendor_id && id) setting.vendor_id = id;
    }
  };
  fill("processor_fees", planned.plan.processor_fees);
  fill("meta_ads", planned.plan.meta_ads);

  const base = currentJson && typeof currentJson === "object" && !Array.isArray(currentJson) ? (currentJson as Record<string, unknown>) : {};
  const next = { ...base, processor_fees: planned.plan.processor_fees, meta_ads: planned.plan.meta_ads, auto_close_days: planned.plan.auto_close_days };
  const { error } = await service.from("workspaces").update({ finance_settings: next as unknown as Json } as never).eq("id", ctx.workspace.id);
  if (error) {
    console.error("[finance] no pude guardar los gastos automáticos:", error.message);
    return fail("No pude guardar el cambio");
  }
  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "workspace", entityId: ctx.workspace.id, action: "finance.settings_updated",
    changes: {
      processor_fees: { old: current.processor_fees as unknown as Json, new: planned.plan.processor_fees as unknown as Json },
      meta_ads: { old: current.meta_ads as unknown as Json, new: planned.plan.meta_ads as unknown as Json },
      auto_close_days: { old: current.auto_close_days, new: planned.plan.auto_close_days },
    },
    performedBy: ctx.user.id,
  });
  revalidate();
  return { ok: true };
}

/**
 * «Calcular ahora»: encola un `finance_daily` para hoy. La clave `finance_daily:{ws}:{fecha}:manual:{n}` hace que
 * dos clics seguidos no encolen dos veces mientras el primero espera.
 */
export async function runFinanceDailyNow(): Promise<AutoActionResult<{ queued: boolean }>> {
  const ctx = await getPermissionAction("expenses.manage");
  if (!ctx) return fail(NO_PERMISSION);
  const f = financeContextOf(ctx);
  const service = await createServiceClient();
  const prefix = `finance_daily:${ctx.workspace.id}:${f.todayLocal}:manual:`;
  const { count } = await service.from("scheduled_jobs").select("id", { count: "exact", head: true }).like("dedupe_key", `${prefix}%`);
  try {
    await scheduleJob(service, FINANCE_DAILY_JOB, { workspace_id: ctx.workspace.id, local_date: f.todayLocal, manual: true }, new Date(), `${prefix}${(count ?? 0) + 1}`);
  } catch (e) {
    if ((e as { code?: string } | null)?.code === "23505") return { ok: true, queued: false };
    console.error("[finance] no pude encolar el cálculo:", e instanceof Error ? e.message : String(e));
    return fail("No pude encolar el cálculo");
  }
  return { ok: true, queued: true };
}

// ── Diferencia de un automático ya pagado (GF22) ───────────────────────

type Ctx = NonNullable<Awaited<ReturnType<typeof getPermissionAction>>>;

async function loadDrifted(ctx: Ctx, id: string) {
  if (!UUID_RE.test(id)) return null;
  const { data } = await ctx.supabase
    .from("expenses")
    .select("id, concept, vendor_id, category_key, status, origin, auto_drift_amount, auto_drift_resolved_at")
    .eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle();
  const row = data as unknown as { id: string; concept: string; vendor_id: string | null; category_key: string; status: string; origin: string; auto_drift_amount: unknown; auto_drift_resolved_at: string | null } | null;
  if (!row) return null;
  if (row.status !== "pagado" || row.auto_drift_amount === null || row.auto_drift_amount === undefined || row.auto_drift_resolved_at) return null;
  return row;
}

const NO_DRIFT = "Este gasto no tiene una diferencia pendiente";

/** Crea el gasto de ajuste (con el signo de la diferencia) y marca la diferencia como resuelta. */
export async function createDriftAdjustment(expenseId: string, applied = false): Promise<AutoActionResult<{ id: string }>> {
  const ctx = await getPermissionAction("expenses.manage");
  if (!ctx) return fail(NO_PERMISSION);
  const original = await loadDrifted(ctx, expenseId);
  if (!original) return fail(NO_DRIFT);
  const cents = toCents(original.auto_drift_amount);
  if (cents === 0) return fail(NO_DRIFT);
  const f = financeContextOf(ctx);

  const { data, error } = await ctx.supabase
    .from("expenses")
    .insert({
      workspace_id: ctx.workspace.id,
      concept: adjustmentConcept(original.concept),
      vendor_id: original.vendor_id,
      category_key: original.category_key,
      amount: fromCents(cents),
      status: applied ? "pagado" : "programado",
      scheduled_date: f.todayLocal,
      paid_date: applied ? f.todayLocal : null,
      paid_by: applied ? ctx.user.id : null,
      origin: "adjustment",
      adjusts_expense_id: original.id,
      created_by: ctx.user.id,
      updated_by: ctx.user.id,
    } as never)
    .select("id")
    .single();
  if (error || !data) {
    console.error("[finance] no pude crear el ajuste:", error?.message);
    return fail("No pude crear el ajuste");
  }
  const adjustmentId = (data as { id: string }).id;
  // Si esto falla, el ajuste ya existe: el próximo recálculo ve pagado + ajuste = total y limpia la diferencia solo.
  const { error: resolveError } = await ctx.supabase
    .from("expenses").update({ auto_drift_resolved_at: new Date().toISOString(), updated_by: ctx.user.id } as never)
    .eq("id", original.id).eq("workspace_id", ctx.workspace.id);
  if (resolveError) console.error("[finance] el ajuste se creó pero no pude marcar la diferencia:", resolveError.message);
  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "expense", entityId: adjustmentId, action: "expense.adjustment_created",
    changes: diffFields({}, { amount: fromCents(cents), status: applied ? "pagado" : "programado" }),
    metadata: { adjusts_expense_id: original.id }, performedBy: ctx.user.id,
  });
  revalidate(original.id);
  return { ok: true, id: adjustmentId };
}

/** «Ignorar» la diferencia, con un motivo: no crea nada y no se vuelve a marcar la misma. */
export async function ignoreDrift(expenseId: string, reason: string): Promise<AutoActionResult> {
  const ctx = await getPermissionAction("expenses.manage");
  if (!ctx) return fail(NO_PERMISSION);
  const text = (reason ?? "").trim();
  if (text.length === 0) return fail("Contá por qué la ignorás");
  if (text.length > 500) return fail("El motivo puede tener hasta 500 caracteres");
  const original = await loadDrifted(ctx, expenseId);
  if (!original) return fail(NO_DRIFT);
  const { data, error } = await ctx.supabase
    .from("expenses").update({ auto_drift_resolved_at: new Date().toISOString(), updated_by: ctx.user.id } as never)
    .eq("id", original.id).eq("workspace_id", ctx.workspace.id).is("auto_drift_resolved_at", null).select("id");
  if (error) {
    console.error("[finance] no pude ignorar la diferencia:", error.message);
    return fail("No pude guardar el cambio");
  }
  if ((data ?? []).length === 0) return fail(NO_DRIFT);
  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "expense", entityId: original.id, action: "expense.drift_ignored",
    metadata: { reason: text, drift_cents: toCents(original.auto_drift_amount) }, performedBy: ctx.user.id,
  });
  revalidate(original.id);
  return { ok: true };
}
