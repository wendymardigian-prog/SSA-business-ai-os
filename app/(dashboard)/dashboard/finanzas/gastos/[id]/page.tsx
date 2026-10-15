import { notFound } from "next/navigation";
import { ExpenseDetail, type ExpenseDetailData, type ExpenseDetailRow } from "@/components/finance/expense-detail";
import { requirePermission } from "@/lib/auth/guards";
import { financeContextOf } from "@/lib/finance/context";
import { loadVendorsLite } from "@/lib/finance/list-load";
import { describeOrigin } from "@/lib/finance/view";
import { workspaceMethods } from "@/lib/sales/workspace-methods";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { getWorkspaceMembers } from "@/lib/workspace-members";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUMNS =
  "id, concept, vendor_id, category_key, amount, status, scheduled_date, paid_date, origin, recurring_expense_id, source_ref, auto_drift_amount, auto_drift_resolved_at, adjusts_expense_id, receipt_path, receipt_name, responsible_id, notes, void_reason, void_kind, voided_at, created_at, updated_at";

/**
 * La ficha de un gasto. Se lee con la sesión de quien mira: si la RLS (`expenses.view`) no deja ver el gasto,
 * es un 404 (no se confirma que exista).
 */
export default async function GastoPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("expenses.view");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { supabase, workspace } = ctx;

  const { data } = await supabase.from("expenses").select(COLUMNS).eq("id", id).eq("workspace_id", workspace.id).maybeSingle();
  if (!data) notFound();
  const expense = data as unknown as ExpenseDetailRow;

  const f = financeContextOf(ctx);
  const [vendors, members, timeZone, template, adjusted] = await Promise.all([
    loadVendorsLite(ctx),
    getWorkspaceMembers(workspace.id),
    resolveViewerTimezone(workspace.timezone),
    expense.recurring_expense_id
      ? supabase.from("recurring_expenses").select("concept").eq("id", expense.recurring_expense_id).eq("workspace_id", workspace.id).maybeSingle().then((r) => (r.data as { concept: string } | null)?.concept ?? null)
      : Promise.resolve(null),
    expense.adjusts_expense_id
      ? supabase.from("expenses").select("concept").eq("id", expense.adjusts_expense_id).eq("workspace_id", workspace.id).maybeSingle().then((r) => (r.data as { concept: string } | null)?.concept ?? null)
      : Promise.resolve(null),
  ]);

  const methods = workspaceMethods(workspace).defs;
  const detail: ExpenseDetailData = {
    expense,
    origin: describeOrigin(expense, { recurringConcept: template, adjustedConcept: adjusted, methodName: (key) => methods.find((m) => m.key === key)?.name ?? key }),
    categories: f.settings.expense_categories,
    vendors,
    members: members.map((m) => ({ id: m.userId, name: m.name })),
    timeZone,
    today: f.todayLocal,
    canManage: ctx.can("expenses.manage"),
  };
  return <ExpenseDetail data={detail} />;
}
