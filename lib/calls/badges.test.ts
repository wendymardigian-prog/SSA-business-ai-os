import { describe, expect, it } from "vitest";
import { analysisBadgeTone, bookingBadgeTone, callBadgeClass, outcomeBadgeTone, qualificationBadgeTone, scoreBadgeTone, scoreBarClass, typeBadgeTone } from "./badges";

describe("badges de llamadas", () => {
  it("clasifica el estado de la agenda por significado", () => {
    expect(bookingBadgeTone("sale")).toBe("positive");
    expect(bookingBadgeTone("scheduled")).toBe("info");
    expect(bookingBadgeTone("followup_cold")).toBe("review");
    expect(bookingBadgeTone("no_show")).toBe("negative");
    expect(bookingBadgeTone(null)).toBe("neutral");
  });

  it("distingue resultados positivos, de seguimiento y negativos", () => {
    expect(outcomeBadgeTone("venta_deposito")).toBe("positive");
    expect(outcomeBadgeTone("seguimiento_con_fecha")).toBe("info");
    expect(outcomeBadgeTone("seguimiento_sin_fecha")).toBe("negative");
    expect(outcomeBadgeTone("no_cerro")).toBe("negative");
    expect(outcomeBadgeTone(null)).toBe("neutral");
  });

  it("el estado del analisis: procesando no es error, y por revisar es ambar", () => {
    expect(analysisBadgeTone("analyzing")).toBe("info");
    expect(analysisBadgeTone("classifying")).toBe("info");
    expect(analysisBadgeTone("analyzed")).toBe("positive");
    expect(analysisBadgeTone("needs_review")).toBe("review");
    expect(analysisBadgeTone("pending")).toBe("review");
    expect(analysisBadgeTone("error")).toBe("negative");
    expect(analysisBadgeTone("not_applicable")).toBe("neutral");
  });

  it("los puntajes: ambar por debajo de 50, verde desde 65, neutro en el medio", () => {
    expect(scoreBadgeTone(65)).toBe("positive");
    expect(scoreBadgeTone(64)).toBe("neutral");
    expect(scoreBadgeTone(50)).toBe("neutral");
    expect(scoreBadgeTone(49)).toBe("review");
    expect(scoreBadgeTone(null)).toBe("neutral");
    expect(scoreBarClass(80)).toContain("emerald");
    expect(scoreBarClass(10)).toContain("amber");
  });

  it("la calificacion del lead y el tipo", () => {
    expect(qualificationBadgeTone("calificado")).toBe("positive");
    expect(qualificationBadgeTone("con_reservas")).toBe("review");
    expect(qualificationBadgeTone("no_calificado")).toBe("negative");
    expect(typeBadgeTone("cierre")).toBe("classification");
    expect(typeBadgeTone(null)).toBe("neutral");
  });

  it("callBadgeClass junta la base y el tono", () => {
    expect(callBadgeClass("positive")).toContain("rounded-md");
    expect(callBadgeClass("positive")).toContain("emerald");
  });
});
