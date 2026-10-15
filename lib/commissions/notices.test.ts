import { describe, expect, it } from "vitest";
import { generatedNotice, payoutPaidNotice, reviewNeededNotice } from "./notices";

describe("avisos de comisiones", () => {
  it("generadas: dice el monto y la venta", () => {
    expect(generatedNotice({ totalCents: 3882, contactName: "Pedro" }).title).toBe("Generaste USD 38,82 en comisiones por la venta de Pedro");
    expect(generatedNotice({ totalCents: 3882, contactName: "  " }).title).toBe("Generaste USD 38,82 en comisiones");
  });
  it("pagadas: dice el total y la fecha si hay", () => {
    expect(payoutPaidNotice({ totalCents: 7000, paidDate: "2026-11-06" })).toMatchObject({ title: "Se pagaron tus comisiones: USD 70,00", body: "El pago figura con fecha 2026-11-06." });
    expect(payoutPaidNotice({ totalCents: 7000, paidDate: null }).body).toBe("Ya figuran como pagadas.");
  });
  it("revisión: singular y plural", () => {
    expect(reviewNeededNotice({ count: 1 }).title).toContain("1 comisión ya liquidada");
    expect(reviewNeededNotice({ count: 3 }).title).toContain("3 comisiones ya liquidadas");
  });
});
