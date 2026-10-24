import { describe, expect, it } from "vitest";
import { archiveLeavesProductUnsellable, describeBilling, describeDuration, describeTiming, formatEventDate, isValidDate, parseVariantInput, variantRow } from "./variants";

const base = { name: "Estándar", durationType: "lifetime", billingType: "one_time" } as const;
const parse = (input: Record<string, unknown>, type = "programa") => parseVariantInput(input, type);

describe("parseVariantInput", () => {
  it("lifetime deja la duración en null aunque llegue un valor", () => {
    const r = parse({ ...base, durationValue: 5 });
    expect(r).toMatchObject({ ok: true, fields: { duration_type: "lifetime", duration_value: null } });
  });
  it("una duración que no es lifetime pide el valor", () => {
    expect(parse({ ...base, durationType: "months" })).toMatchObject({ ok: false });
    expect(parse({ ...base, durationType: "months", durationValue: 6 })).toMatchObject({ ok: true, fields: { duration_value: 6 } });
  });
  it("recurring exige el intervalo; one_time lo deja en null", () => {
    expect(parse({ ...base, billingType: "recurring" })).toMatchObject({ ok: false });
    expect(parse({ ...base, billingType: "recurring", billingInterval: "monthly" })).toMatchObject({ ok: true, fields: { billing_interval: "monthly" } });
    expect(parse({ ...base, billingInterval: "yearly" })).toMatchObject({ ok: true, fields: { billing_interval: null } });
  });
  it("rechaza un nombre vacío y valores no positivos", () => {
    expect(parse({ ...base, name: "  " })).toMatchObject({ ok: false });
    expect(parse({ ...base, durationType: "days", durationValue: 0 })).toMatchObject({ ok: false });
  });
  it("con duración no guarda fecha aunque llegue una", () => {
    expect(parse({ ...base, durationType: "weeks", durationValue: 2, eventDate: "2026-11-15" }, "mentoria")).toMatchObject({
      ok: true,
      fields: { duration_type: "weeks", duration_value: 2, event_date: null },
    });
  });
  it("un evento pide la fecha, que exista, y una duración que no sea «de por vida»", () => {
    const ev = { ...base, durationType: "days", durationValue: 3 };
    expect(parse(ev, "evento")).toMatchObject({ ok: false, error: "Poné la fecha del evento" });
    expect(parse({ ...ev, eventDate: "2026-02-30" }, "evento")).toMatchObject({ ok: false, error: "La fecha del evento no es válida" });
    expect(parse({ ...base, eventDate: "2026-11-15" }, "evento")).toMatchObject({ ok: false, error: "Un evento dura días, semanas o meses" });
    expect(parse({ ...ev, eventDate: "2026-11-15" }, "evento")).toMatchObject({
      ok: true,
      fields: { duration_type: "days", duration_value: 3, event_date: "2026-11-15" },
    });
  });
  it("un producto no tiene duración ni fecha", () => {
    expect(parse({ ...base, durationType: "months", durationValue: 6, eventDate: "2026-11-15" }, "producto")).toMatchObject({
      ok: true,
      fields: { duration_type: "lifetime", duration_value: null, event_date: null },
    });
    // «otro» es el nombre viejo de «producto».
    expect(parse({ name: "x", billingType: "one_time" }, "otro")).toMatchObject({ ok: true, fields: { duration_type: "lifetime" } });
  });
});

describe("textos", () => {
  it("duración, fecha y facturación", () => {
    expect(describeDuration("months", 1)).toBe("1 mes");
    expect(describeDuration("months", 6)).toBe("6 meses");
    expect(describeDuration("lifetime", null)).toBe("De por vida");
    expect(formatEventDate("2026-11-05")).toBe("5 nov 2026");
    expect(formatEventDate(null)).toBe("Sin fecha");
    expect(isValidDate("2026-02-29")).toBe(false);
    expect(isValidDate("2028-02-29")).toBe(true);
    expect(describeTiming("duration", { duration_type: "months", duration_value: 6 })).toBe("6 meses");
    expect(describeTiming("event", { duration_type: "days", duration_value: 3, event_date: "2026-11-15" })).toBe("15 nov 2026 · 3 días");
    expect(describeTiming("none", { duration_type: "lifetime", duration_value: null })).toBeNull();
    expect(describeBilling("one_time", null)).toBe("Pago único");
    expect(describeBilling("recurring", "monthly")).toBe("Recurrente, todos los meses");
  });
});

describe("variantRow", () => {
  const variant = { id: "v1", name: "Estándar", duration_type: "lifetime", duration_value: null, guarantee_duration_type: null, guarantee_duration_value: null, billing_type: "one_time", billing_interval: null, archived_at: null };
  it("con versión activa se vende y muestra el precio", () => {
    expect(variantRow(variant, 3000, "programa")).toMatchObject({ priceLabel: "$3.000,00", sellable: true, timing: "De por vida" });
  });
  it("sin versión activa no se vende y se dice por qué", () => {
    expect(variantRow(variant, null, "programa")).toMatchObject({ priceLabel: "Sin precio", sellable: false });
  });
  it("una archivada no se vende", () => {
    expect(variantRow({ ...variant, archived_at: "2026-10-01" }, 3000, "programa").sellable).toBe(false);
  });
  it("un evento sin fecha se marca; un producto no muestra duración", () => {
    expect(variantRow({ ...variant, duration_type: "days", duration_value: 1 }, 100, "evento")).toMatchObject({ missingEventDate: true });
    expect(variantRow({ ...variant, duration_type: "days", duration_value: 1, event_date: "2026-11-15" }, 100, "evento")).toMatchObject({ missingEventDate: false, timing: "15 nov 2026 · 1 día" });
    expect(variantRow(variant, 100, "producto")).toMatchObject({ timing: null, missingEventDate: false });
  });
});

it("archivar la única variante activa deja el producto sin poder venderse", () => {
  const vs = [{ id: "a", archived_at: null }, { id: "b", archived_at: "2026-10-01" }];
  expect(archiveLeavesProductUnsellable(vs, "a")).toBe(true);
  expect(archiveLeavesProductUnsellable([...vs, { id: "c", archived_at: null }], "a")).toBe(false);
});
