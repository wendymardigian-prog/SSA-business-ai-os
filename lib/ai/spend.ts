import type { SupabaseClient } from "@supabase/supabase-js";
import type { CostLimitAction, Database } from "@/lib/types/database";
import { startOfZonedDay, startOfZonedMonth } from "@/lib/dates";

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
 *     cargado. Los dos CORTAN: un tope global que solo avisa no frena nada.
 *     Sus ventanas salen de workspaceSpendCandidates, la misma definicion que
 *     usa workspace-budget.ts para lo que no es el agente.
 *
 * Que significa cortar depende de la ventana (isTemporaryBlock):
 *   - un tope DIARIO corta hasta la medianoche local y no apaga nada: al dia
 *     siguiente la suma vuelve a cero y todo sigue solo;
 *   - un tope MENSUAL apaga el agente, y se vuelve a encender a mano.
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

/** Un tope diario corta solo hasta la medianoche local; el mensual apaga. */
export function isTemporaryBlock(scope: SpendScope): boolean {
  return scope === "agent_daily" || scope === "workspace_daily";
}

/** Un monto de la base (numeric puede llegar como string) o null si no hay tope. */
function toLimit(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Los topes del WORKSPACE con su ventana, solo los que estan cargados. Es la
 * unica definicion: la usan el agente (checkSpendLimits) y lo que no es el
 * agente (withinWorkspaceBudget). Si cada uno armara la suya, "llegue al
 * tope" significaria dos cosas distintas segun quien pregunte.
 */
export function workspaceSpendCandidates(args: {
  dailyUsd: number | string | null | undefined;
  monthlyUsd: number | string | null | undefined;
  now: Date;
  timeZone: string;
}): Array<{ scope: "workspace_daily" | "workspace_monthly"; limitUsd: number; action: CostLimitAction; since: Date }> {
  const out: Array<{ scope: "workspace_daily" | "workspace_monthly"; limitUsd: number; action: CostLimitAction; since: Date }> = [];
  const daily = toLimit(args.dailyUsd);
  const monthly = toLimit(args.monthlyUsd);
  if (daily !== null) {
    out.push({ scope: "workspace_daily", limitUsd: daily, action: "disable", since: startOfZonedDay(args.now, args.timeZone) });
  }
  if (monthly !== null) {
    out.push({ scope: "workspace_monthly", limitUsd: monthly, action: "disable", since: startOfZonedMonth(args.now, args.timeZone) });
  }
  return out;
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
  const tz = args.timeZone ?? "UTC";
  const dayStart = startOfZonedDay(now, tz);
  const monthStart = startOfZonedMonth(now, tz);
  const l = args.limits;

  const candidates: Candidate[] = [
    ...([
      { scope: "agent_daily", limitUsd: l.agentDailyUsd, action: l.agentDailyAction, since: dayStart, agentId: args.agentId },
      { scope: "agent_monthly", limitUsd: l.agentMonthlyUsd, action: l.agentMonthlyAction, since: monthStart, agentId: args.agentId },
    ] as Candidate[]).filter((c) => c.limitUsd !== null),
    ...workspaceSpendCandidates({ dailyUsd: l.workspaceDailyUsd, monthlyUsd: l.workspaceMonthlyUsd, now, timeZone: tz }).map(
      (c) => ({ ...c, agentId: null }),
    ),
  ];

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
