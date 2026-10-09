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
  it("Integraciones (sub-ruta de Ajustes) le gana a Ajustes en su propia ruta", () => {
    expect(activeNavHref("/dashboard/settings/integrations", NAV_ITEMS)).toBe(
      "/dashboard/settings/integrations",
    );
  });

  it("Ajustes queda activo, e Integraciones no, en el resto de settings", () => {
    expect(activeNavHref("/dashboard/settings/team", NAV_ITEMS)).toBe("/dashboard/settings");
  });

  it("Recursos (banca v2, F3) le gana a Ajustes en su ruta y en las dos viejas, igual que la pestaña", () => {
    for (const pathname of ["/dashboard/settings/recursos", "/dashboard/settings/templates", "/dashboard/settings/audios"]) {
      expect(activeNavHref(pathname, NAV_ITEMS), pathname).toBe("/dashboard/settings/recursos");
      // Una pantalla, dos caminos: el menu lateral y la pestaña marcan lo mismo.
      expect(activeSettingsTab(pathname), pathname).toBe("/dashboard/settings/recursos");
    }
  });

  it("/dashboard/channels deja marcado Integraciones (D3: la pantalla se conserva, el item no)", () => {
    expect(activeNavHref("/dashboard/channels", NAV_ITEMS)).toBe("/dashboard/settings/integrations");
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

  const admin = visibleNavItems(NAV_ITEMS, { isAdmin: true, permissionKeys: [] });
  const member = visibleNavItems(NAV_ITEMS, { isAdmin: false, permissionKeys: [] });

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
