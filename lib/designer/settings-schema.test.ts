import { describe, expect, it } from "vitest";
import cases from "./settings.cases.json";
import { parseDesignSettings } from "./settings-schema";

const WS = "11111111-2222-3333-4444-555555555555";

describe("design_settings (casos compartidos con validate_design_settings)", () => {
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(parseDesignSettings(c.settings).ok).toBe(c.valid);
  });

  it("lo que acepta Zod lo acepta la base", () => {
    for (const c of cases) if (c.valid) expect(c.sql, c.name).toBe(true);
  });

  it("completa lo que falta con vacío", () => {
    const result = parseDesignSettings({});
    expect(result.ok && result.settings).toEqual({ v: 1, palette: [], styles: [], fonts: { google: [], uploaded: [] } });
  });

  it("una fuente subida tiene que estar en la carpeta del negocio", () => {
    const settings = { fonts: { uploaded: [{ family: "Mi Marca", weight: 400, style: "normal", path: `${WS}/fonts/a.woff2`, format: "woff2" }] } };
    expect(parseDesignSettings(settings, WS).ok).toBe(true);
    expect(parseDesignSettings(settings, "99999999-2222-3333-4444-555555555555").ok).toBe(false);
  });

  it("dos estilos propios con la misma clave se rechazan", () => {
    const style = { key: "c_abcd", name: "A", palette: { bg: "#000000", text: "#ffffff", accent: "#ff0000" }, fonts: { title: "Inter", body: "Inter" }, density: {}, rules: "" };
    expect(parseDesignSettings({ styles: [style, { ...style, name: "B" }] }).ok).toBe(false);
  });
});
