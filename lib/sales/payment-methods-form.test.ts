import { describe, expect, it } from "vitest";
import { starterPaymentMethods } from "./payment-methods-config";
import { EMPTY_DRAFT, draftFromMethod, feeSummary, methodsPayload, parseDecimal, parseDraft, togglePayload } from "./payment-methods-form";

const others = starterPaymentMethods();

describe("parseDecimal", () => {
  it("acepta coma o punto, vacío es 0 y basura es null", () => {
    expect(parseDecimal("2,9")).toBe(2.9);
    expect(parseDecimal("2.9")).toBe(2.9);
    expect(parseDecimal("")).toBe(0);
    expect(parseDecimal("  ")).toBe(0);
    expect(parseDecimal("dos")).toBeNull();
    expect(parseDecimal("-1")).toBeNull();
    expect(parseDecimal("1,2,3")).toBeNull();
  });
});

describe("parseDraft", () => {
  it("un método válido", () => {
    expect(parseDraft({ ...EMPTY_DRAFT, name: " Stripe ", percent: "2,9", fixed: "0,30" }, others)).toEqual({ ok: true, value: { name: "Stripe", fee_percent: 2.9, fee_fixed: 0.3 } });
  });
  it("pide nombre y no admite uno repetido (mayúsculas aparte)", () => {
    expect(parseDraft({ ...EMPTY_DRAFT, name: "" }, others)).toMatchObject({ ok: false });
    expect(parseDraft({ ...EMPTY_DRAFT, name: "wise" }, others)).toMatchObject({ ok: false });
  });
  it("editar un método con su propio nombre no es un choque", () => {
    expect(parseDraft({ ...EMPTY_DRAFT, key: "wise", name: "Wise", percent: "1" }, others)).toMatchObject({ ok: true });
  });
  it("porcentaje de 0 a 100 con hasta 3 decimales y fijo con hasta 2", () => {
    expect(parseDraft({ ...EMPTY_DRAFT, name: "X", percent: "101" }, others)).toMatchObject({ ok: false });
    expect(parseDraft({ ...EMPTY_DRAFT, name: "X", percent: "2,1259" }, others)).toMatchObject({ ok: false });
    expect(parseDraft({ ...EMPTY_DRAFT, name: "X", percent: "2,125" }, others)).toMatchObject({ ok: true });
    expect(parseDraft({ ...EMPTY_DRAFT, name: "X", fixed: "0,305" }, others)).toMatchObject({ ok: false });
    expect(parseDraft({ ...EMPTY_DRAFT, name: "X", fixed: "abc" }, others)).toMatchObject({ ok: false });
  });
});

describe("payloads", () => {
  it("un método nuevo va al final sin key; uno existente conserva la suya", () => {
    const created = methodsPayload(others, { ...EMPTY_DRAFT, name: "Stripe" }, { name: "Stripe", fee_percent: 2.9, fee_fixed: 0.3 });
    expect(created).toHaveLength(6);
    expect(created[5]).toEqual({ name: "Stripe", fee_percent: 2.9, fee_fixed: 0.3, active: true });
    const edited = methodsPayload(others, { ...draftFromMethod(others[3]), percent: "1" }, { name: "Wise", fee_percent: 1, fee_fixed: 0 });
    expect(edited).toHaveLength(5);
    expect(edited[3]).toMatchObject({ key: "wise", fee_percent: 1 });
  });
  it("togglePayload cambia solo el activo del método pedido", () => {
    const out = togglePayload(others, "wise", false);
    expect(out.find((m) => m.key === "wise")?.active).toBe(false);
    expect(out.filter((m) => m.active)).toHaveLength(4);
  });
});

describe("feeSummary y draftFromMethod", () => {
  it("lo dice en palabras", () => {
    expect(feeSummary({ fee_percent: 2.9, fee_fixed: 0.3 })).toBe("2,9 % + USD 0,30");
    expect(feeSummary({ fee_percent: 0, fee_fixed: 0.5 })).toBe("USD 0,50");
    expect(feeSummary({ fee_percent: 3, fee_fixed: 0 })).toBe("3 %");
    expect(feeSummary({ fee_percent: 0, fee_fixed: 0 })).toBe("Sin comisión");
  });
  it("el borrador de un método con comisión 0 deja los campos vacíos", () => {
    expect(draftFromMethod(others[0])).toMatchObject({ key: "whop", percent: "", fixed: "", active: true });
  });
});
