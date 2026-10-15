import { describe, expect, it } from "vitest";
import { DEFAULT_EXPENSE_CATEGORIES } from "./categories";
import { emptyExpenseFilters } from "./expense-filters";
import { EXPENSES_CSV_LIMIT } from "./expenses-csv";
import { EXPENSE_STATUS_KEYS } from "./expense-status";
import { RECEIPT_MAX_BYTES } from "./receipts";
import { amountClasses, receiptPickError, categoryOptionGroups, describeOrigin, driftExplanation, driftNotice, exportHref, exportWarning, expenseStatusClasses, formatCivilDate, receiptKind } from "./view";

describe("formatCivilDate", () => {
  it("escribe la fecha sin pasar por una zona", () => {
    expect(formatCivilDate("2026-10-05")).toBe("5 oct 2026");
    expect(formatCivilDate("2026-01-31")).toBe("31 ene 2026");
    expect(formatCivilDate("2026-12-01")).toBe("1 dic 2026");
  });
  it("lo que no es una fecha es un guion", () => {
    expect(formatCivilDate(null)).toBe("—");
    expect(formatCivilDate("")).toBe("—");
    expect(formatCivilDate("2026-13-01")).toBe("—");
    expect(formatCivilDate("ayer")).toBe("—");
  });
});

describe("colores", () => {
  it("cada estado tiene su chip y son todos distintos", () => {
    const classes = EXPENSE_STATUS_KEYS.map((s) => expenseStatusClasses(s));
    expect(new Set(classes).size).toBe(EXPENSE_STATUS_KEYS.length);
    expect(expenseStatusClasses("vencido")).toContain("red");
    expect(expenseStatusClasses("pagado")).toContain("green");
  });
  it("un estado desconocido cae al gris", () => {
    expect(expenseStatusClasses("raro")).toBe(expenseStatusClasses("anulado"));
  });
  it("solo el monto negativo va en rojo", () => {
    expect(amountClasses(-4.2)).toContain("red");
    expect(amountClasses(4.2)).toBe("");
    expect(amountClasses(null)).toBe("");
  });
});

describe("describeOrigin", () => {
  it("manual", () => {
    expect(describeOrigin({ origin: "manual" })).toMatchObject({ kind: "manual", title: "Cargado a mano", href: null });
  });
  it("recurrente lleva link a las plantillas y el nombre si se conoce", () => {
    const d = describeOrigin({ origin: "recurring", recurring_expense_id: "r1" }, { recurringConcept: "Google Workspace" });
    expect(d.href).toBe("/dashboard/finanzas/recurrentes");
    expect(d.detail).toContain("Google Workspace");
  });
  it("comisión de procesador: el método, el mes y la cantidad de pagos", () => {
    const d = describeOrigin({ origin: "processor_fee", source_ref: { kind: "processor_fee", method: "whop", month: "2026-10", payment_count: 37 } }, { methodName: () => "Whop" });
    expect(d.detail).toBe("Comisiones de Whop de octubre 2026: 37 pagos.");
  });
  it("un solo pago va en singular, y sin source_ref no se inventa nada", () => {
    expect(describeOrigin({ origin: "processor_fee", source_ref: { method: "stripe", month: "2026-09", payment_count: 1 } }).detail).toBe("Comisiones de stripe de septiembre 2026: 1 pago.");
    expect(describeOrigin({ origin: "processor_fee", source_ref: null }).detail).toBe("Comisiones.");
    expect(describeOrigin({ origin: "meta_ads", source_ref: "basura" }).detail).toBe("Pauta de Meta.");
  });
  it("pauta de Meta: la cuenta, el mes y los días con datos", () => {
    const d = describeOrigin({ origin: "meta_ads", source_ref: { ad_account_id: "act_123", month: "2026-10", days_with_data: 14 } });
    expect(d.detail).toBe("Pauta de Meta (cuenta act_123) de octubre 2026: 14 días con datos.");
  });
  it("un ajuste lleva al gasto original", () => {
    const d = describeOrigin({ origin: "adjustment", adjusts_expense_id: "e1" }, { adjustedConcept: "Comisión Whop" });
    expect(d.href).toBe("/dashboard/finanzas/gastos/e1");
    expect(d.detail).toBe("Ajusta «Comisión Whop».");
  });
  it("una liquidación cuenta sus comisiones", () => {
    expect(describeOrigin({ origin: "commission_payout", source_ref: { count: 3 } }).detail).toBe("Suma 3 comisiones.");
  });
  it("un origen desconocido se muestra tal cual", () => {
    expect(describeOrigin({ origin: "nuevo" })).toMatchObject({ kind: "unknown", title: "nuevo" });
  });
});

describe("driftNotice", () => {
  it("avisa la diferencia con su signo", () => {
    expect(driftNotice({ auto_drift_amount: -4.2, auto_drift_resolved_at: null })).toBe("El monto cambió después de pagado: diferencia −USD 4,20");
    expect(driftNotice({ auto_drift_amount: 12 })).toBe("El monto cambió después de pagado: diferencia USD 12,00");
  });
  it("no avisa si no hay diferencia, está en cero o ya se resolvió", () => {
    expect(driftNotice({ auto_drift_amount: null })).toBeNull();
    expect(driftNotice({})).toBeNull();
    expect(driftNotice({ auto_drift_amount: 0 })).toBeNull();
    expect(driftNotice({ auto_drift_amount: -4.2, auto_drift_resolved_at: "2026-10-12T10:00:00Z" })).toBeNull();
  });
});

describe("CSV", () => {
  it("el link lleva los mismos filtros y nunca la página", () => {
    expect(exportHref(emptyExpenseFilters())).toBe("/api/v1/expenses/export");
    expect(exportHref({ ...emptyExpenseFilters(), pill: "vencidos", page: 4, q: "agencia" })).toBe("/api/v1/expenses/export?pastilla=vencidos&q=agencia");
  });
  it("avisa solo cuando el filtro pasa el tope", () => {
    expect(exportWarning(EXPENSES_CSV_LIMIT)).toBeNull();
    expect(exportWarning(EXPENSES_CSV_LIMIT + 1)).toContain("como máximo");
  });
});

describe("categoryOptionGroups", () => {
  it("agrupa por grupo y deja afuera las archivadas", () => {
    const cats = DEFAULT_EXPENSE_CATEGORIES.map((c) => (c.key === "taxes" ? { ...c, archived_at: "2026-01-01", system: false } : c));
    const groups = categoryOptionGroups(cats);
    expect(groups.map((g) => g.label)).toEqual(["Adquisición", "Entrega", "Operación", "Otro"]);
    expect(groups.flatMap((g) => g.options.map((o) => o.key))).not.toContain("taxes");
  });
  it("conserva la archivada que el gasto ya tiene, marcada", () => {
    const cats = DEFAULT_EXPENSE_CATEGORIES.map((c) => (c.key === "taxes" ? { ...c, archived_at: "2026-01-01", system: false } : c));
    const otro = categoryOptionGroups(cats, "taxes").find((g) => g.group === "otro");
    expect(otro?.options.find((o) => o.key === "taxes")?.name).toBe("Impuestos (archivada)");
  });
});

describe("receiptKind", () => {
  it("distingue PDF, imagen y otro", () => {
    expect(receiptKind("Factura.PDF")).toBe("pdf");
    expect(receiptKind("foto.jpeg")).toBe("image");
    expect(receiptKind("foto.heic")).toBe("image");
    expect(receiptKind("datos.zip")).toBe("file");
    expect(receiptKind(null)).toBe("file");
  });
});

describe("receiptPickError", () => {
  it("rechaza lo vacío y lo que pasa de 10 MB", () => {
    expect(receiptPickError({ size: 0 })).toBe("El archivo está vacío");
    expect(receiptPickError({ size: RECEIPT_MAX_BYTES + 1 })).toBe("El comprobante pesa más de 10 MB");
    expect(receiptPickError({ size: RECEIPT_MAX_BYTES })).toBeNull();
  });
});

describe("driftExplanation", () => {
  it("dice si falta pagar o se pagó de más, siempre con el monto sin signo", () => {
    expect(driftExplanation(420)).toBe("El monto subió después de pagado: faltan USD 4,20 por pagar.");
    expect(driftExplanation(-420)).toBe("El monto bajó después de pagado: se pagaron USD 4,20 de más.");
    expect(driftExplanation(0)).toBe("No hay diferencia.");
  });
});
