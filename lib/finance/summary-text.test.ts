import { describe, expect, it } from "vitest";
import { summarizeAutoChanged, summarizeOverdue, summarizeReviewPending } from "./summary-text";

describe("avisos de Finanzas", () => {
  it("vencidos: cantidad y total en céntimos exactos", () => {
    expect(summarizeOverdue([{ cents: 80000 }, { cents: 30000 }, { cents: 14000 }])?.title).toBe("3 gastos vencieron hoy por USD 1.240,00");
    expect(summarizeOverdue([{ cents: 1010 }])?.title).toBe("1 gasto venció hoy por USD 10,10");
    expect(summarizeOverdue([])).toBeNull();
  });
  it("por revisar", () => {
    expect(summarizeReviewPending(1)?.title).toContain("1 gasto espera");
    expect(summarizeReviewPending(2)?.title).toContain("2 gastos esperan");
    expect(summarizeReviewPending(0)).toBeNull();
  });
  it("cambio después de pagado, con signo", () => {
    expect(summarizeAutoChanged({ concept: "Comisión Whop · octubre 2026", driftCents: -420 }).title).toBe("Comisión Whop · octubre 2026 cambió después de pagado: diferencia −USD 4,20");
  });
});
