import { describe, expect, it } from "vitest";
import { aiNoticeText, panelTabs, parsePanel } from "./panels";

describe("pestañas del panel (§11.4)", () => {
  it("Variables solo en plantillas", () => {
    expect(panelTabs(true, true)).toEqual(["ia", "agregar", "capas", "variables"]);
    expect(panelTabs(false, true)).toEqual(["ia", "agregar", "capas"]);
  });

  it("sin designer.edit no hay pestaña Agregar (se oculta, no se deshabilita)", () => {
    expect(panelTabs(false, false)).toEqual(["ia", "capas"]);
    expect(panelTabs(true, false)).toEqual(["ia", "capas", "variables"]);
    expect(panelTabs(false, false)).not.toContain("agregar");
    // Un `?panel=agregar` viejo cae en Capas, no en una pestaña que no existe.
    expect(parsePanel("agregar", false, "blank", false)).toBe("capas");
    expect(parsePanel(null, true, "image", false)).toBe("capas");
    expect(parsePanel(null, false, "ai", false)).toBe("ia");
  });

  it("la URL manda; lo que no existe cae en la de siempre", () => {
    expect(parsePanel("capas", false, "blank", true)).toBe("capas");
    expect(parsePanel("variables", true, "blank", true)).toBe("variables");
    expect(parsePanel("variables", false, "blank", true)).toBe("agregar");
    expect(parsePanel("raro", false, "ai", true)).toBe("ia");
    expect(parsePanel(null, true, "image", true)).toBe("agregar");
  });

  it("el aviso de la IA que no arrancó", () => {
    expect(aiNoticeText("pendiente")).toContain("todavía no está disponible");
    expect(aiNoticeText("error")).toContain("quedó creado");
    expect(aiNoticeText(null)).toBeNull();
    expect(aiNoticeText("otra")).toBeNull();
  });
});
