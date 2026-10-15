/**
 * Lo que necesita la pantalla de Recurrentes (SOLO servidor). Lee con la SESIÓN de quien mira: la RLS
 * (`expenses.view`) decide qué ve. Las cuentas (estado, equivalente mensual, próxima fecha) son puras y viven en
 * `recurring-list.ts`; acá solo se juntan las filas y los datos de apoyo.
 */
import type { PermissionContext } from "@/lib/auth/guards";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { financeContextOf } from "./context";
import { loadVendorsLite } from "./list-load";
import { RECURRING_LIST_COLUMNS, buildRecurringList, type EstadoFilter, type RecurringDbRow, type RecurringScreenData } from "./recurring-list";

/** Tope de plantillas que se leen (un negocio chico tiene decenas). */
export const RECURRING_LIMIT = 500;

export async function loadRecurringScreen(ctx: PermissionContext, estado: EstadoFilter): Promise<RecurringScreenData> {
  const { supabase, workspace } = ctx;
  const f = financeContextOf(ctx);
  const [rowsRes, vendors, members] = await Promise.all([
    supabase.from("recurring_expenses").select(RECURRING_LIST_COLUMNS).eq("workspace_id", workspace.id).order("created_at", { ascending: true }).limit(RECURRING_LIMIT + 1),
    loadVendorsLite(ctx),
    getWorkspaceMembers(workspace.id),
  ]);
  if (rowsRes.error) console.error("[finanzas] no pude leer los gastos recurrentes:", rowsRes.error.message);
  const all = (rowsRes.data ?? []) as unknown as RecurringDbRow[];
  const truncated = all.length > RECURRING_LIMIT;
  const rows = truncated ? all.slice(0, RECURRING_LIMIT) : all;
  const memberList = members.map((m) => ({ id: m.userId, name: m.name }));
  const list = buildRecurringList(rows, { categories: f.settings.expense_categories, vendors, members: memberList, todayLocal: f.todayLocal }, estado);
  return {
    ...list,
    loadError: !!rowsRes.error,
    truncated,
    today: f.todayLocal,
    categories: f.settings.expense_categories,
    vendors,
    members: memberList,
    canManage: ctx.can("expenses.manage"),
  };
}
