import { describe, expect, it } from "vitest";
import { aiNoticeText, panelTabs, parsePanel } from "./panels";

describe("pestañas del panel (§11.4)", () => {
  it("Variables solo en plantillas", () => {
    expect(panelTabs(true)).toEqual(["ia", "agregar", "capas", "variables"]);
    expect(panelTabs(false)).toEqual(["ia", "agregar", "capas"]);
  });

  it("la URL manda; lo que no existe cae en la de siempre", () => {
    expect(parsePanel("capas", false, "blank")).toBe("capas");
    expect(parsePanel("variables", true, "blank")).toBe("variables");
    expect(parsePanel("variables", false, "blank")).toBe("agregar");
    expect(parsePanel("raro", false, "ai")).toBe("ia");
    expect(parsePanel(null, true, "image")).toBe("agregar");
  });

  it("el aviso de la IA que no arrancó", () => {
    expect(aiNoticeText("pendiente")).toContain("todavía no está disponible");
    expect(aiNoticeText("error")).toContain("quedó creado");
    expect(aiNoticeText(null)).toBeNull();
    expect(aiNoticeText("otra")).toBeNull();
  });
});
