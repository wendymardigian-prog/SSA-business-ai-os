/**
 * Los pasos del trabajo diario de Finanzas que ESCRIBEN (SOLO servidor): generar los gastos de las plantillas
 * recurrentes y recalcular los gastos automáticos (comisiones de procesador y pauta de Meta), con su cierre.
 *
 * La decisión es pura y vive en otro lado (`generate-recurring.ts`, `auto-expenses.ts` y su gemela SQL
 * `upsert_auto_expense`); acá solo se leen datos, se llama y se anota. Todo es idempotente: los índices únicos
 * de la base son la verdad (un anulado sigue ocupando su fecha) y repetir el día no duplica nada.
 *
 * Los logs llevan cantidades e ids, nunca montos por proveedor ni conceptos.
 */
import { auditAsSystem } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/create";
import { startOfDay } from "@/lib/dates";
import { workspaceMethods } from "@/lib/sales/workspace-methods";
import { parseMetaConfig } from "@/lib/meta/accounts";
import { toCents } from "@/lib/sales/money";
import type { FinanceDailyContext } from "@/lib/jobs/handlers/finance-daily";
import {
  autoClosePaidDate, autoExpenseConcept, autoKey, monthsInWindow, parseAutoKey, shouldAutoClose, sumMetaSpendCents, sumProcessorFeeCents,
  hasMetaAccountLevelRows, shortMethodName, type AutoKind, type FeePayment, type MetaInsightRow,
} from "./auto-expenses";
import { monthEnd, monthStart } from "./dates";
import { buildRecurringExpense, datesToGenerate, MAX_GENERATED_PER_RUN, type RecurringTemplateForGeneration } from "./generate-recurring";
import { summarizeAutoChanged } from "./summary-text";
import { parseFinanceSettings, type AutoExpenseSetting } from "./settings";
import { findCategory } from "./categories";
import { FINANCE_AUDIT_LABEL } from "./audit-label";

type Detail = Record<string, number | string>;

const TEMPLATE_COLUMNS =
  "id, concept, vendor_id, category_key, amount_type, amount, charge_mode, frequency, weekly_day, weekly_interval, monthly_day, yearly_month, yearly_day, start_date, end_date, lead_days, generation_anchor, responsible_id, notes";

/** Paso 1: genera los gastos que tocan hoy. El insert que choca con el índice único (`23505`) es «ya existía», no un error. */
export async function generateRecurringStep(ctx: FinanceDailyContext): Promise<Detail> {
  const { db, workspaceId, localDate } = ctx;
  const { data: templates, error } = await db.from("recurring_expenses").select(TEMPLATE_COLUMNS).eq("workspace_id", workspaceId).eq("is_active", true);
  if (error) throw new Error(`no pude leer las plantillas: ${error.message}`);

  const { data: ws } = await db.from("workspaces").select("finance_settings").eq("id", workspaceId).maybeSingle();
  const categories = parseFinanceSettings((ws as { finance_settings?: unknown } | null)?.finance_settings).expense_categories;

  let created = 0;
  let review = 0;
  let archivedRefs = 0;
  const failed: string[] = [];
  for (const raw of (templates ?? []) as unknown as RecurringTemplateForGeneration[]) {
    try {
      const dates = datesToGenerate(raw, localDate);
      for (const date of dates) {
        if (created >= MAX_GENERATED_PER_RUN) break;
        const row = buildRecurringExpense(raw, date, localDate);
        const { data, error: insertError } = await db
          .from("expenses")
          .insert({ workspace_id: workspaceId, ...row } as never)
          .select("id")
          .single();
        if (insertError) {
          if (insertError.code === "23505") continue; // ya existía (incluso anulado): el índice único manda
          throw new Error(insertError.message);
        }
        created += 1;
        if (row.status === "por_revisar") review += 1;
        if (findCategory(categories, row.category_key)?.archived_at) archivedRefs += 1;
        await auditAsSystem({
          supabase: db, workspaceId, entityType: "expense", entityId: (data as { id: string }).id, action: "recurring.expense_generated",
          metadata: { recurring_expense_id: raw.id, scheduled_date: date }, label: FINANCE_AUDIT_LABEL,
        });
      }
    } catch (e) {
      console.error(`[finance_daily] la plantilla ${raw.id} falló:`, e instanceof Error ? e.message : String(e));
      failed.push(raw.id);
    }
  }
  ctx.review.pending += review;
  if (failed.length > 0) throw new Error(`fallaron ${failed.length} plantillas (${failed.slice(0, 5).join(", ")})`);
  return { templates: (templates ?? []).length, created, review_pending: review, archived_refs: archivedRefs };
}

interface UpsertArgs {
  kind: AutoKind;
  ref: string;
  name: string;
  month: string;
  totalCents: number;
  setting: AutoExpenseSetting;
  sourceRef: Record<string, number | string>;
}

async function upsertAuto(ctx: FinanceDailyContext, a: UpsertArgs): Promise<string> {
  const { db, workspaceId, localDate } = ctx;
  const defaultCategory = a.kind === "processor_fee" ? "processor_fees" : "ads_meta";
  const concept = autoExpenseConcept({ kind: a.kind, name: a.name, month: a.month });
  const { data, error } = await db.rpc("upsert_auto_expense", {
    p_workspace: workspaceId,
    p_auto_key: autoKey(a.kind, a.ref, a.month),
    p_origin: a.kind,
    p_total_cents: a.totalCents,
    p_concept: concept,
    p_month: a.month,
    p_vendor_id: a.setting.vendor_id,
    p_category_key: a.setting.category_key ?? defaultCategory,
    p_charge_mode: a.setting.charge_mode,
    p_source_ref: { kind: a.kind, ref: a.ref, month: a.month, ...a.sourceRef, computed_at: new Date().toISOString() },
    p_today: localDate,
  });
  if (error) throw new Error(`upsert_auto_expense: ${error.message}`);
  const result = (data ?? {}) as { action?: string; expense_id?: string; previous_amount_cents?: number; amount_cents?: number; drift_cents?: number };
  const action = result.action ?? "none";
  const id = result.expense_id;
  if (!id || action === "none" || action === "clear_drift") return action;

  const audit = (act: Parameters<typeof auditAsSystem>[0]["action"], changes?: Parameters<typeof auditAsSystem>[0]["changes"]) =>
    auditAsSystem({ supabase: db, workspaceId, entityType: "expense", entityId: id, action: act, changes, label: FINANCE_AUDIT_LABEL });
  if (action === "create") await audit("expense.auto_created", { amount: { old: null, new: (result.amount_cents ?? 0) / 100 } });
  else if (action === "update_amount") await audit("expense.auto_updated", { amount: { old: (result.previous_amount_cents ?? 0) / 100, new: (result.amount_cents ?? 0) / 100 } });
  else if (action === "void_zero") await audit("expense.auto_voided_zero");
  else if (action === "reactivate") await audit("expense.auto_reactivated", { amount: { old: null, new: (result.amount_cents ?? 0) / 100 } });
  else if (action === "mark_drift") {
    await audit("expense.drift_detected", { auto_drift_amount: { old: null, new: (result.drift_cents ?? 0) / 100 } });
    const text = summarizeAutoChanged({ concept, driftCents: result.drift_cents ?? 0 });
    await createNotification({
      supabase: db, workspaceId, type: "expense_auto_changed", title: text.title, body: text.body, entityType: "expense", entityId: id,
      metadata: { drift_cents: result.drift_cents ?? 0, month: a.month },
    });
  }
  return action;
}

/** Paso 2: recalcula (entero, nunca «sumando lo nuevo») las comisiones de procesador y la pauta de Meta, y cierra los meses viejos. */
export async function autoExpensesStep(ctx: FinanceDailyContext): Promise<Detail> {
  const { db, workspaceId, localDate, timeZone } = ctx;
  const { data: ws, error } = await db.from("workspaces").select("finance_settings, payment_methods").eq("id", workspaceId).maybeSingle();
  if (error) throw new Error(`no pude leer la configuración: ${error.message}`);
  const settings = parseFinanceSettings((ws as { finance_settings?: unknown } | null)?.finance_settings);
  const methods = workspaceMethods(ws);
  const window = monthsInWindow(localDate, 3);

  const counts: Detail = { processor_fee: 0, meta_ads: 0, actions: 0, closed: 0 };
  const notes: string[] = [];
  const failures: string[] = [];
  const bump = (action: string, kind: AutoKind) => {
    counts[kind] = (counts[kind] as number) + 1;
    if (action !== "none" && action !== "clear_drift") counts.actions = (counts.actions as number) + 1;
  };

  // — Comisiones de procesador: la suma de `provider_fee_amount` de lo cobrado, por método y mes local.
  const feeSettings = Object.entries(settings.processor_fees).filter(([, s]) => s.enabled);
  if (feeSettings.length > 0) {
    const [y, m] = window[0].split("-").map(Number);
    // Un día de margen hacia atrás: el mes lo decide `sumProcessorFeeCents` con la zona del workspace.
    const since = new Date(startOfDay(y, m, 1, timeZone).getTime() - 86_400_000).toISOString();
    const { data: payments, error: payError } = await db
      .from("payments").select("payment_method, type, status, provider_fee_amount, paid_at")
      .eq("workspace_id", workspaceId).eq("status", "paid").neq("type", "refund").gte("paid_at", since).limit(20000);
    if (payError) throw new Error(`no pude leer los pagos: ${payError.message}`);
    for (const [methodKey, setting] of feeSettings) {
      const def = methods.configs.find((c) => c.key === methodKey);
      if (!def) { notes.push(`método ${methodKey} ya no existe`); continue; }
      for (const month of window) {
        try {
          const rows = (payments ?? []) as unknown as FeePayment[];
          const total = sumProcessorFeeCents(rows, methodKey, month, timeZone);
          const payment_count = rows.filter((r) => r.payment_method === methodKey && r.paid_at && r.paid_at.length > 0).length;
          const action = await upsertAuto(ctx, { kind: "processor_fee", ref: methodKey, name: shortMethodName(def.name), month, totalCents: total, setting, sourceRef: { payment_count } });
          bump(action, "processor_fee");
        } catch (e) {
          failures.push(`${methodKey}:${month}`);
          console.error("[finance_daily] comisión de procesador:", e instanceof Error ? e.message : String(e));
        }
      }
    }
  }

  // — Pauta de Meta: la suma de `spend` del nivel cuenta, solo USD.
  const metaSettings = Object.entries(settings.meta_ads).filter(([, s]) => s.enabled);
  if (metaSettings.length > 0) {
    const { data: integ } = await db.from("integration_configs").select("config").eq("workspace_id", workspaceId).eq("type", "meta").limit(1).maybeSingle();
    const accounts = parseMetaConfig((integ as { config?: unknown } | null)?.config).ad_accounts;
    for (const [accountId, setting] of metaSettings) {
      const acct = accounts.find((a) => a.ad_account_id === accountId);
      if (!acct) { notes.push(`cuenta ${accountId} ya no está en la integración`); continue; }
      if ((acct.currency ?? "").toUpperCase() !== "USD") { notes.push(`cuenta ${accountId} no es USD`); continue; }
      const { data: insights, error: insightError } = await db
        .from("meta_ads_insights_daily").select("ad_account_id, level, date, spend")
        .eq("workspace_id", workspaceId).eq("ad_account_id", accountId).eq("level", "account")
        .gte("date", monthStart(window[0])).lte("date", monthEnd(window[window.length - 1])).limit(5000);
      if (insightError) throw new Error(`no pude leer la pauta: ${insightError.message}`);
      const rows = (insights ?? []) as unknown as MetaInsightRow[];
      for (const month of window) {
        try {
          if (!hasMetaAccountLevelRows(rows, accountId, month)) { notes.push(`${accountId} ${month}: sin datos de nivel cuenta`); continue; }
          const total = sumMetaSpendCents(rows, accountId, month);
          const days = rows.filter((r) => r.date.startsWith(month)).length;
          const action = await upsertAuto(ctx, { kind: "meta_ads", ref: accountId, name: acct.name ?? accountId, month, totalCents: total, setting, sourceRef: { days_with_data: days } });
          bump(action, "meta_ads");
        } catch (e) {
          failures.push(`${accountId}:${month}`);
          console.error("[finance_daily] pauta de Meta:", e instanceof Error ? e.message : String(e));
        }
      }
    }
  }

  // — Cierre: el automático sin pagar con cobro automático, cuyo mes terminó hace `auto_close_days`, se marca pagado.
  const { data: open } = await db
    .from("expenses").select("id, status, origin, amount, scheduled_date, auto_key")
    .eq("workspace_id", workspaceId).in("origin", ["processor_fee", "meta_ads"]).in("status", ["programado", "vencido"]).limit(2000);
  for (const e of (open ?? []) as Array<{ id: string; status: string; origin: string; amount: unknown; scheduled_date: string; auto_key: string | null }>) {
    const parsed = parseAutoKey(e.auto_key);
    if (!parsed) continue;
    const setting = (parsed.kind === "processor_fee" ? settings.processor_fees : settings.meta_ads)[parsed.ref];
    if (!setting) continue;
    if (!shouldAutoClose(e, { chargeMode: setting.charge_mode, autoCloseDays: settings.auto_close_days }, localDate)) continue;
    const paidDate = autoClosePaidDate(e);
    const { data: closed } = await db
      .from("expenses").update({ status: "pagado", paid_date: paidDate, paid_by: null } as never)
      .eq("id", e.id).eq("workspace_id", workspaceId).eq("status", e.status as "programado").select("id");
    if ((closed ?? []).length > 0) {
      counts.closed = (counts.closed as number) + 1;
      await auditAsSystem({ supabase: db, workspaceId, entityType: "expense", entityId: e.id, action: "expense.auto_closed", changes: { status: { old: e.status, new: "pagado" }, paid_date: { old: null, new: paidDate } }, metadata: { amount_cents: toCents(e.amount) }, label: FINANCE_AUDIT_LABEL });
    }
  }

  if (notes.length > 0) counts.notes = notes.slice(0, 8).join(" | ");
  if (failures.length > 0) throw new Error(`fallaron ${failures.length} recálculos (${failures.slice(0, 5).join(", ")})`);
  return counts;
}
