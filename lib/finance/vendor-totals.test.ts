import { describe, expect, it } from "vitest";
import { countVendors, countryName, countryOptions, draftFromVendor, filterVendors, toVendorInput, totalsOf, vendorDraftError, vendorTotals, EMPTY_VENDOR_DRAFT, type VendorRow } from "./vendor-totals";

const TODAY = "2026-10-15";
const paid = (vendor_id: string | null, amount: unknown, paid_date: string | null, status?: string) => ({ vendor_id, amount, paid_date, status });

describe("vendorTotals", () => {
  it("suma en céntimos: 0,10 + 0,20 da 0,30 exacto", () => {
    const t = vendorTotals([paid("v1", 0.1, "2026-10-01"), paid("v1", 0.2, "2026-10-02")], TODAY);
    expect(t.get("v1")?.paidCents).toBe(30);
  });

  it("separa el total del año y se queda con el último pago", () => {
    const t = totalsOf(vendorTotals([paid("v1", 100, "2025-12-31"), paid("v1", 50.5, "2026-03-10"), paid("v1", 20, "2026-09-01")], TODAY), "v1");
    expect(t).toEqual({ paidCents: 17050, paidYearCents: 7050, lastPaid: "2026-09-01", count: 3 });
  });

  it("un proveedor sin pagos tiene todo en cero y sin último pago", () => {
    expect(totalsOf(vendorTotals([], TODAY), "nadie")).toEqual({ paidCents: 0, paidYearCents: 0, lastPaid: null, count: 0 });
  });

  it("ignora lo que no es pagado, no tiene fecha de pago o no tiene proveedor", () => {
    const t = vendorTotals([paid("v1", 10, "2026-10-01", "programado"), paid("v1", 10, null), paid(null, 10, "2026-10-01"), paid("v1", 5, "2026-10-01", "pagado")], TODAY);
    expect(t.get("v1")?.paidCents).toBe(500);
    expect(t.size).toBe(1);
  });

  it("un ajuste negativo resta", () => {
    expect(vendorTotals([paid("v1", 100, "2026-10-01"), paid("v1", -4.2, "2026-10-02")], TODAY).get("v1")?.paidCents).toBe(9580);
  });

  it("separa por proveedor y tolera montos raros", () => {
    const t = vendorTotals([paid("v1", "12.5", "2026-10-01"), paid("v2", undefined, "2026-10-01"), paid("v2", "x", "2026-10-02")], TODAY);
    expect(t.get("v1")?.paidCents).toBe(1250);
    expect(t.get("v2")?.paidCents).toBe(0);
  });
});

const vendor = (patch: Partial<VendorRow>): VendorRow => ({ id: "x", name: "Agencia", country: null, email: null, payment_details: null, terms: null, notes: null, user_id: null, archived_at: null, ...patch });

describe("filterVendors", () => {
  const list = [vendor({ id: "1", name: "Zeta" }), vendor({ id: "2", name: "Álvaro Diseño" }), vendor({ id: "3", name: "Archivado SA", archived_at: "2026-01-01" })];

  it("activos o archivados, por orden alfabético", () => {
    expect(filterVendors(list, { view: "activos" }).map((v) => v.id)).toEqual(["2", "1"]);
    expect(filterVendors(list, { view: "archivados" }).map((v) => v.id)).toEqual(["3"]);
  });
  it("busca por nombre sin importar mayúsculas ni tildes", () => {
    expect(filterVendors(list, { view: "activos", q: "alvaro" }).map((v) => v.id)).toEqual(["2"]);
    expect(filterVendors(list, { view: "activos", q: "ZET" }).map((v) => v.id)).toEqual(["1"]);
    expect(filterVendors(list, { view: "activos", q: "nadie" })).toEqual([]);
  });
  it("cuenta cada pastilla", () => {
    expect(countVendors(list)).toEqual({ activos: 2, archivados: 1 });
  });
});

describe("países y formulario", () => {
  it("el nombre del país, o el código si no está en la lista", () => {
    expect(countryName("CR")).toBe("Costa Rica");
    expect(countryName("DE")).toBe("DE");
    expect(countryName(null)).toBe("—");
  });
  it("un país fuera de la lista se conserva al editar", () => {
    expect(countryOptions("DE").some((c) => c.code === "DE")).toBe(true);
    expect(countryOptions("CR").filter((c) => c.code === "CR")).toHaveLength(1);
  });
  it("el borrador sale del proveedor y vuelve como entrada del servidor", () => {
    const d = draftFromVendor(vendor({ id: "9", name: "  Hosting ", country: "US", email: "a@b.co", terms: "30 días" }));
    expect(d).toMatchObject({ id: "9", country: "US", email: "a@b.co", terms: "30 días", paymentDetails: "" });
    expect(toVendorInput({ ...d, name: "  Hosting " })).toMatchObject({ name: "Hosting", country: "US" });
  });
  it("pide el nombre", () => {
    expect(vendorDraftError(EMPTY_VENDOR_DRAFT)).toBe("Poné un nombre");
    expect(vendorDraftError({ ...EMPTY_VENDOR_DRAFT, name: "X" })).toBeNull();
  });
});
