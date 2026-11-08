/**
 * Costos y topes de la IA del Diseñador (F38).
 *
 * Cada llamada queda registrada en `agent_runs` con `source = 'designer'`
 * (costo, tokens y modelo; ver `openAiRun`) y respeta el tope de gasto de IA del
 * NEGOCIO (`withinWorkspaceBudget`): si se llegó, la IA responde «Llegaste al
 * tope de gasto de IA de este mes», NO se llama al proveedor y el resto del
 * Diseñador sigue funcionando. Si no se puede leer el gasto, tampoco se llama
 * (un tope que se salta cuando falla la consulta no es un tope).
 *
 * Módulo puro: traduce la decisión del tope a lo que se le dice a la persona.
 */

import type { BudgetDecision } from "@/lib/ai/workspace-budget";

export const BUDGET_MONTHLY_MESSAGE = "Llegaste al tope de gasto de IA de este mes. Podés subirlo en Agentes IA → Costos.";
export const BUDGET_DAILY_MESSAGE = "Llegaste al tope de gasto de IA de hoy. Se reanuda mañana, o podés subirlo en Agentes IA → Costos.";

/** El mensaje para la persona cuando el tope no deja llamar; `null` si se puede llamar. */
export function budgetBlockMessage(decision: BudgetDecision): string | null {
  if (decision.allowed) return null;
  const text = decision.message ?? "";
  if (/diario/i.test(text)) return BUDGET_DAILY_MESSAGE;
  if (/mensual/i.test(text)) return BUDGET_MONTHLY_MESSAGE;
  // Sin precio cargado o sin poder leer el gasto: se dice lo que pasó.
  return text || BUDGET_MONTHLY_MESSAGE;
}
