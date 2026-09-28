import { describe, it, expect } from "vitest";
import { NAV_ITEMS } from "./items";

describe("orden del menú (F13)", () => {
  it("Dashboards es el primer ítem, con ícono de grilla", () => {
    expect(NAV_ITEMS[0].name).toBe("Dashboards");
    expect(NAV_ITEMS[0].href).toBe("/dashboard/dashboards/chat");
    expect(NAV_ITEMS[0].icon).toBe("LayoutGrid");
  });
  it("Analytics ya no existe", () => {
    expect(NAV_ITEMS.some((i) => i.name === "Analytics")).toBe(false);
    expect(NAV_ITEMS.some((i) => i.href.includes("/analytics"))).toBe(false);
  });
  it("los nombres no se repiten", () => {
    expect(new Set(NAV_ITEMS.map((i) => i.name)).size).toBe(NAV_ITEMS.length);
  });
});

describe("lo que salio del menú", () => {
  // Broadcasts, Sequences y Growth se llegan por las sub-pestañas de Inbox;
  // Integraciones, desde Settings. Las rutas siguen vivas: lo que se testea
  // aca es que no vuelvan a aparecer como item del menu lateral.
  const fuera = [
    { name: "Broadcasts", href: "/dashboard/broadcasts" },
    { name: "Sequences", href: "/dashboard/sequences" },
    { name: "Growth", href: "/dashboard/growth" },
    { name: "Integraciones", href: "/dashboard/settings/integrations" },
  ];

  for (const item of fuera) {
    it(`${item.name} no esta en el menú`, () => {
      expect(NAV_ITEMS.some((i) => i.name === item.name)).toBe(false);
      expect(NAV_ITEMS.some((i) => i.href === item.href)).toBe(false);
    });
  }

  it("Inbox si sigue estando: es el hub de comunicacion", () => {
    expect(NAV_ITEMS.some((i) => i.href === "/dashboard/inbox")).toBe(true);
  });
});

// ── Etapa 2 ────────────────────────────────────────────────────────────────

describe("Contenido en el menu (F39)", () => {
  it("esta, y lo ve cualquiera", () => {
    // Un Member crea ideas y piezas: si fuera adminOnly no podria ni entrar.
    const contenido = NAV_ITEMS.find((i) => i.name === "Contenido");

    expect(contenido).toBeDefined();
    expect(contenido?.href).toBe("/dashboard/content");
    expect(contenido?.adminOnly).toBe(false);
  });

  it("va despues de Flows", () => {
    const nombres = NAV_ITEMS.map((i) => i.name);
    expect(nombres.indexOf("Contenido")).toBe(nombres.indexOf("Flows") + 1);
  });
});

// ── Etapa 4 ────────────────────────────────────────────────────────────────

import { visibleNavItems } from "./items";

describe("Agenda en el menu (F8)", () => {
  const agenda = NAV_ITEMS.find((i) => i.name === "Agenda");

  it("esta, va despues de Contacts y abre directo las agendas (sin sub-menu)", () => {
    expect(agenda).toBeDefined();
    expect(agenda?.href).toBe("/dashboard/agenda");
    expect(agenda?.adminOnly).toBe(false);
    const nombres = NAV_ITEMS.map((i) => i.name);
    expect(nombres.indexOf("Agenda")).toBe(nombres.indexOf("Contacts") + 1);
  });

  it("se muestra con scheduling.use o bookings.view, y a nadie mas", () => {
    expect(agenda?.permissions).toEqual(["scheduling.use", "bookings.view"]);
    const names = (keys: string[]) =>
      visibleNavItems(NAV_ITEMS, { isAdmin: false, permissionKeys: keys }).map((i) => i.name);
    expect(names(["scheduling.use"])).toContain("Agenda");
    expect(names(["bookings.view"])).toContain("Agenda");
    expect(names(["contacts.view"])).not.toContain("Agenda");
    // Un admin lo ve siempre, y sigue sin ver nada que no sea suyo por rol.
    expect(visibleNavItems(NAV_ITEMS, { isAdmin: true, permissionKeys: [] }).map((i) => i.name)).toContain("Agenda");
  });

  it("los items sin `permissions` siguen dependiendo solo de adminOnly", () => {
    const member = visibleNavItems(NAV_ITEMS, { isAdmin: false, permissionKeys: [] }).map((i) => i.name);
    expect(member).toEqual(["Dashboards", "Flows", "Contenido", "Inbox", "Contacts", "Agentes"]);
  });
});
