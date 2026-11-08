import { describe, expect, it } from "vitest";
import { colorChoices, contrastRatio, mixOverlay, normalizeHexInput, overlayForContrast, relativeLuminance, rgba } from "./color";

describe("colores (F12)", () => {
  it("negro contra blanco = 21", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });
  it("un color contra sí mismo = 1", () => {
    expect(contrastRatio("#c4d94a", "#c4d94a")).toBe(1);
  });
  it("es simétrico y el alfa no cuenta", () => {
    expect(contrastRatio("#336699", "#ffffff")).toBeCloseTo(contrastRatio("#ffffff", "#336699"), 10);
    expect(contrastRatio("#336699cc", "#ffffff")).toBeCloseTo(contrastRatio("#336699", "#ffffff"), 10);
  });
  it("un gris medio conocido", () => {
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });
  it("luminancia de los extremos", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 10);
  });
  it("la capa negra al 100 % deja negro; al 0 % deja el fondo", () => {
    expect(mixOverlay(0.8, "#000000", 1)).toBeCloseTo(0, 10);
    expect(mixOverlay(0.8, "#000000", 0)).toBeCloseTo(0.8, 10);
  });
  it("calcula la capa mínima para que un texto blanco se lea sobre una foto clara", () => {
    const opacity = overlayForContrast("#ffffff", 0.7, "#000000", 4.5);
    expect(opacity).not.toBeNull();
    expect(opacity!).toBeGreaterThan(0);
    expect(opacity!).toBeLessThanOrEqual(0.9);
  });
  it("sin capa si ya alcanza", () => {
    expect(overlayForContrast("#ffffff", 0, "#000000", 4.5)).toBe(0);
  });
  it("null si ni con 90 % alcanza", () => {
    expect(overlayForContrast("#777777", 1, "#ffffff", 21)).toBeNull();
  });
  it("normaliza un color escrito a mano", () => {
    expect(normalizeHexInput("FFF")).toBe("#ffffff");
    expect(normalizeHexInput("#C4D94A")).toBe("#c4d94a");
    expect(normalizeHexInput("rojo")).toBeNull();
  });
  it("rgba para CSS", () => {
    expect(rgba("#ff0000", 0.5)).toBe("rgba(255, 0, 0, 0.5)");
    expect(rgba("#ff0000", 3)).toBe("rgba(255, 0, 0, 1)");
  });
  it("las opciones del selector no se repiten y van marca primero", () => {
    expect(colorChoices({ brandColor: "#C4D94A", palette: ["#0f1115", "#c4d94a"], used: ["#0F1115", "#ffffff", "malo"] })).toEqual({
      brand: ["#c4d94a", "#0f1115"],
      used: ["#ffffff"],
    });
  });
});
