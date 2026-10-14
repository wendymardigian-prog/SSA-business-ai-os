import { describe, expect, it } from "vitest";
import { activeInsideTools, toolsOpen } from "./tools-open";

describe("toolsOpen (plano formularios-ui, F2)", () => {
  it("sin nada guardado y con la pantalla activa afuera: cerrada", () => {
    expect(toolsOpen(null, "/dashboard/inbox")).toBe(false);
    expect(toolsOpen(undefined, null)).toBe(false);
  });

  it("guardada abierta y la pantalla activa afuera: abierta", () => {
    expect(toolsOpen("1", "/dashboard/inbox")).toBe(true);
  });

  it("guardada cerrada y la pantalla activa afuera: cerrada", () => {
    expect(toolsOpen("0", "/dashboard/inbox")).toBe(false);
  });

  it("con la pantalla activa adentro se ve abierta aunque la persona la haya cerrado", () => {
    expect(toolsOpen("0", "/dashboard/formularios")).toBe(true);
    expect(toolsOpen("0", "/dashboard/flows")).toBe(true);
    expect(toolsOpen("0", "/dashboard/agents")).toBe(true);
    expect(toolsOpen("0", "/dashboard/settings")).toBe(true);
  });

  it("con la pantalla activa adentro y sin nada guardado: abierta", () => {
    expect(toolsOpen(null, "/dashboard/formularios")).toBe(true);
  });

  it("un valor guardado raro no la abre", () => {
    expect(toolsOpen("si" as never, "/dashboard/inbox")).toBe(false);
  });
});

describe("activeInsideTools", () => {
  it("reconoce los cuatro items de Herramientas y nada mas", () => {
    for (const href of ["/dashboard/flows", "/dashboard/formularios", "/dashboard/agents", "/dashboard/settings"]) {
      expect(activeInsideTools(href)).toBe(true);
    }
    for (const href of ["/dashboard/inbox", "/dashboard/contacts", "/dashboard/ventas", null, undefined]) {
      expect(activeInsideTools(href)).toBe(false);
    }
  });
});
