import { describe, expect, it } from "vitest";
import { BUDGET_DAILY_MESSAGE, BUDGET_MONTHLY_MESSAGE, budgetBlockMessage } from "./cost";

describe("ai/cost: el tope de gasto del negocio (F38)", () => {
  it("si se puede llamar, no hay mensaje", () => {
    expect(budgetBlockMessage({ allowed: true })).toBeNull();
  });

  it("el tope mensual dice «Llegaste al tope de gasto de IA de este mes»", () => {
    const text = budgetBlockMessage({ allowed: false, message: "El workspace llego a su tope mensual de gasto de IA (USD 50)." });
    expect(text).toBe(BUDGET_MONTHLY_MESSAGE);
    expect(text).toMatch(/^Llegaste al tope de gasto de IA de este mes/);
  });

  it("el diario se reanuda mañana", () => {
    expect(budgetBlockMessage({ allowed: false, message: "El workspace llego a su tope diario de gasto de IA (USD 5)." })).toBe(BUDGET_DAILY_MESSAGE);
  });

  it("si no se pudo leer el gasto o el modelo no tiene precio, dice lo que pasó (y tampoco se llama)", () => {
    expect(budgetBlockMessage({ allowed: false, message: "No pude verificar el gasto de IA del workspace." })).toBe("No pude verificar el gasto de IA del workspace.");
    expect(budgetBlockMessage({ allowed: false })).toBe(BUDGET_MONTHLY_MESSAGE);
  });
});
