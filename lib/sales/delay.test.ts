import { describe, expect, it } from "vitest";
import { delayChip, paymentDelayDays } from "./delay";

describe("paymentDelayDays", () => {
  const tz = "America/Costa_Rica"; // UTC−6, sin horario de verano
  it("un cobro a las 23:50 locales del día del vencimiento es 0; a las 00:30 del siguiente, 1", () => {
    expect(paymentDelayDays("2026-10-26", "2026-10-27T05:50:00Z", tz)).toBe(0); // 26/10 23:50 CR
    expect(paymentDelayDays("2026-10-26", "2026-10-27T06:30:00Z", tz)).toBe(1); // 27/10 00:30 CR
  });
  it("un paid_at en UTC que localmente todavía es el día anterior cuenta el día LOCAL", () => {
    expect(paymentDelayDays("2026-10-26", "2026-10-27T02:00:00Z", tz)).toBe(0); // en UTC es 27/10, en CR es 26/10
  });
  it("antes del vencimiento es negativo; sin vencimiento original, null", () => {
    expect(paymentDelayDays("2026-10-26", "2026-10-24T18:00:00Z", tz)).toBe(-2);
    expect(paymentDelayDays(null, "2026-10-24T18:00:00Z", tz)).toBeNull();
  });
});

describe("delayChip", () => {
  it("puntual / adelantado / tarde con sus umbrales", () => {
    expect(delayChip(0)).toEqual({ label: "puntual", tone: "green" });
    expect(delayChip(-2)).toEqual({ label: "−2 d", tone: "blue" });
    expect(delayChip(2)).toEqual({ label: "+2 d", tone: "amber" });
    expect(delayChip(7).tone).toBe("amber");
    expect(delayChip(15)).toEqual({ label: "+15 d", tone: "red" });
    expect(delayChip(null)).toEqual({ label: "—", tone: "none" });
  });
});
