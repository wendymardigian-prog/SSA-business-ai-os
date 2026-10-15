import { describe, expect, it } from "vitest";
import { cardDates, formatCardDate } from "./card-dates";

const A = "2026-10-25T18:00:00.000Z";
const B = "2026-10-27T21:30:00.000Z";

describe("fechas de la tarjeta del tablero", () => {
  it("sin ninguna fecha no muestra nada", () => {
    expect(cardDates([])).toEqual({ kind: "none" });
    expect(cardDates([{ at: null }, { at: null }])).toEqual({ kind: "none" });
  });

  it("una red con fecha: una sola fecha", () => {
    expect(cardDates([{ at: A }])).toEqual({ kind: "single", at: A });
  });

  it("todas las redes en el mismo momento: una sola fecha", () => {
    expect(cardDates([{ at: A }, { at: "2026-10-25T18:00:00Z" }])).toEqual({ kind: "single", at: A });
  });

  it("fechas distintas: cada red con la suya", () => {
    expect(cardDates([{ at: A }, { at: B }])).toEqual({ kind: "per_network" });
  });

  it("una con fecha y otra sin ella: por red (no son 'la misma')", () => {
    expect(cardDates([{ at: A }, { at: null }])).toEqual({ kind: "per_network" });
  });

  it("formatea con dia, mes y hora en la zona del negocio", () => {
    expect(formatCardDate(A, "America/Argentina/Buenos_Aires")).toBe("25 oct · 15:00");
    expect(formatCardDate(A, "UTC")).toBe("25 oct · 18:00");
  });

  it("una fecha vacia o rota no se muestra", () => {
    expect(formatCardDate(null, "UTC")).toBeNull();
    expect(formatCardDate("no-es-fecha", "UTC")).toBeNull();
  });
});
