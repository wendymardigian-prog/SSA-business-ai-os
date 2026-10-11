import { describe, expect, it } from "vitest";
import { backToLastTouch, chooseTouch, DEFAULT_ATTRIBUTION_STATE, initialPanel, loadManually, modeLead } from "./attribution-field";

describe("estado del componente de atribución", () => {
  it("por defecto es el último toque (el servidor resuelve el resto al guardar)", () => {
    expect(DEFAULT_ATTRIBUTION_STATE).toEqual({ mode: "last_touch" });
  });

  it("elegir otro toque deja { mode: 'touch', touchId }", () => {
    expect(chooseTouch("t1")).toEqual({ mode: "touch", touchId: "t1" });
  });

  it("cargar a mano deja { mode: 'manual', manual }", () => {
    expect(loadManually({ source: "instagram", campaign: "octubre" })).toEqual({ mode: "manual", manual: { source: "instagram", campaign: "octubre" } });
  });

  it("'Volver al último toque' restaura el modo por defecto", () => {
    expect(backToLastTouch()).toEqual({ mode: "last_touch" });
  });

  it("sin toques el panel abre directo en 'Cargar a mano'; con toques, en la lista", () => {
    expect(initialPanel(0)).toBe("manual");
    expect(initialPanel(3)).toBe("touches");
  });

  it("la línea dice de dónde sale la atribución", () => {
    expect(modeLead({ mode: "last_touch" }, true)).toBe("último toque");
    expect(modeLead({ mode: "last_touch" }, false)).toBe("sin toques");
    expect(modeLead({ mode: "touch", touchId: "t" }, true)).toBe("elegida del historial");
    expect(modeLead({ mode: "manual", manual: { source: "web" } }, false)).toBe("cargada a mano");
  });
});
