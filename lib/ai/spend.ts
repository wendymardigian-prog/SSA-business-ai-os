import type { SupabaseClient } from "@supabase/supabase-js";
import type { CostLimitAction, Database } from "@/lib/types/database";
import { BUSINESS_TIMEZONE, startOfZonedDay, startOfZonedMonth } from "@/lib/dates";

/**
 * Topes de gasto de IA (F25/F29), evaluados ANTES de cada llamada al modelo.
 *
 * Evaluar despues no protege: la llamada que excede el tope ya se pago. Por
 * eso el motor del agente pregunta aca antes de tocar un proveedor, y un tope
 * excedido con accion "disable" corta el turno sin gastar un token.
 *
 * Los cortes de dia y mes se calculan en la zona del negocio: un tope "diario"
 * cortado en UTC se reiniciaria a las 18:00 de Costa Rica.
 *
 * Dos alcances:
 *   - del agente: sus propios topes (default USD 5 diario que avisa, USD 100
 *     mensual que apaga);
 *   - del workspace: todo el gasto de IA del sistema, si hay tope global
 *     cargado. El diario avisa y el mensual apaga, igual que el del agente.
 *
 * La suma la hace la base (sum_ai_spend, 00064): sumar filas en la app choca
 * con el limite de 1.000 filas por consulta y subestima el gasto.
 */

type Db = SupabaseClient<Database>;

export type SpendScope = "agent_daily" | "agent_monthly" | "workspace_daily" | "workspace_monthly";

export interface SpendLimits {
  agentDailyUsd: number | null;
  agentDailyAction: CostLimitAction;
  agentMonthlyUsd: number | null;
  agentMonthlyAction: CostLimitAction;
  workspaceDailyUsd: number | null;
  workspaceMonthlyUsd: number | null;
}

export interface SpendBreach {
  scope: SpendScope;
  limitUsd: number;
  spentUsd: number;
  action: CostLimitAction;
}

export type SpendCheck =
  | { allowed: true; warnings: SpendBreach[] }
  | { allowed: false; blocking: SpendBreach; warnings: SpendBreach[] }
  /** No se pudo leer el gasto: se corta, del lado seguro. */
  | { allowed: false; blocking: null; warnings: SpendBreach[]; readError: string };

interface Candidate {
  scope: SpendScope;
  limitUsd: number | null;
  action: CostLimitAction;
  since: Date;
  agentId: string | null;
}

/**
 * Decide con los montos ya sumados. Pura: es lo que se testea.
 * Un tope se considera alcanzado cuando lo gastado lo iguala o lo supera.
 */
export function evaluateSpend(
  entries: Array<{ scope: SpendScope; limitUsd: number | null; action: CostLimitAction; spentUsd: number }>,
): { allowed: true; warnings: SpendBreach[] } | { allowed: false; blocking: SpendBreach; warnings: SpendBreach[] } {
  const breaches: SpendBreach[] = entries
    .filter((e) => e.limitUsd !== null && e.spentUsd >= e.limitUsd)
    .map((e) => ({ scope: e.scope, limitUsd: e.limitUsd as number, spentUsd: e.spentUsd, action: e.action }));

  const blocking = breaches.find((b) => b.action === "disable");
  const warnings = breaches.filter((b) => b.action === "notify");
  return blocking ? { allowed: false, blocking, warnings } : { allowed: true, warnings };
}

export async function checkSpendLimits(
  supabase: Db,
  args: {
    workspaceId: string;
    agentId: string;
    limits: SpendLimits;
    now?: Date;
    timeZone?: string;
  },
): Promise<SpendCheck> {
  const now = args.now ?? new Date();
  const tz = args.timeZone ?? BUSINESS_TIMEZONE;
  const dayStart = startOfZonedDay(now, tz);
  const monthStart = startOfZonedMonth(now, tz);
  const l = args.limits;

  const candidates: Candidate[] = [
    { scope: "agent_daily", limitUsd: l.agentDailyUsd, action: l.agentDailyAction, since: dayStart, agentId: args.agentId },
    { scope: "agent_monthly", limitUsd: l.agentMonthlyUsd, action: l.agentMonthlyAction, since: monthStart, agentId: args.agentId },
    { scope: "workspace_daily", limitUsd: l.workspaceDailyUsd, action: "notify", since: dayStart, agentId: null },
    { scope: "workspace_monthly", limitUsd: l.workspaceMonthlyUsd, action: "disable", since: monthStart, agentId: null },
  ].filter((c) => c.limitUsd !== null) as Candidate[];

  if (candidates.length === 0) return { allowed: true, warnings: [] };

  const entries = [];
  for (const c of candidates) {
    const { data, error } = await supabase.rpc("sum_ai_spend", {
      p_workspace_id: args.workspaceId,
      p_since: c.since.toISOString(),
      p_agent_id: c.agentId,
    });
    if (error) {
      console.error("[ai-spend] no pude sumar el gasto:", error.message);
      return { allowed: false, blocking: null, warnings: [], readError: error.message };
    }
    entries.push({ scope: c.scope, limitUsd: c.limitUsd, action: c.action, spentUsd: Number(data ?? 0) });
  }

  return evaluateSpend(entries);
}
