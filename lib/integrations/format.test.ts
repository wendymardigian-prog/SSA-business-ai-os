import { describe, it, expect } from "vitest";
import { formatConnectedSince, formatOAuthExpiry, formatLastRefreshed, formatLongDate } from "./format";

const NOW = new Date("2026-10-01T15:00:00.000Z");

describe("formatConnectedSince", () => {
  it("sin año cuando es el mismo año que ahora", () => {
    expect(formatConnectedSince("2026-08-12T15:00:00.000Z", NOW)).toBe("Conectada desde el 12 de agosto");
  });

  it("con año cuando es de otro año", () => {
    expect(formatConnectedSince("2025-08-12T15:00:00.000Z", NOW)).toBe(
      "Conectada desde el 12 de agosto de 2025",
    );
  });

  it("null sin fecha o con una invalida", () => {
    expect(formatConnectedSince(null, NOW)).toBeNull();
    expect(formatConnectedSince(undefined, NOW)).toBeNull();
    expect(formatConnectedSince("no es una fecha", NOW)).toBeNull();
  });
});

describe("formatOAuthExpiry", () => {
  it("antepone 'Vence el'", () => {
    expect(formatOAuthExpiry("2026-12-01T15:00:00.000Z", NOW)).toBe("Vence el 1 de diciembre");
  });

  it("null cuando no hay vencimiento (Google normalmente no vence)", () => {
    expect(formatOAuthExpiry(null, NOW)).toBeNull();
  });
});

describe("formatLastRefreshed", () => {
  it("antepone 'Renovada el'", () => {
    expect(formatLastRefreshed("2026-09-20T15:00:00.000Z", NOW)).toBe("Renovada el 20 de septiembre");
  });

  it("null si todavia no se renovo", () => {
    expect(formatLastRefreshed(null, NOW)).toBeNull();
  });
});

describe("formatLongDate", () => {
  it("sin ningun verbo antepuesto", () => {
    expect(formatLongDate("2026-08-12T15:00:00.000Z", NOW)).toBe("12 de agosto");
  });

  it("null sin fecha", () => {
    expect(formatLongDate(null, NOW)).toBeNull();
  });
});
