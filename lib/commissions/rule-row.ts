/**
 * Una fila de `commission_rules` como la entrega la base → la `CommissionRule` tipada que usa el motor. Puro.
 * Nunca lanza: lo que viene raro (un numeric como texto, unas condiciones que no son un objeto) se normaliza.
 */
import type { CommissionRule, RuleConditions } from "./types";

export const RULE_COLUMNS =
  "id, workspace_id, name, role, position, conditions, calc_type, rate, fixed_amount, base, beneficiary_user_id, hold_days, valid_from, valid_until, is_active, archived_at, created_by, updated_by, created_at, updated_at";

const numberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export type RuleRow = Record<string, unknown>;

export function commissionRuleFromRow(row: RuleRow): CommissionRule {
  const conditions = row.conditions && typeof row.conditions === "object" && !Array.isArray(row.conditions) ? (row.conditions as RuleConditions) : {};
  return {
    id: String(row.id),
    name: typeof row.name === "string" ? row.name : "",
    role: String(row.role),
    position: Number(row.position) || 0,
    conditions,
    calc_type: row.calc_type === "fixed" ? "fixed" : "percent",
    rate: numberOrNull(row.rate),
    fixed_amount: numberOrNull(row.fixed_amount),
    base: row.base === "net_of_fees" ? "net_of_fees" : "gross",
    beneficiary_user_id: typeof row.beneficiary_user_id === "string" ? row.beneficiary_user_id : null,
    hold_days: Number(row.hold_days) || 0,
    valid_from: typeof row.valid_from === "string" ? row.valid_from : null,
    valid_until: typeof row.valid_until === "string" ? row.valid_until : null,
    is_active: row.is_active !== false,
    archived_at: typeof row.archived_at === "string" ? row.archived_at : null,
  };
}
