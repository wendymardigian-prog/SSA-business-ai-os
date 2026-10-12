import { describe, expect, it } from "vitest";
import { archiveLeavesProductUnsellable, describeBilling, describeDuration, describeGuarantee, parseVariantInput, variantRow } from "./variants";

const base = { name: "Estándar", durationType: "lifetime", billingType: "one_time" } as const;

describe("parseVariantInput", () => {
  it("lifetime deja la duración en null aunque llegue un valor", () => {
    const r = parseVariantInput({ ...base, durationValue: 5 });
    expect(r).toMatchObject({ ok: true, fields: { duration_type: "lifetime", duration_value: null } });
  });
  it("una duración que no es lifetime pide el valor", () => {
    expect(parseVariantInput({ ...base, durationType: "months" })).toMatchObject({ ok: false });
    expect(parseVariantInput({ ...base, durationType: "months", durationValue: 6 })).toMatchObject({ ok: true, fields: { duration_value: 6 } });
  });
  it("recurring exige el intervalo; one_time lo deja en null", () => {
    expect(parseVariantInput({ ...base, billingType: "recurring" })).toMatchObject({ ok: false });
    expect(parseVariantInput({ ...base, billingType: "recurring", billingInterval: "monthly" })).toMatchObject({ ok: true, fields: { billing_interval: "monthly" } });
    expect(parseVariantInput({ ...base, billingInterval: "yearly" })).toMatchObject({ ok: true, fields: { billing_interval: null } });
  });
  it("la garantía son las dos cosas o ninguna", () => {
    expect(parseVariantInput({ ...base, guaranteeType: "days" })).toMatchObject({ ok: false });
    expect(parseVariantInput({ ...base, guaranteeValue: 30 })).toMatchObject({ ok: false });
    expect(parseVariantInput({ ...base, guaranteeType: "days", guaranteeValue: 30 })).toMatchObject({
      ok: true,
      fields: { guarantee_duration_type: "days", guarantee_duration_value: 30 },
    });
    expect(parseVariantInput({ ...base, guaranteeType: "", guaranteeValue: "" })).toMatchObject({ ok: true, fields: { guarantee_duration_type: null } });
  });
  it("rechaza un nombre vacío y valores no positivos", () => {
    expect(parseVariantInput({ ...base, name: "  " })).toMatchObject({ ok: false });
    expect(parseVariantInput({ ...base, durationType: "days", durationValue: 0 })).toMatchObject({ ok: false });
  });
});

describe("textos", () => {
  it("duración, garantía y facturación", () => {
    expect(describeDuration("months", 1)).toBe("1 mes");
    expect(describeDuration("months", 6)).toBe("6 meses");
    expect(describeDuration("lifetime", null)).toBe("De por vida");
    expect(describeGuarantee(null, null)).toBe("Sin garantía");
    expect(describeGuarantee("days", 30)).toBe("30 días de garantía");
    expect(describeBilling("one_time", null)).toBe("Pago único");
    expect(describeBilling("recurring", "monthly")).toBe("Recurrente, todos los meses");
  });
});

describe("variantRow", () => {
  const variant = { id: "v1", name: "Estándar", duration_type: "lifetime", duration_value: null, guarantee_duration_type: null, guarantee_duration_value: null, billing_type: "one_time", billing_interval: null, archived_at: null };
  it("con versión activa se vende y muestra el precio", () => {
    expect(variantRow(variant, 3000)).toMatchObject({ priceLabel: "$3.000,00", sellable: true });
  });
  it("sin versión activa no se vende y se dice por qué", () => {
    expect(variantRow(variant, null)).toMatchObject({ priceLabel: "Sin precio", sellable: false });
  });
  it("una archivada no se vende", () => {
    expect(variantRow({ ...variant, archived_at: "2026-10-01" }, 3000).sellable).toBe(false);
  });
});

it("archivar la única variante activa deja el producto sin poder venderse", () => {
  const vs = [{ id: "a", archived_at: null }, { id: "b", archived_at: "2026-10-01" }];
  expect(archiveLeavesProductUnsellable(vs, "a")).toBe(true);
  expect(archiveLeavesProductUnsellable([...vs, { id: "c", archived_at: null }], "a")).toBe(false);
});
