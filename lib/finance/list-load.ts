/**
 * Lo que necesita la pantalla de Gastos (SOLO servidor): la página de filas, las pastillas con contador y monto,
 * los totales por estado de TODO el filtro y los datos de apoyo (categorías, proveedores, personas).
 * Lee con la SESIÓN: la RLS (`expenses.view`) decide. Las sumas se hacen en el servidor, en céntimos.
 */
import type { PermissionContext } from "@/lib/auth/guards";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { toCents } from "@/lib/shared/money";
import { financeContextOf } from "./context";
import type { ExpenseCategory } from "./categories";
import {
  EXPENSES_PAGE_SIZE, EXPENSE_PILLS, expenseConditions, pillConditions, type ExpenseFilters, type ExpensePill,
} from "./expense-filters";
import { sortExpenses, totalsByStatus, type ExpenseListRow, type StatusTotals } from "./expense-list";
import { applyExpenseConditions } from "./query";
import type { VendorLite } from "./vendors";

export const LIST_COLUMNS =
  "id, concept, vendor_id, category_key, amount, status, scheduled_date, paid_date, origin, receipt_path, responsible_id, notes, void_reason, auto_drift_amount, auto_drift_resolved_at, recurring_expense_id, adjusts_expense_id";
/** Tope de filas para los totales y el CSV. */
export const TOTALS_LIMIT = 5000;

export interface ExpenseListData {
  rows: ExpenseListRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: ExpenseFilters;
  pills: Record<ExpensePill, { count: number; cents: number }>;
  totals: StatusTotals;
  /** Había más filas que el tope: los totales miran las primeras. */
  totalsTruncated: boolean;
  loadError: boolean;
  today: string;
  categories: ExpenseCategory[];
  vendors: VendorLite[];
  members: Array<{ id: string; name: string }>;
  canManage: boolean;
}

export async function loadVendorsLite(ctx: Pick<PermissionContext, "supabase" | "workspace">): Promise<VendorLite[]> {
  const { data } = await ctx.supabase.from("vendors").select("id, name, archived_at, user_id").eq("workspace_id", ctx.workspace.id).order("name", { ascending: true }).limit(2000);
  return ((data ?? []) as VendorLite[]);
}

export async function loadExpenseList(ctx: PermissionContext, filters: ExpenseFilters): Promise<ExpenseListData> {
  const { supabase, workspace } = ctx;
  const f = financeContextOf(ctx);
  const conditions = expenseConditions(filters, f.todayLocal, f.settings.expense_categories);
  const from = (filters.page - 1) * EXPENSES_PAGE_SIZE;
  const base = () => supabase.from("expenses").select(LIST_COLUMNS, { count: "exact" }).eq("workspace_id", workspace.id);

  const pillQueries = EXPENSE_PILLS.map((pill) =>
    applyExpenseConditions(supabase.from("expenses").select("amount").eq("workspace_id", workspace.id), pillConditions(pill, f.todayLocal)).limit(TOTALS_LIMIT),
  );

  const [page, totalsRes, vendors, members, ...pillRes] = await Promise.all([
    applyExpenseConditions(base(), conditions).order("scheduled_date", { ascending: true }).order("created_at", { ascending: true }).range(from, from + EXPENSES_PAGE_SIZE - 1),
    applyExpenseConditions(supabase.from("expenses").select("status, amount").eq("workspace_id", workspace.id), conditions).limit(TOTALS_LIMIT),
    loadVendorsLite(ctx),
    getWorkspaceMembers(workspace.id),
    ...pillQueries,
  ]);

  const pills = Object.fromEntries(
    EXPENSE_PILLS.map((pill, i) => {
      const rows = ((pillRes[i] as { data: Array<{ amount: unknown }> | null }).data ?? []);
      return [pill, { count: rows.length, cents: rows.reduce((s, r) => s + toCents(r.amount), 0) }];
    }),
  ) as ExpenseListData["pills"];

  const totalsRows = (totalsRes.data ?? []) as unknown as Array<{ status: string; amount: unknown }>;
  // Vencidos primero en cada página (el orden de la consulta es por fecha; acá se acomoda la página).
  const rows = sortExpenses(((page.data ?? []) as unknown as ExpenseListRow[]));

  return {
    rows,
    total: page.count ?? 0,
    page: filters.page,
    pageSize: EXPENSES_PAGE_SIZE,
    filters,
    pills,
    totals: totalsByStatus(totalsRows),
    totalsTruncated: totalsRows.length >= TOTALS_LIMIT,
    loadError: !!page.error,
    today: f.todayLocal,
    categories: f.settings.expense_categories,
    vendors,
    members: members.map((m) => ({ id: m.userId, name: m.name })),
    canManage: ctx.can("expenses.manage"),
  };
}

/** Las filas del filtro para el CSV: la MISMA consulta que la lista, sin paginar y hasta el tope. */
export async function loadExpenseRowsForExport(ctx: PermissionContext, filters: ExpenseFilters): Promise<{ rows: ExpenseListRow[]; truncated: boolean }> {
  const f = financeContextOf(ctx);
  const conditions = expenseConditions(filters, f.todayLocal, f.settings.expense_categories);
  const { data } = await applyExpenseConditions(ctx.supabase.from("expenses").select(LIST_COLUMNS).eq("workspace_id", ctx.workspace.id), conditions)
    .order("scheduled_date", { ascending: true }).order("created_at", { ascending: true }).limit(TOTALS_LIMIT + 1);
  const rows = ((data ?? []) as unknown as ExpenseListRow[]);
  return { rows: rows.slice(0, TOTALS_LIMIT), truncated: rows.length > TOTALS_LIMIT };
}
