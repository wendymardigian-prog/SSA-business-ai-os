import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { NAV_ITEMS, NAV_GROUPS, navSections, navItemTooltip, visibleNavItems } from "./items";

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
  // Channels (D3) se llega desde el detalle de Zernio/Evolution en
  // Integraciones. Las rutas siguen vivas: lo que se testea aca es que no
  // vuelvan a aparecer como item del menu lateral.
  const fuera = [
    { name: "Broadcasts", href: "/dashboard/broadcasts" },
    { name: "Sequences", href: "/dashboard/sequences" },
    { name: "Growth", href: "/dashboard/growth" },
    { name: "Channels", href: "/dashboard/channels" },
  ];

  for (const item of fuera) {
    it(`${item.name} no esta en el menú`, () => {
      expect(NAV_ITEMS.some((i) => i.name === item.name)).toBe(false);
      expect(NAV_ITEMS.some((i) => i.href === item.href)).toBe(false);
    });
  }

  it("Bandeja si sigue estando: es el hub de comunicacion (antes se llamaba Inbox)", () => {
    expect(NAV_ITEMS.some((i) => i.href === "/dashboard/inbox")).toBe(true);
    expect(NAV_ITEMS.some((i) => i.name === "Inbox")).toBe(false);
  });
});

describe("lo que entro al menú (bloque N, N1)", () => {
  it("Integraciones esta: adminOnly, icono Blocks, en el bloque del fondo", () => {
    const integraciones = NAV_ITEMS.find((i) => i.name === "Integraciones");

    expect(integraciones).toBeDefined();
    expect(integraciones?.href).toBe("/dashboard/settings/integrations");
    expect(integraciones?.icon).toBe("Blocks");
    expect(integraciones?.adminOnly).toBe(true);
    expect(integraciones?.group).toBe("sistema");
  });

  it("Ajustes (antes Settings) tambien esta en el bloque del fondo", () => {
    const ajustes = NAV_ITEMS.find((i) => i.name === "Ajustes");

    expect(ajustes).toBeDefined();
    expect(ajustes?.href).toBe("/dashboard/settings");
    expect(ajustes?.adminOnly).toBe(true);
    expect(ajustes?.group).toBe("sistema");
    expect(NAV_ITEMS.some((i) => i.name === "Settings")).toBe(false);
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

  it("es el primer item del grupo Adquisición (bloque N: antes iba justo despues de Flows)", () => {
    const contenido = NAV_ITEMS.find((i) => i.name === "Contenido");
    expect(contenido?.group).toBe("adquisicion");

    const deAdquisicion = NAV_ITEMS.filter((i) => i.group === "adquisicion").map((i) => i.name);
    expect(deAdquisicion[0]).toBe("Contenido");
  });
});

// ── Etapa 4 ────────────────────────────────────────────────────────────────

describe("Agenda en el menu (F8)", () => {
  const agenda = NAV_ITEMS.find((i) => i.name === "Agenda");

  it("esta, va despues de Contactos (antes Contacts) y abre directo las agendas (sin sub-menu)", () => {
    expect(agenda).toBeDefined();
    expect(agenda?.href).toBe("/dashboard/agenda");
    expect(agenda?.adminOnly).toBe(false);
    expect(agenda?.group).toBe("ventas");
    const nombres = NAV_ITEMS.map((i) => i.name);
    expect(nombres.indexOf("Agenda")).toBe(nombres.indexOf("Contactos") + 1);
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
    // Antes: ["Dashboards","Flows","Contenido","Inbox","Contacts","Agentes"].
    // Los nombres cambiaron (bloque N) y el orden ahora sigue a los grupos.
    const member = visibleNavItems(NAV_ITEMS, { isAdmin: false, permissionKeys: [] }).map((i) => i.name);
    // Recursos (banca v2, F3) es visible para todos.
    expect(member).toEqual(["Dashboards", "Bandeja", "Contenido", "Contactos", "Automatizaciones", "Agentes", "Recursos"]);
  });
});

describe("Social en el menu (F78)", () => {
  const social = NAV_ITEMS.find((i) => i.name === "Social");
  const names = (isAdmin: boolean, keys: string[]) =>
    visibleNavItems(NAV_ITEMS, { isAdmin, permissionKeys: keys }).map((i) => i.name);

  it("no es por cargo: se muestra con el permiso social.view", () => {
    expect(social?.adminOnly).toBe(false);
    expect(social?.permissions).toEqual(["social.view"]);
  });

  it("un rol personalizado con social.view lo ve", () => {
    // Es el caso del rol "Content Manager" de produccion.
    expect(names(false, ["social.view"])).toContain("Social");
  });

  it("un Member sin ese permiso no lo ve", () => {
    expect(names(false, [])).not.toContain("Social");
    expect(names(false, ["dashboards.content.view", "content.view"])).not.toContain("Social");
  });

  it("Owner y Admin lo ven siempre", () => {
    expect(names(true, [])).toContain("Social");
  });
});

// ── Bloque N: grupos (requerimientos v2.0, seccion 4, N1/N5) ───────────────

describe("grupos del menu (bloque N, N1)", () => {
  it("todo item pertenece a un grupo declarado en NAV_GROUPS", () => {
    const idsDeclarados = new Set(NAV_GROUPS.map((g) => g.id));
    const sinGrupo = NAV_ITEMS.filter((item) => !idsDeclarados.has(item.group));

    expect(sinGrupo.map((i) => i.name)).toEqual([]);
  });

  it("ningun grupo declarado queda vacio (sin ningun item en NAV_ITEMS)", () => {
    const vacios = NAV_GROUPS.filter((g) => !NAV_ITEMS.some((item) => item.group === g.id));

    expect(vacios.map((g) => g.id), "estos grupos no tienen ni un item").toEqual([]);
  });

  it("el orden de los grupos es: inicio, adquisicion, ventas, automatizacion, sistema", () => {
    expect(NAV_GROUPS.map((g) => g.id)).toEqual(["inicio", "adquisicion", "ventas", "automatizacion", "sistema"]);
  });

  it("inicio y sistema no tienen titulo; los del medio si", () => {
    expect(NAV_GROUPS.find((g) => g.id === "inicio")?.title).toBeNull();
    expect(NAV_GROUPS.find((g) => g.id === "sistema")?.title).toBeNull();
    expect(NAV_GROUPS.find((g) => g.id === "adquisicion")?.title).toBe("Adquisición");
    expect(NAV_GROUPS.find((g) => g.id === "ventas")?.title).toBe("Ventas");
    expect(NAV_GROUPS.find((g) => g.id === "automatizacion")?.title).toBe("Automatización");
  });

  it("Dashboards y Bandeja son los dos sueltos de arriba, antes del primer titulo", () => {
    const sueltos = NAV_ITEMS.filter((i) => i.group === "inicio").map((i) => i.name);
    expect(sueltos).toEqual(["Dashboards", "Bandeja"]);
  });

  it("Integraciones y Ajustes son el bloque del fondo", () => {
    const fondo = NAV_ITEMS.filter((i) => i.group === "sistema").map((i) => i.name);
    expect(fondo.sort()).toEqual(["Ajustes", "Integraciones"]);
  });

  it("todo href de NAV_ITEMS resuelve a una ruta que existe (app/(dashboard)/.../page.tsx)", () => {
    // Recorre el filesystem de verdad, como member-baseline y page-actions:
    // un href puede caer bajo un route group (p.ej. Bandeja, que vive en
    // dashboard/(comunicacion)/inbox), y esos parentesis no entran en la URL.
    const root = resolve(__dirname, "../..");
    const base = join(root, "app/(dashboard)");
    const rutas = new Set<string>();

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry === "page.tsx") {
          const rel = full.slice(base.length).replace(/\/page\.tsx$/, "").replace(/\/\([^)]+\)/g, "");
          rutas.add(rel || "/");
        }
      }
    };
    walk(base);

    const sinRuta = NAV_ITEMS.filter((item) => !rutas.has(item.href));
    expect(sinRuta.map((i) => `${i.name} -> ${i.href}`)).toEqual([]);
  });

  it("todo icono de NAV_ITEMS existe en el mapa ICONS del sidebar", () => {
    // Se lee el archivo como texto (igual que member-baseline.test.ts), no se
    // importa components/sidebar.tsx: es un Client Component y aca no hay
    // DOM. Asi se evita que un icono nuevo caiga en silencio al default
    // (LayoutGrid) como le paso a Blocks cuando Integraciones salio del menu.
    const root = resolve(__dirname, "../..");
    const fuente = readFileSync(join(root, "components/sidebar.tsx"), "utf8");
    const bloqueIcons = fuente.match(/const ICONS: Record<string, LucideIcon> = \{[\s\S]*?\};/)?.[0] ?? "";

    expect(bloqueIcons.length, "no se encontro el mapa ICONS en sidebar.tsx").toBeGreaterThan(0);

    const sinIcono = NAV_ITEMS.filter((item) => !bloqueIcons.includes(item.icon));
    expect(sinIcono.map((i) => `${i.name} -> ${i.icon}`)).toEqual([]);
  });
});

describe("navSections: agrupa items ya filtrados (bloque N, N1)", () => {
  it("devuelve los grupos en orden, con sus items", () => {
    const secciones = navSections(NAV_ITEMS);
    expect(secciones.map((s) => s.group)).toEqual(["inicio", "adquisicion", "ventas", "automatizacion", "sistema"]);
  });

  it("un grupo sin ningun item visible no aparece, y con el su titulo", () => {
    // Simula lo que ve un Member: sin Social, Conocimiento, Integraciones ni
    // Ajustes (los 4 adminOnly) y sin Agenda (sin los permisos).
    const comoMember = visibleNavItems(NAV_ITEMS, { isAdmin: false, permissionKeys: [] });
    const secciones = navSections(comoMember);

    // "ventas" solo tenia Contactos y Agenda; sin Agenda le queda Contactos.
    const ventas = secciones.find((s) => s.group === "ventas");
    expect(ventas?.items.map((i) => i.name)).toEqual(["Contactos"]);

    // "sistema" se queda sin nada (Integraciones y Ajustes son adminOnly) y
    // por eso no aparece en absoluto.
    expect(secciones.some((s) => s.group === "sistema")).toBe(false);
  });

  it("con nada filtrado no sobra ningun grupo vacio", () => {
    const secciones = navSections(NAV_ITEMS);
    expect(secciones.every((s) => s.items.length > 0)).toBe(true);
  });
});

describe("navSections: separatorBefore, para el colapsado (bloque N, N3)", () => {
  it("la primera seccion visible nunca lleva separador, y las demas si", () => {
    const secciones = navSections(NAV_ITEMS);
    expect(secciones.map((s) => s.separatorBefore)).toEqual([false, true, true, true, true]);
  });

  it("el bloque del fondo (sistema) tambien lleva separador: es el que ya tiene su linea", () => {
    const secciones = navSections(NAV_ITEMS);
    expect(secciones.find((s) => s.group === "sistema")?.separatorBefore).toBe(true);
  });

  it("si un grupo del medio queda vacio, el separador sigue siendo solo uno por cada hueco entre los que quedan", () => {
    // Como Member: "sistema" desaparece entero, asi que quedan 4 secciones
    // visibles (inicio, adquisicion, ventas, automatizacion) con 3
    // separadores, no 4.
    const comoMember = visibleNavItems(NAV_ITEMS, { isAdmin: false, permissionKeys: [] });
    const secciones = navSections(comoMember);
    expect(secciones.map((s) => s.group)).toEqual(["inicio", "adquisicion", "ventas", "automatizacion"]);
    expect(secciones.map((s) => s.separatorBefore)).toEqual([false, true, true, true]);
  });

  it("con una sola seccion visible, no hay ningun separador", () => {
    const soloInicio = NAV_ITEMS.filter((i) => i.group === "inicio");
    const secciones = navSections(soloInicio);
    expect(secciones).toHaveLength(1);
    expect(secciones[0].separatorBefore).toBe(false);
  });
});

describe("navItemTooltip (bloque N, N3)", () => {
  it("un item de un grupo con titulo muestra nombre y grupo", () => {
    const contactos = NAV_ITEMS.find((i) => i.name === "Contactos")!;
    expect(navItemTooltip(contactos)).toBe("Contactos · Ventas");
  });

  it("un item suelto (inicio o sistema) muestra solo el nombre", () => {
    const dashboards = NAV_ITEMS.find((i) => i.name === "Dashboards")!;
    const ajustes = NAV_ITEMS.find((i) => i.name === "Ajustes")!;
    expect(navItemTooltip(dashboards)).toBe("Dashboards");
    expect(navItemTooltip(ajustes)).toBe("Ajustes");
  });
});
