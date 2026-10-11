import { describe, expect, it } from "vitest";
import { balanceCents, calculateBalance, calculateTotalPaid, fromCents, num, sumAmounts, toCents, totalPaidCents } from "./money";
import { formatAmount, formatMoney } from "./format";

describe("dinero en céntimos", () => {
  it("num nunca devuelve NaN", () => {
    expect(num(undefined)).toBe(0);
    expect(num("abc")).toBe(0);
    expect(num(null)).toBe(0);
    expect(num("12.5")).toBe(12.5);
  });

  it("toCents redondea los importes que no cierran redondo", () => {
    expect(toCents(416.67)).toBe(41667);
    expect(toCents(1297.33)).toBe(129733);
    expect(toCents("0.1")).toBe(10);
    expect(fromCents(129733)).toBe(1297.33);
  });

  it("0.1 + 0.2 cierra exacto (con === en flotante daría 0.30000000000000004)", () => {
    expect(0.1 + 0.2 === 0.3).toBe(false);
    expect(sumAmounts([0.1, 0.2])).toBe(0.3);
    expect(totalPaidCents([{ amount: 0.1, status: "paid" }, { amount: 0.2, status: "paid" }])).toBe(30);
  });

  it("tres cuotas de 416.67 + 416.67 + 416.66 saldan 1250 sin resto", () => {
    const pagos = [416.67, 416.67, 416.66].map((amount) => ({ amount, status: "paid" }));
    expect(balanceCents(1250, pagos)).toBe(0);
    expect(calculateBalance(1250, pagos)).toBe(0);
    // en flotante, un saldo "de 3 cuotas" sí se descuadra con otros importes
    expect(300.84 - (100.28 + 100.28 + 100.28) === 0).toBe(false);
    expect(balanceCents(300.84, [100.28, 100.28, 100.28].map((amount) => ({ amount, status: "paid" })))).toBe(0);
  });

  it("solo cuentan los pagos cobrados; un reembolso (monto negativo) resta solo", () => {
    const pagos = [
      { amount: 1000, status: "paid" },
      { amount: 250, status: "scheduled" },
      { amount: 250, status: "uncollectible" },
      { amount: -297.33, status: "paid" },
    ];
    expect(calculateTotalPaid(pagos)).toBe(702.67);
    expect(calculateBalance(1250, pagos)).toBe(547.33);
  });

  it("tolera montos inválidos de la base", () => {
    expect(calculateTotalPaid([{ amount: undefined, status: "paid" }, { amount: "x", status: "paid" }])).toBe(0);
    expect(calculateBalance(undefined, null)).toBe(0);
  });
});

describe("formatMoney", () => {
  it("usa punto de miles y coma decimal", () => {
    expect(formatMoney(1297)).toBe("$1.297,00");
    expect(formatMoney(12000)).toBe("$12.000,00");
    expect(formatMoney(416.67)).toBe("$416,67");
    expect(formatMoney(0)).toBe("$0,00");
  });
  it("los negativos van entre paréntesis", () => {
    expect(formatMoney(-250)).toBe("($250,00)");
  });
  it("formatAmount no agrega separadores", () => {
    expect(formatAmount(1297.3)).toBe("1297.30");
  });
});
