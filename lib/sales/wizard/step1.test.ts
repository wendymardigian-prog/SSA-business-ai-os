import { describe, expect, it } from "vitest";
import { activeSalesOfProduct, draftAttributionType, validateStep1, type Step1Context, type Step1State } from "./step1";

const state = (over: Partial<Step1State> = {}): Step1State => ({
  contactId: "c1", setterId: null, vendedorId: null, attribution: { mode: "last_touch" }, saleDate: "2026-10-10", notes: "", bookingId: null, ...over,
});
const ctx = (over: Partial<Step1Context> = {}): Step1Context => ({ today: "2026-10-11", touchCount: 0, doNotContact: false, overduePayments: 0, ...over });

describe("validateStep1", () => {
  it("sin toques «Siguiente» queda HABILITADO y el borrador queda 'none'", () => {
    expect(validateStep1(state(), ctx({ touchCount: 0 })).canAdvance).toBe(true);
    expect(draftAttributionType({ mode: "last_touch" }, 0)).toBe("none");
  });

  it("con toques y sin editar el borrador queda last_touch; al elegir otro o cargar a mano, manual", () => {
    expect(draftAttributionType({ mode: "last_touch" }, 3)).toBe("last_touch");
    expect(draftAttributionType({ mode: "touch", touchId: "t" }, 3)).toBe("manual");
    expect(draftAttributionType({ mode: "manual", manual: { source: "web" } }, 0)).toBe("manual");
  });

  it("una fecha futura (en la zona del workspace) se rechaza", () => {
    const r = validateStep1(state({ saleDate: "2026-10-12" }), ctx());
    expect(r.canAdvance).toBe(false);
    expect(r.errors[0]).toMatchObject({ field: "saleDate" });
    expect(validateStep1(state({ saleDate: "2026-10-11" }), ctx()).canAdvance).toBe(true);
  });

  it("sin contacto no avanza", () => {
    expect(validateStep1(state({ contactId: null }), ctx())).toMatchObject({ canAdvance: false, errors: [{ field: "contact" }] });
  });

  it("'no contactar' y pagos morosos avisan SIN bloquear", () => {
    const r = validateStep1(state(), ctx({ doNotContact: true, overduePayments: 2 }));
    expect(r.canAdvance).toBe(true);
    expect(r.warnings.map((w) => w.kind)).toEqual(["do_not_contact", "overdue_payments"]);
    expect(r.warnings[1].text).toContain("2 pagos morosos");
  });
});

describe("activeSalesOfProduct", () => {
  const sales = [
    { id: "1", status: "pending_payment", productId: "p1" },
    { id: "2", status: "cancelled", productId: "p1" },
    { id: "3", status: "refunded", productId: "p1" },
    { id: "4", status: "paid", productId: "p2" },
    { id: "5", status: "subscription_cancelled", productId: "p1" },
  ];
  it("cuenta las activas del mismo producto (no canceladas, reembolsadas ni con suscripción cancelada)", () => {
    expect(activeSalesOfProduct(sales, "p1").map((s) => s.id)).toEqual(["1"]);
    expect(activeSalesOfProduct(sales, null)).toEqual([]);
  });
});
