import { describe, expect, it } from "vitest";
import cases from "./auto-expenses.cases.json";
import {
  autoClosePaidDate,
  autoExpenseConcept,
  autoKey,
  decideAutoExpenseAction,
  driftAgainst,
  hasMetaAccountLevelRows,
  monthsInWindow,
  parseAutoKey,
  shouldAutoClose,
  sumMetaSpendCents,
  sumProcessorFeeCents,
  zeroVoidReason,
  type AutoDecisionContext,
  type ExistingAutoExpense,
  type FeePayment,
  type MetaInsightRow,
} from "./auto-expenses";

interface Case {
  name: string;
  existing: ExistingAutoExpense | null;
  total: number;
  ctx: AutoDecisionContext;
  expected: unknown;
}

describe("decideAutoExpenseAction: los 8 casos de GF20 (los mismos que corre upsert_auto_expense)", () => {
  const eight = cases.cases as Case[];

  it("son exactamente 8, en el orden de la tabla", () => {
    expect(eight).toHaveLength(8);
    expect(eight.map((c) => c.name.slice(0, 2))).toEqual(["1.", "2.", "3.", "4.", "5.", "6.", "7.", "8."]);
  });

  for (const c of eight) {
    it(c.name, () => {
      expect(decideAutoExpenseAction(c.existing, c.total, c.ctx)).toEqual(c.expected);
    });
  }
});

describe("decideAutoExpenseAction: matices (también los cumple el SQL)", () => {
  for (const c of cases.extra as Case[]) {
    it(c.name, () => {
      expect(decideAutoExpenseAction(c.existing, c.total, c.ctx)).toEqual(c.expected);
    });
  }

  it("un total negativo o NaN se trata como 0", () => {
    const ctx = { todayLocal: "2026-10-20", month: "2026-10", chargeMode: "automatic" } as const;
    expect(decideAutoExpenseAction(null, -50, ctx)).toEqual({ kind: "none" });
    expect(decideAutoExpenseAction(null, Number.NaN, ctx)).toEqual({ kind: "none" });
  });

  it("es idempotente: aplicar la acción y volver a decidir da 'none'", () => {
    const ctx = { todayLocal: "2026-10-20", month: "2026-10", chargeMode: "automatic" } as const;
    const created = decideAutoExpenseAction(null, 1548, ctx);
    expect(created).toMatchObject({ kind: "create" });
    const now: ExistingAutoExpense = { status: "programado", amountCents: 1548, voidKind: null, driftCents: null, driftResolved: false, adjustmentsCents: [] };
    expect(decideAutoExpenseAction(now, 1548, ctx)).toEqual({ kind: "none" });
  });

  it("la segunda mitad del mes suma: el monto sube y no se crea otro gasto", () => {
    const ctx = { todayLocal: "2026-10-21", month: "2026-10", chargeMode: "automatic" } as const;
    const existing: ExistingAutoExpense = { status: "programado", amountCents: 1548, voidKind: null, driftCents: null, driftResolved: false, adjustmentsCents: [] };
    expect(decideAutoExpenseAction(existing, 1548 + 700, ctx)).toEqual({ kind: "update_amount", amountCents: 2248 });
  });
});

describe("driftAgainst (GF22)", () => {
  it("pagado 50,00 y recálculo 45,80: diferencia −4,20", () => {
    expect(driftAgainst(5000, [], 4580)).toBe(-420);
  });
  it("con un ajuste de −4,20 ya creado y el recálculo en 45,80, no hay diferencia", () => {
    expect(driftAgainst(5000, [-420], 4580)).toBe(0);
  });
  it("con ese ajuste y el recálculo en 44,80: −1,00 (no −5,20)", () => {
    expect(driftAgainst(5000, [-420], 4480)).toBe(-100);
  });
  it("varios ajustes suman con su signo", () => {
    expect(driftAgainst(5000, [-420, 100], 5000)).toBe(320);
  });
  it("una diferencia a favor es positiva", () => {
    expect(driftAgainst(5000, [], 5300)).toBe(300);
  });
});

describe("claves y textos", () => {
  it("autoKey", () => {
    expect(autoKey("processor_fee", "whop", "2026-10")).toBe("processor_fee:whop:2026-10");
    expect(autoKey("meta_ads", "act_123", "2026-10")).toBe("meta_ads:act_123:2026-10");
  });
  it("autoKey rechaza un mes mal formado o una referencia vacía", () => {
    expect(() => autoKey("processor_fee", "whop", "2026-13")).toThrow();
    expect(() => autoKey("processor_fee", "whop", "octubre")).toThrow();
    expect(() => autoKey("meta_ads", "", "2026-10")).toThrow();
  });
  it("parseAutoKey es la inversa", () => {
    expect(parseAutoKey("processor_fee:whop:2026-10")).toEqual({ kind: "processor_fee", ref: "whop", month: "2026-10" });
    expect(parseAutoKey("meta_ads:act_123:2026-10")).toEqual({ kind: "meta_ads", ref: "act_123", month: "2026-10" });
    expect(parseAutoKey("otra:cosa:2026-10")).toBeNull();
    expect(parseAutoKey(null)).toBeNull();
  });
  it("concepto", () => {
    expect(autoExpenseConcept({ kind: "processor_fee", name: "Whop", month: "2026-10" })).toBe("Comisión Whop · octubre 2026");
    expect(autoExpenseConcept({ kind: "meta_ads", name: "Wendy", month: "2026-10" })).toBe("Pauta Meta (Wendy) · octubre 2026");
  });
  it("motivo de anulación por cero", () => {
    expect(zeroVoidReason("processor_fee")).toBe("La comisión del mes quedó en cero");
    expect(zeroVoidReason("meta_ads")).toBe("La pauta del mes quedó en cero");
  });
});

describe("monthsInWindow", () => {
  it("el mes actual y los 2 anteriores, del más viejo al actual", () => {
    expect(monthsInWindow("2026-10-15")).toEqual(["2026-08", "2026-09", "2026-10"]);
  });
  it("cruza el año", () => {
    expect(monthsInWindow("2027-01-05")).toEqual(["2026-11", "2026-12", "2027-01"]);
  });
  it("otra cantidad", () => {
    expect(monthsInWindow("2026-10-15", 1)).toEqual(["2026-10"]);
  });
});

describe("shouldAutoClose", () => {
  const exp = { status: "programado", origin: "processor_fee", amount: 15.48, scheduled_date: "2026-10-31", auto_key: "processor_fee:whop:2026-10" };
  const setting = { chargeMode: "automatic", autoCloseDays: 3 } as const;

  it("con 3 días: el 2026-11-03 sí, el 2026-11-02 no", () => {
    expect(shouldAutoClose(exp, setting, "2026-11-03")).toBe(true);
    expect(shouldAutoClose(exp, setting, "2026-11-02")).toBe(false);
    expect(shouldAutoClose(exp, setting, "2026-10-31")).toBe(false);
  });
  it("se cierra con paid_date = último día del mes", () => {
    expect(autoClosePaidDate(exp)).toBe("2026-10-31");
    expect(autoClosePaidDate({ ...exp, auto_key: null })).toBe("2026-10-31");
  });
  it("con 0 días cierra el primer día del mes siguiente", () => {
    expect(shouldAutoClose(exp, { chargeMode: "automatic", autoCloseDays: 0 }, "2026-11-01")).toBe(true);
    expect(shouldAutoClose(exp, { chargeMode: "automatic", autoCloseDays: 0 }, "2026-10-31")).toBe(false);
  });
  it("con cobro a mano nunca", () => {
    expect(shouldAutoClose(exp, { chargeMode: "manual", autoCloseDays: 3 }, "2027-01-01")).toBe(false);
  });
  it("solo sin pagar y de un origen automático y con monto", () => {
    expect(shouldAutoClose({ ...exp, status: "pagado" }, setting, "2026-11-10")).toBe(false);
    expect(shouldAutoClose({ ...exp, status: "anulado" }, setting, "2026-11-10")).toBe(false);
    expect(shouldAutoClose({ ...exp, status: "vencido" }, setting, "2026-11-10")).toBe(true);
    expect(shouldAutoClose({ ...exp, origin: "manual" }, setting, "2026-11-10")).toBe(false);
    expect(shouldAutoClose({ ...exp, amount: 0 }, setting, "2026-11-10")).toBe(false);
  });
  it("un diciembre cierra en enero", () => {
    const dec = { ...exp, scheduled_date: "2026-12-31", auto_key: "processor_fee:whop:2026-12" };
    expect(shouldAutoClose(dec, setting, "2027-01-03")).toBe(true);
    expect(shouldAutoClose(dec, setting, "2027-01-02")).toBe(false);
  });
});

describe("sumProcessorFeeCents (GF20)", () => {
  const p = (over: Partial<FeePayment>): FeePayment => ({ payment_method: "whop", type: "installment", status: "paid", provider_fee_amount: 1, paid_at: "2026-10-10T15:00:00Z", ...over });

  it("tres pagos de octubre con 3,00 + 12,38 + 0,10 suman 15,48 exacto", () => {
    const rows = [p({ provider_fee_amount: 3 }), p({ provider_fee_amount: 12.38 }), p({ provider_fee_amount: 0.1 })];
    expect(sumProcessorFeeCents(rows, "whop", "2026-10", "America/Costa_Rica")).toBe(1548);
  });

  it("un pago del 2026-10-31 23:30 hora Costa Rica (05:30 UTC del 1/11) cuenta en octubre", () => {
    const rows = [p({ provider_fee_amount: 5, paid_at: "2026-11-01T05:30:00Z" })];
    expect(sumProcessorFeeCents(rows, "whop", "2026-10", "America/Costa_Rica")).toBe(500);
    expect(sumProcessorFeeCents(rows, "whop", "2026-11", "America/Costa_Rica")).toBe(0);
    // En UTC ese mismo instante es noviembre.
    expect(sumProcessorFeeCents(rows, "whop", "2026-11", "UTC")).toBe(500);
  });

  it("un pago reembolsado sigue sumando su comisión; la fila refund aporta 0", () => {
    const rows = [p({ provider_fee_amount: 14.91 }), p({ type: "refund", provider_fee_amount: null })];
    expect(sumProcessorFeeCents(rows, "whop", "2026-10", "UTC")).toBe(1491);
  });

  it("no suma un refund aunque trajera comisión, ni pagos no cobrados, ni de otro método", () => {
    const rows = [p({ type: "refund", provider_fee_amount: 2 }), p({ status: "scheduled", provider_fee_amount: 2 }), p({ status: "cancelled", provider_fee_amount: 2 }), p({ payment_method: "wise", provider_fee_amount: 2 }), p({ paid_at: null, provider_fee_amount: 2 })];
    expect(sumProcessorFeeCents(rows, "whop", "2026-10", "UTC")).toBe(0);
  });

  it("los pagos de otro mes no entran", () => {
    expect(sumProcessorFeeCents([p({ paid_at: "2026-09-30T12:00:00Z", provider_fee_amount: 9 })], "whop", "2026-10", "UTC")).toBe(0);
  });

  it("la suma es exacta, no céntimo por céntimo con errores de flotante", () => {
    const rows = Array.from({ length: 10 }, () => p({ provider_fee_amount: 0.1 }));
    expect(sumProcessorFeeCents(rows, "whop", "2026-10", "UTC")).toBe(100);
  });
});

describe("sumMetaSpendCents (GF21)", () => {
  const r = (over: Partial<MetaInsightRow>): MetaInsightRow => ({ ad_account_id: "act_1", level: "account", date: "2026-10-05", spend: 10, ...over });

  it("suma solo el nivel account: no duplica con campaign", () => {
    const rows = [r({ spend: 300.12 }), r({ date: "2026-10-06", spend: 212.22 }), r({ level: "campaign", spend: 300.12 }), r({ level: "campaign", date: "2026-10-06", spend: 212.22 })];
    expect(sumMetaSpendCents(rows, "act_1", "2026-10")).toBe(51234);
  });
  it("solo la cuenta y el mes pedidos", () => {
    const rows = [r({ spend: 10 }), r({ ad_account_id: "act_2", spend: 99 }), r({ date: "2026-09-30", spend: 50 }), r({ date: "2026-11-01", spend: 50 })];
    expect(sumMetaSpendCents(rows, "act_1", "2026-10")).toBe(1000);
  });
  it("acepta una fecha con hora", () => {
    expect(sumMetaSpendCents([r({ date: "2026-10-05T00:00:00Z", spend: 7 })], "act_1", "2026-10")).toBe(700);
  });
  it("hasMetaAccountLevelRows distingue 'sin datos de nivel cuenta' de 'gasto 0'", () => {
    expect(hasMetaAccountLevelRows([r({ level: "campaign" })], "act_1", "2026-10")).toBe(false);
    expect(hasMetaAccountLevelRows([r({ spend: 0 })], "act_1", "2026-10")).toBe(true);
    expect(hasMetaAccountLevelRows([], "act_1", "2026-10")).toBe(false);
  });
});
