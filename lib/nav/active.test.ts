import { describe, it, expect } from "vitest";
import { NAV_ITEMS } from "./items";
import { isNavItemActive, activeNavHref } from "./active";

/**
 * Caracterizacion de como se marca el item activo ANTES del bloque N
 * (requerimientos v2.0, seccion 4). Fija el comportamiento de hoy, agujeros
 * incluidos, para que N4 pueda cambiarlo con una red debajo.
 */
describe("caracterizacion: item activo (antes del bloque N)", () => {
  it("un href matchea por prefijo exacto", () => {
    expect(isNavItemActive("/dashboard/contacts", "/dashboard/contacts")).toBe(true);
    expect(isNavItemActive("/dashboard/contacts/abc123", "/dashboard/contacts")).toBe(true);
    expect(isNavItemActive("/dashboard/contactsnomatch", "/dashboard/contacts")).toBe(true); // hoy es startsWith de texto, no por segmento
  });

  it("Inbox tambien queda marcado desde drafts, broadcasts, sequences y growth", () => {
    for (const pathname of ["/dashboard/drafts", "/dashboard/broadcasts", "/dashboard/sequences", "/dashboard/growth"]) {
      expect(isNavItemActive(pathname, "/dashboard/inbox")).toBe(true);
    }
  });

  it("esa excepcion es solo de Inbox: ningun otro href la recibe", () => {
    expect(isNavItemActive("/dashboard/drafts", "/dashboard/contacts")).toBe(false);
  });

  it("hoy, en NAV_ITEMS, cada ruta tiene como mucho un item activo (ningun href es prefijo de otro)", () => {
    const rutasDeEjemplo = [
      "/dashboard/dashboards/chat",
      "/dashboard/flows",
      "/dashboard/content",
      "/dashboard/social",
      "/dashboard/inbox",
      "/dashboard/contacts",
      "/dashboard/agenda",
      "/dashboard/channels",
      "/dashboard/agents",
      "/dashboard/knowledge",
      "/dashboard/settings",
      "/dashboard/settings/team",
      "/dashboard/settings/integrations",
    ];
    for (const pathname of rutasDeEjemplo) {
      const activos = NAV_ITEMS.filter((item) => isNavItemActive(pathname, item.href));
      expect(activos.length, pathname).toBeLessThanOrEqual(1);
    }
  });

  it("activeNavHref devuelve el href del item activo", () => {
    expect(activeNavHref("/dashboard/contacts/9f0d", NAV_ITEMS)).toBe("/dashboard/contacts");
    expect(activeNavHref("/dashboard/broadcasts", NAV_ITEMS)).toBe("/dashboard/inbox");
  });

  it("el agujero de hoy: las sub-rutas de dashboards que no son /chat no dejan nada marcado", () => {
    // Dashboards tiene href /dashboard/dashboards/chat. Las otras pantallas de
    // dashboards (ads, content, unified y sus detalles) no empiezan con eso,
    // asi que ningun item queda activo ahi. El bloque N lo cierra (N4) dejando
    // Dashboards activo en toda /dashboard/dashboards.
    for (const pathname of [
      "/dashboard/dashboards/ads",
      "/dashboard/dashboards/content",
      "/dashboard/dashboards/unified",
      "/dashboard/dashboards/ads/campaigns/abc",
    ]) {
      expect(activeNavHref(pathname, NAV_ITEMS), pathname).toBeNull();
    }
  });

  it("integraciones hoy no tiene item propio: su ruta cae marcando Ajustes", () => {
    // No hay item "Integraciones" en NAV_ITEMS todavia (sale en N1). Mientras
    // tanto, /dashboard/settings/integrations matchea por prefijo al item
    // Settings, como cualquier otra sub-ruta de settings.
    expect(activeNavHref("/dashboard/settings/integrations", NAV_ITEMS)).toBe("/dashboard/settings");
  });
});
