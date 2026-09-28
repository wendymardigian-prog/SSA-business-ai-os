import { describe, expect, it } from "vitest";
import { canOpenConfig, CONFIG_SECTIONS, configSectionFor, DEFAULT_CONFIG_SECTION } from "./config-sections";

describe("configuracion de agenda (F8)", () => {
  it("tiene las cinco secciones en este orden, Eventos por defecto", () => {
    expect(CONFIG_SECTIONS.map((s) => s.label)).toEqual(["Eventos", "Disponibilidad", "Calendarios de Google", "Categorías", "Ajustes"]);
    expect(DEFAULT_CONFIG_SECTION.key).toBe("eventos");
  });
  it("cada seccion tiene su ruta y reconoce sus sub-rutas", () => {
    expect(configSectionFor("/dashboard/agenda/configuracion/eventos/abc")?.key).toBe("eventos");
    expect(configSectionFor("/dashboard/agenda/configuracion/ajustes")?.key).toBe("ajustes");
    expect(configSectionFor("/dashboard/agenda")).toBeNull();
  });
  it("el engranaje se ve con scheduling.use o manage_categories, no con bookings.view solo", () => {
    expect(canOpenConfig((k) => k === "scheduling.use")).toBe(true);
    expect(canOpenConfig((k) => k === "scheduling.manage_categories")).toBe(true);
    expect(canOpenConfig((k) => k === "bookings.view")).toBe(false);
  });
});
