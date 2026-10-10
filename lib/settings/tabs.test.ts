import { describe, expect, it } from "vitest";
import { activeSettingsTab, SETTINGS_TABS } from "./tabs";

describe("SETTINGS_TABS", () => {
  it("tiene las seis pestañas en orden (Tareas se mudo a Agentes IA)", () => {
    expect(SETTINGS_TABS.map((t) => t.name)).toEqual([
      "General",
      "Equipo y roles",
      "Campos personalizados",
      "Recursos",
      "Productos",
      "Integraciones",
    ]);
  });
});

describe("activeSettingsTab", () => {
  it("marca General solo con la ruta exacta", () => {
    expect(activeSettingsTab("/dashboard/settings")).toBe("/dashboard/settings");
  });

  it("NO marca General en una sub-ruta", () => {
    expect(activeSettingsTab("/dashboard/settings/team")).not.toBe("/dashboard/settings");
  });

  it("marca Equipo y roles en /team y en /roles", () => {
    expect(activeSettingsTab("/dashboard/settings/team")).toBe("/dashboard/settings/team");
    expect(activeSettingsTab("/dashboard/settings/roles")).toBe("/dashboard/settings/team");
  });

  it("marca Campos personalizados en /custom-fields", () => {
    expect(activeSettingsTab("/dashboard/settings/custom-fields")).toBe(
      "/dashboard/settings/custom-fields",
    );
  });

  it("marca Recursos en /recursos, /templates y /audios", () => {
    expect(activeSettingsTab("/dashboard/settings/recursos")).toBe(
      "/dashboard/settings/recursos",
    );
    expect(activeSettingsTab("/dashboard/settings/templates")).toBe(
      "/dashboard/settings/recursos",
    );
    expect(activeSettingsTab("/dashboard/settings/audios")).toBe(
      "/dashboard/settings/recursos",
    );
  });

  it("marca Productos en /productos y en la ruta vieja /contenido (que redirige)", () => {
    expect(activeSettingsTab("/dashboard/settings/productos")).toBe(
      "/dashboard/settings/productos",
    );
    expect(activeSettingsTab("/dashboard/settings/contenido")).toBe(
      "/dashboard/settings/productos",
    );
  });

  it("marca Integraciones en /integrations", () => {
    expect(activeSettingsTab("/dashboard/settings/integrations")).toBe(
      "/dashboard/settings/integrations",
    );
  });

  it("/background ya no marca ninguna pestaña de Ajustes (ahora solo redirige a Agentes IA)", () => {
    expect(activeSettingsTab("/dashboard/settings/background")).toBe("");
  });

  it("no marca ninguna pestaña fuera de Ajustes", () => {
    expect(activeSettingsTab("/dashboard/contacts")).toBe("");
  });
});
