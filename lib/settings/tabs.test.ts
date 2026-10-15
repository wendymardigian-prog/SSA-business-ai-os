import { describe, expect, it } from "vitest";
import { activeSettingsTab, settingsEntryHref, SETTINGS_TABS, visibleSettingsTabs } from "./tabs";

describe("SETTINGS_TABS", () => {
  it("tiene las siete pestañas en orden (Tareas se mudo a Agentes IA; Asignación se suma con Ventas)", () => {
    expect(SETTINGS_TABS.map((t) => t.name)).toEqual([
      "General",
      "Equipo y roles",
      "Campos personalizados",
      "Recursos",
      "Productos",
      "Asignación",
      "Integraciones",
    ]);
  });
});

describe("activeSettingsTab", () => {
  it("marca Asignación en /asignacion y Productos en el detalle de un producto", () => {
    expect(activeSettingsTab("/dashboard/settings/asignacion")).toBe("/dashboard/settings/asignacion");
    expect(activeSettingsTab("/dashboard/settings/productos/9f0d1b6e-1111-2222-3333-444455556666")).toBe("/dashboard/settings/productos");
  });

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

describe("visibleSettingsTabs (plano formularios-ui, D4; por permiso desde Equipo y roles)", () => {
  const can = (keys: string[]) => (key: string) => keys.includes(key);

  it("Owner y Admin ven las siete pestañas", () => {
    expect(visibleSettingsTabs(() => true)).toEqual(SETTINGS_TABS);
  });

  it("quien no tiene ninguna clave de Ajustes (el Member de sistema) solo ve Recursos", () => {
    expect(visibleSettingsTabs(can([])).map((t) => t.name)).toEqual(["Recursos"]);
  });

  it("un rol personalizado ve las pestañas de sus claves, mas Recursos", () => {
    expect(visibleSettingsTabs(can(["products.manage", "integrations.view"])).map((t) => t.name)).toEqual(["Recursos", "Productos", "Integraciones"]);
  });

  it("quien solo administra gastos (expenses.manage) ve General: ahí está la sección de Finanzas", () => {
    expect(visibleSettingsTabs(can(["expenses.manage"])).map((t) => t.name)).toEqual(["General", "Recursos"]);
    expect(settingsEntryHref(can(["expenses.manage"]))).toBe("/dashboard/settings");
    // Ver Finanzas no alcanza para configurarla.
    expect(visibleSettingsTabs(can(["expenses.view"])).map((t) => t.name)).toEqual(["Recursos"]);
  });

  it("Ajustes lleva a General con una clave de General, y a Recursos para un Member", () => {
    expect(settingsEntryHref(() => true)).toBe("/dashboard/settings");
    expect(settingsEntryHref(can(["settings.general"]))).toBe("/dashboard/settings");
    expect(settingsEntryHref(can([]))).toBe("/dashboard/settings/recursos");
  });
});
