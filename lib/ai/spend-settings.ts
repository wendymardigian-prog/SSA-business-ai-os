/**
 * Los topes de gasto de IA del WORKSPACE como los muestra la pantalla de
 * Agentes (tarjeta "Topes y avisos", y la pestaña Costos de cada agente).
 *
 * Puro y sin dependencias de servidor: lo importa un Client Component. Un
 * solo lugar que lee la fila de `workspaces` (columnas de la 00058 y la 00133),
 * asi la pagina de Agentes y la pestaña Costos no arman cada una su version.
 */

import type { CostLimitAction } from "@/lib/types/database";
import { validAlertPct } from "@/lib/ai/spend-alerts";

export interface WorkspaceSpendSettings {
  dailyUsd: number | null;
  /** 'disable' = frena la IA hasta la medianoche local; 'notify' = solo avisa. */
  dailyAction: CostLimitAction;
  monthlyUsd: number | null;
  /** 'disable' = apaga el agente; 'notify' = solo avisa. */
  monthlyAction: CostLimitAction;
  /** Avisar al llegar a este % de cualquiera de los dos topes. null = sin aviso previo. */
  alertPct: number | null;
}

/** Las columnas de `workspaces` que hay que pedir para armar `WorkspaceSpendSettings`. */
export const SPEND_SETTINGS_COLUMNS =
  "ai_daily_cost_limit_usd, ai_monthly_cost_limit_usd, ai_daily_limit_action, ai_monthly_limit_action, ai_spend_alert_pct";

interface SpendSettingsRow {
  ai_daily_cost_limit_usd?: number | string | null;
  ai_monthly_cost_limit_usd?: number | string | null;
  ai_daily_limit_action?: string | null;
  ai_monthly_limit_action?: string | null;
  ai_spend_alert_pct?: number | null;
}

function toUsd(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Ante un valor raro, corta: solo 'notify' expreso deja de cortar (igual que `lib/ai/spend.ts`). */
function toAction(value: string | null | undefined): CostLimitAction {
  return value === "notify" ? "notify" : "disable";
}

export function readWorkspaceSpendSettings(row: SpendSettingsRow | null | undefined): WorkspaceSpendSettings {
  return {
    dailyUsd: toUsd(row?.ai_daily_cost_limit_usd),
    dailyAction: toAction(row?.ai_daily_limit_action),
    monthlyUsd: toUsd(row?.ai_monthly_cost_limit_usd),
    monthlyAction: toAction(row?.ai_monthly_limit_action),
    alertPct: validAlertPct(row?.ai_spend_alert_pct),
  };
}
