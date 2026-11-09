// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { isModuleEnabled, moduleShows, type ServicesSurface } from "./module";

const SURFACES: ServicesSurface[] = ["menu.clientes", "menu.portal", "route.clientes", "route.portal", "sales.column", "variant.tabs"];

describe("el interruptor del modulo (F97)", () => {
  it("solo true lo prende", () => {
    expect(isModuleEnabled({ services_enabled: true })).toBe(true);
    expect(isModuleEnabled({ services_enabled: false })).toBe(false);
    expect(isModuleEnabled({})).toBe(false);
    expect(isModuleEnabled(null)).toBe(false);
  });
  it("apagado no se muestra nada del modulo: menu, rutas, columna de Ventas ni pestanas de la variante", () => {
    for (const s of SURFACES) expect(moduleShows(s, { servicesEnabled: false })).toBe(false);
  });
  it("prendido se muestra todo", () => {
    for (const s of SURFACES) expect(moduleShows(s, { servicesEnabled: true })).toBe(true);
  });
});
