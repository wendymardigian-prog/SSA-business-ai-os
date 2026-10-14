import { ALL_PERMISSION_KEYS } from "@/lib/auth/permissions";
import { describe, it, expect } from "vitest";
import { isNavItemActive, activeNavHref } from "./active";
import { NAV_ITEMS, visibleNavItems } from "./items";
import { PAGE_META } from "./page-actions";
import { activeSettingsTab } from "@/lib/settings/tabs";

/**
 * La regla de HOY (bloque N, N4): gana, entre todos los items, el candidato
 * (href o algun alsoActiveOn) mas largo que matchee por segmento.
 *
 * Antes de este bloque la regla era mas simple y tenia un agujero real: cada
 * item se marcaba por su cuenta, por texto crudo (sin segmento) y con una
 * sola excepcion a mano (Inbox). Las pruebas de ese "antes" se reescriben
 * aca con la regla nueva; no queda ninguna asercion vieja sin actualizar.
 */
describe("isNavItemActive: coincide por segmento, no por texto crudo", () => {
  it("un href matchea su propia ruta y sus sub-rutas", () => {
    expect(isNavItemActive("/dashboard/contacts", { href: "/dashboard/contacts" })).toBe(true);
    expect(isNavItemActive("/dashboard/contacts/abc123", { href: "/dashboard/contacts" })).toBe(true);
  });

  it("ya NO matchea un texto que arranca igual pero no es un segmento (el bug de la version vieja)", () => {
    // Antes esto daba `true` (startsWith de texto crudo). El bloque N lo
    // corrige como efecto colateral de comparar por segmento (N4).
    expect(isNavItemActive("/dashboard/contactsnomatch", { href: "/dashboard/contacts" })).toBe(false);
  });

  it("alsoActiveOn deja el item activo igual que su propio href", () => {
    const bandeja = { href: "/dashboard/inbox", alsoActiveOn: ["/dashboard/drafts"] };
    expect(isNavItemActive("/dashboard/drafts", bandeja)).toBe(true);
    expect(isNavItemActive("/dashboard/drafts/algo", bandeja)).toBe(true);
    expect(isNavItemActive("/dashboard/broadcasts", bandeja)).toBe(false); // no esta en SU alsoActiveOn
  });
});

describe("activeNavHref: gana el candidato mas largo (N4)", () => {
  // Plano formularios-ui (D3, D4): Integraciones, Recursos y Conocimiento ya no son items del menu.
  // Estas aserciones se reescriben con la regla nueva; las rutas siguen andando y marcan su pantalla madre.
  it("Ajustes queda activo en cualquier pestaña de Ajustes, incluida Integraciones (plano formularios-ui, D4)", () => {
    for (const pathname of [
      "/dashboard/settings",
      "/dashboard/settings/team",
      "/dashboard/settings/roles",
      "/dashboard/settings/integrations",
      "/dashboard/settings/integrations/webhooks",
      "/dashboard/settings/custom-fields",
      "/dashboard/settings/productos",
      "/dashboard/settings/asignacion",
    ]) {
      expect(activeNavHref(pathname, NAV_ITEMS), pathname).toBe("/dashboard/settings");
    }
  });

  it("Recursos (y sus dos rutas viejas) tambien marca Ajustes, y la pestaña de Ajustes sigue marcando Recursos (plano formularios-ui, D4)", () => {
    for (const pathname of ["/dashboard/settings/recursos", "/dashboard/settings/templates", "/dashboard/settings/audios"]) {
      expect(activeNavHref(pathname, NAV_ITEMS), pathname).toBe("/dashboard/settings");
      expect(activeSettingsTab(pathname), pathname).toBe("/dashboard/settings/recursos");
    }
  });

  it("/dashboard/channels deja marcado Ajustes (plano formularios-ui, D4: cuelga de Integraciones, que es una pestaña)", () => {
    expect(activeNavHref("/dashboard/channels", NAV_ITEMS)).toBe("/dashboard/settings");
  });

  it("Conocimiento deja marcado Agentes IA, tambien un documento (plano formularios-ui, D3)", () => {
    expect(activeNavHref("/dashboard/knowledge", NAV_ITEMS)).toBe("/dashboard/agents");
    expect(activeNavHref("/dashboard/knowledge/9f0d1b6e", NAV_ITEMS)).toBe("/dashboard/agents");
  });

  it("Formularios queda marcado en todas sus subrutas (plano formularios-ui, F3)", () => {
    for (const pathname of [
      "/dashboard/formularios",
      "/dashboard/formularios/abc",
      "/dashboard/formularios/abc/respuestas",
      "/dashboard/formularios/abc/metricas",
      "/dashboard/formularios/abc/automatizaciones/def",
    ]) {
      expect(activeNavHref(pathname, NAV_ITEMS), pathname).toBe("/dashboard/formularios");
    }
  });

  it("Bandeja queda marcada desde drafts, broadcasts, sequences y growth", () => {
    for (const pathname of ["/dashboard/drafts", "/dashboard/broadcasts", "/dashboard/sequences", "/dashboard/growth"]) {
      expect(activeNavHref(pathname, NAV_ITEMS), pathname).toBe("/dashboard/inbox");
    }
  });

  it("Dashboards queda marcado en cualquier pantalla de dashboards, no solo /chat", () => {
    // Antes del bloque N esto no marcaba nada (era el agujero documentado).
    for (const pathname of [
      "/dashboard/dashboards/chat",
      "/dashboard/dashboards/ads",
      "/dashboard/dashboards/content",
      "/dashboard/dashboards/unified",
      "/dashboard/dashboards/agenda",
      "/dashboard/dashboards/llamadas",
      "/dashboard/dashboards/ads/campaigns/abc",
    ]) {
      expect(activeNavHref(pathname, NAV_ITEMS), pathname).toBe("/dashboard/dashboards/chat");
    }
  });

  it("sin ningun match, no hay item activo", () => {
    expect(activeNavHref("/dashboard/inventada", NAV_ITEMS)).toBeNull();
  });
});

describe("exactamente un item activo en cualquier ruta real del dashboard (N4)", () => {
  // Recorre PAGE_META, que es la lista real de rutas con barra superior.
  // Los segmentos dinamicos ([id], [contactId], etc.) se resuelven con un
  // valor de relleno: lo unico que importa aca es el PREFIJO de la ruta.
  const rutaDeEjemplo = (patron: string) => patron.replace(/\[[^\]]+\]/g, "muestra");

  // Un admin que además está en la audiencia de un EOD: ve el menú entero.
  const admin = visibleNavItems(NAV_ITEMS, { permissionKeys: ALL_PERMISSION_KEYS, flags: { eod: true, settings: true } });
  const member = visibleNavItems(NAV_ITEMS, { permissionKeys: [], flags: { settings: true } });

  for (const patron of Object.keys(PAGE_META)) {
    it(`${patron}: exactamente un item activo para un admin`, () => {
      // Un admin ve TODO el menu, asi que para cualquier ruta real tiene que
      // haber un ganador: cero seria un item nuevo sin alsoActiveOn, y dos
      // seria un empate que activeNavHref no deberia producir.
      const pathname = rutaDeEjemplo(patron);
      const href = activeNavHref(pathname, admin);

      expect(href, pathname).not.toBeNull();
      expect(admin.filter((item) => item.href === href).length, pathname).toBe(1);
    });

    it(`${patron}: a lo sumo un item activo para un member`, () => {
      // Un member no ve los items admin-only: en una ruta que no puede
      // abrir, cero items activos es el estado correcto (no dos).
      const pathname = rutaDeEjemplo(patron);
      const href = activeNavHref(pathname, member);
      const activos = member.filter((item) => item.href === href && href !== null);

      expect(activos.length, pathname).toBeLessThanOrEqual(1);
    });
  }
});
