import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { NAV_ITEMS, NAV_GROUPS, navSections, navItemTooltip, navItemHref, visibleNavItems } from "./items";

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
  // Plano formularios-ui (D4): Integraciones sale del menu (es una pestaña de Ajustes). Ajustes sigue y
  // pasa a Herramientas; se ve para quien tenga alguna pestaña de Ajustes (bandera `settings`).
  it("Integraciones ya no es un item del menu (plano formularios-ui, D4)", () => {
    expect(NAV_ITEMS.some((i) => i.name === "Integraciones")).toBe(false);
    expect(NAV_ITEMS.some((i) => i.href === "/dashboard/settings/integrations")).toBe(false);
  });

  it("Ajustes (antes Settings) esta en Herramientas, se ve con la bandera `settings` y deja marcado Channels", () => {
    const ajustes = NAV_ITEMS.find((i) => i.name === "Ajustes");

    expect(ajustes).toBeDefined();
    expect(ajustes?.href).toBe("/dashboard/settings");
    expect(ajustes?.adminOnly).toBe(false);
    expect(ajustes?.requires).toBe("settings");
    expect(ajustes?.group).toBe("herramientas");
    expect(ajustes?.alsoActiveOn).toEqual(["/dashboard/channels"]);
    expect(NAV_ITEMS.some((i) => i.name === "Settings")).toBe(false);
  });

  it("Conocimiento y Recursos tampoco son items (plano formularios-ui, D3 y D4)", () => {
    expect(NAV_ITEMS.some((i) => i.name === "Conocimiento")).toBe(false);
    expect(NAV_ITEMS.some((i) => i.name === "Recursos")).toBe(false);
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
    // Plano formularios-ui (D4): Recursos ya no es un item (se llega por Ajustes) y Ajustes pide su bandera,
    // que aca no se pasa: un viewer sin flags no lo ve.
    expect(member).toEqual(["Dashboards", "Bandeja", "Contenido", "Contactos", "Automatizaciones", "Agentes IA"]);
  });
});

describe("Ventas en el menu (Etapa 5)", () => {
  const ventas = NAV_ITEMS.find((i) => i.name === "Ventas");

  it("va en el grupo Ventas, despues de Llamadas, y abre la lista sin engranaje", () => {
    expect(ventas).toMatchObject({ href: "/dashboard/ventas", group: "ventas", adminOnly: false, permissions: ["sales.view"] });
    const nombres = NAV_ITEMS.map((i) => i.name);
    expect(nombres.indexOf("Ventas")).toBe(nombres.indexOf("Llamadas") + 1);
  });

  it("se ve con sales.view y no sin el", () => {
    const names = (keys: string[]) =>
      visibleNavItems(NAV_ITEMS, { isAdmin: false, permissionKeys: keys }).map((i) => i.name);
    expect(names(["sales.view"])).toContain("Ventas");
    expect(names(["sales.manage"])).not.toContain("Ventas");
    expect(names([])).not.toContain("Ventas");
  });
});

describe("Llamadas en el menu", () => {
  const llamadas = NAV_ITEMS.find((i) => i.name === "Llamadas");

  it("va debajo de Agenda, en Ventas, con el permiso calls.view", () => {
    expect(llamadas).toMatchObject({ href: "/dashboard/llamadas", icon: "PhoneCall", group: "ventas", adminOnly: false, permissions: ["calls.view"] });
    const nombres = NAV_ITEMS.map((i) => i.name);
    expect(nombres.indexOf("Llamadas")).toBe(nombres.indexOf("Agenda") + 1);
  });

  it("aparece con calls.view y a nadie mas", () => {
    const names = (keys: string[]) => visibleNavItems(NAV_ITEMS, { isAdmin: false, permissionKeys: keys }).map((i) => i.name);
    expect(names(["calls.view"])).toContain("Llamadas");
    expect(names(["calls.edit"])).not.toContain("Llamadas");
    expect(names([])).not.toContain("Llamadas");
  });
});

describe("Formularios en el menu", () => {
  const formularios = NAV_ITEMS.find((i) => i.name === "Formularios");

  it("va en Herramientas (plano formularios-ui, D2), con el permiso forms.view y sin ser solo de admins", () => {
    expect(formularios).toMatchObject({
      href: "/dashboard/formularios",
      icon: "ClipboardList",
      group: "herramientas",
      adminOnly: false,
      permissions: ["forms.view"],
    });
  });

  it("aparece con forms.view y a nadie mas; un admin siempre lo ve", () => {
    const names = (isAdmin: boolean, keys: string[]) =>
      visibleNavItems(NAV_ITEMS, { isAdmin, permissionKeys: keys }).map((i) => i.name);
    expect(names(false, ["forms.view"])).toContain("Formularios");
    expect(names(false, ["forms.manage"])).not.toContain("Formularios");
    expect(names(false, [])).not.toContain("Formularios");
    expect(names(true, [])).toContain("Formularios");
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

  it("el orden de los grupos es: inicio, adquisicion, ventas, herramientas (plano formularios-ui, D1)", () => {
    expect(NAV_GROUPS.map((g) => g.id)).toEqual(["inicio", "adquisicion", "ventas", "herramientas"]);
  });

  it("inicio no tiene titulo; los demas si, y Herramientas es la unica colapsable (plano formularios-ui, D1)", () => {
    expect(NAV_GROUPS.find((g) => g.id === "inicio")?.title).toBeNull();
    expect(NAV_GROUPS.find((g) => g.id === "adquisicion")?.title).toBe("Adquisición");
    expect(NAV_GROUPS.find((g) => g.id === "ventas")?.title).toBe("Ventas");
    expect(NAV_GROUPS.find((g) => g.id === "herramientas")?.title).toBe("Herramientas");
    expect(NAV_GROUPS.filter((g) => g.collapsible).map((g) => g.id)).toEqual(["herramientas"]);
  });

  it("Dashboards, Bandeja, Tareas y Mi reporte del día son los sueltos de arriba, antes del primer titulo", () => {
    const sueltos = NAV_ITEMS.filter((i) => i.group === "inicio").map((i) => i.name);
    // Tareas (Extra A) va pegada a la Bandeja; el orden de los demas no cambia.
    expect(sueltos).toEqual(["Dashboards", "Bandeja", "Tareas", "Mi reporte del día"]);
  });

  it("el orden de los grupos e items es exactamente el del plano formularios-ui (F1)", () => {
    expect(NAV_GROUPS.map((g) => [g.id, NAV_ITEMS.filter((i) => i.group === g.id).map((i) => i.name)])).toEqual([
      ["inicio", ["Dashboards", "Bandeja", "Tareas", "Mi reporte del día"]],
      ["adquisicion", ["Contenido", "Social"]],
      ["ventas", ["Contactos", "Agenda", "Llamadas", "Ventas"]],
      ["herramientas", ["Automatizaciones", "Formularios", "Agentes IA", "Ajustes"]],
    ]);
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
    expect(secciones.map((s) => s.group)).toEqual(["inicio", "adquisicion", "ventas", "herramientas"]);
  });

  it("un grupo sin ningun item visible no aparece, y con el su titulo", () => {
    // Simula una persona sin permisos y sin la bandeja de Ajustes: sin Social, Agenda, Llamadas ni Ventas.
    const sinNada = visibleNavItems(NAV_ITEMS, { isAdmin: false, permissionKeys: [] });
    const secciones = navSections(sinNada);

    // "ventas" solo tenia Contactos sin los permisos.
    const ventas = secciones.find((s) => s.group === "ventas");
    expect(ventas?.items.map((i) => i.name)).toEqual(["Contactos"]);

    // Plano formularios-ui (F1): "Herramientas" no se queda vacio (Automatizaciones y Agentes IA no piden
    // permiso). Para que un grupo desaparezca hay que quitarle todos los items.
    const soloInicio = navSections(sinNada.filter((i) => i.group === "inicio"));
    expect(soloInicio.some((s) => s.group === "herramientas")).toBe(false);
  });

  it("Herramientas es la unica seccion con el titulo colapsable", () => {
    expect(navSections(NAV_ITEMS).map((s) => [s.group, s.collapsible])).toEqual([
      ["inicio", false],
      ["adquisicion", false],
      ["ventas", false],
      ["herramientas", true],
    ]);
  });

  it("con nada filtrado no sobra ningun grupo vacio", () => {
    const secciones = navSections(NAV_ITEMS);
    expect(secciones.every((s) => s.items.length > 0)).toBe(true);
  });
});

describe("navSections: separatorBefore, para el colapsado (bloque N, N3)", () => {
  it("la primera seccion visible nunca lleva separador, y las demas si", () => {
    const secciones = navSections(NAV_ITEMS);
    expect(secciones.map((s) => s.separatorBefore)).toEqual([false, true, true, true]);
  });

  it("Herramientas tambien lleva separador: con el menu angosto es la linea que la separa de Ventas (plano formularios-ui, F2)", () => {
    const secciones = navSections(NAV_ITEMS);
    expect(secciones.find((s) => s.group === "herramientas")?.separatorBefore).toBe(true);
  });

  it("si un grupo del medio queda vacio, el separador sigue siendo solo uno por cada hueco entre los que quedan", () => {
    // Sin ningun item de "adquisicion" (sin Contenido ni Social), quedan 3 secciones con 2 separadores, no 3.
    const sinAdquisicion = NAV_ITEMS.filter((i) => i.group !== "adquisicion");
    const secciones = navSections(sinAdquisicion);
    expect(secciones.map((s) => s.group)).toEqual(["inicio", "ventas", "herramientas"]);
    expect(secciones.map((s) => s.separatorBefore)).toEqual([false, true, true]);
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

  it("un item suelto (inicio) muestra solo el nombre; uno de Herramientas, nombre y grupo", () => {
    const dashboards = NAV_ITEMS.find((i) => i.name === "Dashboards")!;
    const ajustes = NAV_ITEMS.find((i) => i.name === "Ajustes")!;
    expect(navItemTooltip(dashboards)).toBe("Dashboards");
    expect(navItemTooltip(ajustes)).toBe("Ajustes · Herramientas");
  });
});

describe("Mi reporte del día (EOD, E10)", () => {
  const item = NAV_ITEMS.find((i) => i.name === "Mi reporte del día")!;

  it("está, con ícono de checklist, y no pide permiso: pide estar en la audiencia", () => {
    expect(item).toMatchObject({ href: "/dashboard/eod", icon: "ListChecks", adminOnly: false, requires: "eod" });
    expect(item.permissions).toBeUndefined();
  });

  it("se ve solo con la condición del servidor, también para un admin", () => {
    const names = (flags?: { eod?: boolean }, isAdmin = false) => visibleNavItems(NAV_ITEMS, { isAdmin, permissionKeys: [], flags }).map((i) => i.name);
    expect(names({ eod: true })).toContain("Mi reporte del día");
    expect(names({ eod: false })).not.toContain("Mi reporte del día");
    expect(names(undefined, true)).not.toContain("Mi reporte del día");
    expect(names({ eod: true }, true)).toContain("Mi reporte del día");
  });
});

describe("Ajustes en el menu (plano formularios-ui, D4)", () => {
  const names = (viewer: { isAdmin: boolean; settings?: boolean }) =>
    visibleNavItems(NAV_ITEMS, { isAdmin: viewer.isAdmin, permissionKeys: [], flags: { settings: viewer.settings ?? false } }).map((i) => i.name);

  it("se ve con la bandera `settings`, y sin ella no (tambien para un admin)", () => {
    expect(names({ isAdmin: false, settings: true })).toContain("Ajustes");
    expect(names({ isAdmin: true, settings: true })).toContain("Ajustes");
    expect(names({ isAdmin: true, settings: false })).not.toContain("Ajustes");
  });

  it("lleva a General para un admin y a Recursos para quien solo ve esa pestaña", () => {
    const ajustes = NAV_ITEMS.find((i) => i.name === "Ajustes")!;
    expect(navItemHref(ajustes, { isAdmin: true })).toBe("/dashboard/settings");
    expect(navItemHref(ajustes, { isAdmin: false })).toBe("/dashboard/settings/recursos");
  });

  it("el resto de los items lleva a su propio href", () => {
    const formularios = NAV_ITEMS.find((i) => i.name === "Formularios")!;
    expect(navItemHref(formularios, { isAdmin: false })).toBe("/dashboard/formularios");
  });
});
