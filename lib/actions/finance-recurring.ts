"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { diffFields, logAudit } from "@/lib/audit";
import { financeContextOf, memberBelongs, vendorBelongs, UUID_RE } from "@/lib/finance/context";
import { activeCategories, findCategory } from "@/lib/finance/categories";
import { localDate } from "@/lib/finance/dates";
import { editResetsAnchor, missedDatesOnReactivate, normalizeTemplate, type NewRecurringRow, type RecurringTemplateRow } from "@/lib/finance/recurring";

/**
 * Gastos recurrentes (GF16). Las plantillas se crean, se editan, se pausan y se reactivan; no se borran.
 * Escribe la SESIÓN de quien pide, DESPUÉS de `getPermissionAction("expenses.manage")` (la RLS es la segunda barrera).
 *
 * Los gastos ya generados NO cambian al editar la plantilla (copiaron sus datos al nacer). El trabajo diario
 * (`finance_daily`) es quien genera; acá solo se decide el anclaje: desde qué fecha de pago puede generar.
 */

const NO_PERMISSION = "No tenés permiso para cambiar los gastos recurrentes";

export type RecurringActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

function revalidate() {
  revalidatePath("/dashboard/finanzas/recurrentes");
  revalidatePath("/dashboard/finanzas/gastos");
  revalidatePath("/dashboard/finanzas");
}

type Ctx = NonNullable<Awaited<ReturnType<typeof getPermissionAction>>>;

const TEMPLATE_COLUMNS =
  "id, concept, vendor_id, category_key, amount_type, amount, charge_mode, frequency, weekly_day, weekly_interval, monthly_day, yearly_month, yearly_day, start_date, end_date, lead_days, is_active, paused_at, generation_anchor, responsible_id, notes, updated_at";

type TemplateDbRow = RecurringTemplateRow & { id: string; paused_at: string | null; updated_at: string };

async function loadTemplate(ctx: Ctx, id: string): Promise<TemplateDbRow | null> {
  if (!UUID_RE.test(id)) return null;
  const { data } = await ctx.supabase.from("recurring_expenses").select(TEMPLATE_COLUMNS).eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle();
  return (data as unknown as TemplateDbRow | null) ?? null;
}

async function checkRefs(ctx: Ctx, row: NewRecurringRow): Promise<string | null> {
  if (!(await vendorBelongs(ctx, row.vendor_id))) return "Ese proveedor no existe";
  if (!(await memberBelongs(ctx, row.responsible_id))) return "Esa persona no es del equipo";
  return null;
}

export async function createRecurringTemplate(input: unknown): Promise<RecurringActionResult<{ id: string }>> {
  const ctx = await getPermissionAction("expenses.manage");
  if (!ctx) return fail(NO_PERMISSION);
  const f = financeContextOf(ctx);
  const planned = normalizeTemplate(input, f.todayLocal);
  if (!planned.ok) return fail(planned.error);
  const category = findCategory(f.settings.expense_categories, planned.row.category_key);
  if (!category || !activeCategories(f.settings.expense_categories).some((c) => c.key === category.key)) return fail("Elegí una categoría activa");
  const refsError = await checkRefs(ctx, planned.row);
  if (refsError) return fail(refsError);

  const { data, error } = await ctx.supabase
    .from("recurring_expenses")
    .insert({ workspace_id: ctx.workspace.id, ...planned.row, created_by: ctx.user.id, updated_by: ctx.user.id } as never)
    .select("id")
    .single();
  if (error || !data) {
    console.error("[finance] no pude crear la plantilla:", error?.message);
    return fail("No pude guardar la plantilla");
  }
  const id = (data as { id: string }).id;
  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "recurring_expense", entityId: id, action: "recurring.created",
    changes: diffFields({}, { concept: planned.row.concept, amount: planned.row.amount, frequency: planned.row.frequency, charge_mode: planned.row.charge_mode }),
    performedBy: ctx.user.id,
  });
  revalidate();
  return { ok: true, id };
}

export async function updateRecurringTemplate(id: string, input: unknown, expectedUpdatedAt?: string | null): Promise<RecurringActionResult<{ anchorReset: boolean }>> {
  const ctx = await getPermissionAction("expenses.manage");
  if (!ctx) return fail(NO_PERMISSION);
  const existing = await loadTemplate(ctx, id);
  if (!existing) return fail("Esta plantilla no existe");
  if (expectedUpdatedAt && existing.updated_at !== expectedUpdatedAt) return fail("Alguien cambió esta plantilla mientras la editabas. Recargá para ver lo último.");
  const f = financeContextOf(ctx);
  const planned = normalizeTemplate(input, f.todayLocal);
  if (!planned.ok) return fail(planned.error);
  const refsError = await checkRefs(ctx, planned.row);
  if (refsError) return fail(refsError);
  // Una categoría archivada que la plantilla ya usaba se puede conservar; cambiar a una archivada, no.
  if (planned.row.category_key !== existing.category_key) {
    const category = findCategory(f.settings.expense_categories, planned.row.category_key);
    if (!category || !activeCategories(f.settings.expense_categories).some((c) => c.key === category.key)) return fail("Elegí una categoría activa");
  }

  const reset = editResetsAnchor(existing, planned.row);
  // is_active y generation_anchor no los decide el formulario: la pausa es otra acción y el anclaje sale de la regla.
  const { is_active: _active, generation_anchor: _anchor, ...fields } = planned.row;
  void _active;
  void _anchor;
  const patch = { ...fields, ...(reset ? { generation_anchor: f.todayLocal } : {}), updated_by: ctx.user.id };
  const { data, error } = await ctx.supabase
    .from("recurring_expenses")
    .update(patch as never)
    .eq("id", id).eq("workspace_id", ctx.workspace.id).eq("updated_at", existing.updated_at)
    .select("id");
  if (error) {
    console.error("[finance] no pude editar la plantilla:", error.message);
    return fail("No pude guardar el cambio");
  }
  if ((data ?? []).length === 0) return fail("Esta plantilla cambió mientras la editabas. Recargá para verla.");

  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "recurring_expense", entityId: id, action: "recurring.updated",
    changes: diffFields(
      { concept: existing.concept, vendor_id: existing.vendor_id, category_key: existing.category_key, amount: existing.amount, charge_mode: existing.charge_mode, frequency: existing.frequency, monthly_day: existing.monthly_day, start_date: existing.start_date, end_date: existing.end_date, lead_days: existing.lead_days, responsible_id: existing.responsible_id },
      { concept: fields.concept, vendor_id: fields.vendor_id, category_key: fields.category_key, amount: fields.amount, charge_mode: fields.charge_mode, frequency: fields.frequency, monthly_day: fields.monthly_day, start_date: fields.start_date, end_date: fields.end_date, lead_days: fields.lead_days, responsible_id: fields.responsible_id },
    ),
    metadata: reset ? { anchor_reset: true } : undefined,
    performedBy: ctx.user.id,
  });
  revalidate();
  return { ok: true, anchorReset: reset };
}

/**
 * Pausar no genera más y no toca lo ya generado. Reactivar reinicia el anclaje a hoy: las fechas que cayeron
 * mientras estuvo pausada NO se crean solas, y la respuesta las lista para que la persona decida (GF18).
 */
export async function setRecurringActive(id: string, active: boolean): Promise<RecurringActionResult<{ missedDates: string[] }>> {
  const ctx = await getPermissionAction("expenses.manage");
  if (!ctx) return fail(NO_PERMISSION);
  const existing = await loadTemplate(ctx, id);
  if (!existing) return fail("Esta plantilla no existe");
  if (existing.is_active === active) return { ok: true, missedDates: [] };
  const f = financeContextOf(ctx);
  const pausedAt = existing.paused_at;

  const patch = active
    ? { is_active: true, paused_at: null, generation_anchor: f.todayLocal, updated_by: ctx.user.id }
    : { is_active: false, paused_at: new Date().toISOString(), updated_by: ctx.user.id };
  const { error } = await ctx.supabase.from("recurring_expenses").update(patch as never).eq("id", id).eq("workspace_id", ctx.workspace.id);
  if (error) {
    console.error("[finance] no pude cambiar el estado de la plantilla:", error.message);
    return fail("No pude guardar el cambio");
  }
  const missedDates = active && pausedAt ? missedDatesOnReactivate(existing, localDate(new Date(pausedAt), f.tz), f.todayLocal) : [];
  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "recurring_expense", entityId: id, action: active ? "recurring.reactivated" : "recurring.paused",
    metadata: active && missedDates.length > 0 ? { missed_dates: missedDates.length } : undefined,
    performedBy: ctx.user.id,
  });
  revalidate();
  return { ok: true, missedDates };
}
