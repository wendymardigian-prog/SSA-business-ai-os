import { describe, expect, it } from "vitest";
import { DEFAULT_EXPENSE_CATEGORIES } from "./categories";
import { buildRecurringItem, buildRecurringList, chargeLabel, estadoHref, parseEstadoFilter, summarizeRecurring, type RecurringDbRow, type RecurringLookups } from "./recurring-list";

const TODAY = "2026-10-15";
const lookups: RecurringLookups = {
  categories: DEFAULT_EXPENSE_CATEGORIES,
  vendors: [{ id: "v1", name: "Google", archived_at: null }, { id: "v2", name: "Viejo", archived_at: "2026-01-01T00:00:00Z" }],
  members: [{ id: "u1", name: "Ana" }],
  todayLocal: TODAY,
};

const row = (over: Partial<RecurringDbRow> = {}): RecurringDbRow => ({
  id: "r1",
  concept: "Google Workspace",
  vendor_id: "v1",
  category_key: "software",
  amount_type: "fixed",
  amount: 36,
  charge_mode: "manual",
  frequency: "monthly",
  weekly_day: null,
  weekly_interval: null,
  monthly_day: 20,
  yearly_month: null,
  yearly_day: null,
  start_date: "2026-01-01",
  end_date: null,
  lead_days: 0,
  is_active: true,
  paused_at: null,
  generation_anchor: "2026-01-01",
  responsible_id: "u1",
  notes: null,
  updated_at: "2026-10-01T00:00:00Z",
  ...over,
});

describe("buildRecurringItem", () => {
  it("arma frecuencia, monto, equivalente mensual, próxima fecha y nombres", () => {
    const i = buildRecurringItem(row(), lookups);
    expect(i).toMatchObject({
      status: "active",
      statusLabel: "Activa",
      frequencyText: "Mensual, el día 20",
      amountLabel: "USD 36,00",
      monthlyCents: 3600,
      monthlyLabel: "USD 36,00",
      nextDate: "2026-10-20",
      vendorName: "Google",
      categoryName: "Software y suscripciones",
      chargeLabel: "A mano",
      responsibleName: "Ana",
    });
  });

  it("la próxima fecha incluye hoy", () => {
    expect(buildRecurringItem(row({ monthly_day: 15 }), lookups).nextDate).toBe("2026-10-15");
  });

  it("una pausada no tiene próxima fecha", () => {
    const i = buildRecurringItem(row({ is_active: false, paused_at: "2026-10-01T00:00:00Z" }), lookups);
    expect(i.status).toBe("paused");
    expect(i.nextDate).toBeNull();
  });

  it("una con fin ya pasado está terminada", () => {
    const i = buildRecurringItem(row({ end_date: "2026-09-30" }), lookups);
    expect(i.status).toBe("finished");
    expect(i.nextDate).toBeNull();
  });

  it("variable: «Variable» sin estimado y con estimado", () => {
    expect(buildRecurringItem(row({ amount_type: "variable", amount: null }), lookups)).toMatchObject({ amountLabel: "Variable", monthlyLabel: "—", monthlyCents: 0 });
    expect(buildRecurringItem(row({ amount_type: "variable", amount: 50 }), lookups)).toMatchObject({ amountLabel: "Variable (aprox. USD 50,00)", monthlyCents: 5000 });
  });

  it("proveedor archivado, sin proveedor y persona que ya no está", () => {
    expect(buildRecurringItem(row({ vendor_id: "v2" }), lookups).vendorName).toBe("Viejo (archivado)");
    expect(buildRecurringItem(row({ vendor_id: null }), lookups).vendorName).toBe("Sin proveedor");
    expect(buildRecurringItem(row({ responsible_id: "zz" }), lookups).responsibleName).toBe("Persona que ya no está en el equipo");
    expect(buildRecurringItem(row({ responsible_id: null }), lookups).responsibleName).toBeNull();
  });

  it("una fila con la frecuencia incompleta no rompe la lista", () => {
    const i = buildRecurringItem(row({ monthly_day: null }), lookups);
    expect(i.frequencyText).toMatch(/incompleta/);
    expect(i.nextDate).toBeNull();
  });
});

describe("chargeLabel", () => {
  it("débito automático ignora la anticipación", () => {
    expect(chargeLabel("automatic", 5)).toBe("Débito automático");
    expect(chargeLabel("manual", 0)).toBe("A mano");
    expect(chargeLabel("manual", 1)).toBe("A mano, 1 día antes");
    expect(chargeLabel("manual", 5)).toBe("A mano, 5 días antes");
  });
});

describe("buildRecurringList", () => {
  const rows = [
    row({ id: "a", concept: "Zoom", monthly_day: 25 }),
    row({ id: "b", concept: "Alquiler", amount: 500, monthly_day: 18 }),
    row({ id: "c", concept: "Pausada", is_active: false, paused_at: "2026-09-01T00:00:00Z" }),
    row({ id: "d", concept: "Vieja", end_date: "2026-01-31" }),
    row({ id: "e", concept: "Variable", amount_type: "variable", amount: null }),
  ];

  it("por defecto muestra las activas, ordenadas por próxima fecha, y cuenta todos los estados", () => {
    const d = buildRecurringList(rows, lookups, "activas");
    expect(d.items.map((i) => i.id)).toEqual(["b", "e", "a"]);
    expect(d.counts).toEqual({ activas: 3, pausadas: 1, terminadas: 1, todas: 5 });
  });

  it("filtra por pausadas y por terminadas; «todas» las muestra a todas con las activas primero", () => {
    expect(buildRecurringList(rows, lookups, "pausadas").items.map((i) => i.id)).toEqual(["c"]);
    expect(buildRecurringList(rows, lookups, "terminadas").items.map((i) => i.id)).toEqual(["d"]);
    expect(buildRecurringList(rows, lookups, "todas").items.map((i) => i.status)).toEqual(["active", "active", "active", "paused", "finished"]);
  });

  it("el resumen suma solo las activas, en céntimos, sea cual sea el filtro", () => {
    const a = buildRecurringList(rows, lookups, "activas").summary;
    const p = buildRecurringList(rows, lookups, "pausadas").summary;
    expect(a.monthlyCents).toBe(3600 + 50000);
    expect(p.monthlyCents).toBe(a.monthlyCents);
    expect(a.headline).toBe("Equivale a USD 536,00 por mes");
    expect(a.variableWithoutEstimate).toBe(1);
    expect(a.note).toMatch(/1 plantilla de monto variable/);
  });
});

describe("summarizeRecurring", () => {
  it("sin activas: USD 0,00 y sin aclaración", () => {
    expect(summarizeRecurring([])).toMatchObject({ monthlyCents: 0, headline: "Equivale a USD 0,00 por mes", note: null });
  });

  it("una semanal y una anual se redondean una sola vez por plantilla", () => {
    const items = [
      buildRecurringItem(row({ id: "s", frequency: "weekly", weekly_day: 1, weekly_interval: 1, monthly_day: null, amount: 10 }), lookups),
      buildRecurringItem(row({ id: "y", frequency: "yearly", yearly_month: 3, yearly_day: 1, monthly_day: null, amount: 120 }), lookups),
    ];
    expect(summarizeRecurring(items).monthlyCents).toBe(4333 + 1000);
  });
});

describe("filtro de la URL", () => {
  it("lee ?estado= y cae a «activas» con cualquier otra cosa", () => {
    expect(parseEstadoFilter("pausadas")).toBe("pausadas");
    expect(parseEstadoFilter(["terminadas", "x"])).toBe("terminadas");
    expect(parseEstadoFilter("raro")).toBe("activas");
    expect(parseEstadoFilter(undefined)).toBe("activas");
  });

  it("el link de «Activas» no lleva parámetros", () => {
    expect(estadoHref("activas")).toBe("/dashboard/finanzas/recurrentes");
    expect(estadoHref("todas")).toBe("/dashboard/finanzas/recurrentes?estado=todas");
  });
});
