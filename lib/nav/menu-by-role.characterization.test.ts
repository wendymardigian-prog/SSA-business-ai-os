/**
 * Caracterizacion del menu lateral por rol (corrida formularios-ui).
 *
 * Se escribio ANTES de B1 fijando el menu de entonces; B1 mueve grupos y saca tres items
 * (plano formularios-ui D1-D4) y por eso las aserciones de los grupos se reescribieron con un
 * comentario que cita el plano. Lo que NO cambia por esas decisiones sigue fijado: quien ve
 * cada item (Social, Formularios, Agenda, Llamadas, Ventas, Tareas, Mi reporte del dia) y el
 * orden dentro de cada grupo. Antes de B1:
 *   Owner/Admin: inicio[Dashboards, Bandeja, Mi reporte del dia] adquisicion[Contenido, Social, Formularios]
 *     ventas[Contactos, Agenda, Llamadas, Ventas] automatizacion[Automatizaciones, Agentes IA, Conocimiento, Recursos]
 *     sistema[Integraciones, Ajustes]
 *   Member: lo mismo sin Social, Conocimiento, Integraciones ni Ajustes (con Recursos).
 */

import { describe, expect, it } from "vitest";
import { NAV_ITEMS, navSections, visibleNavItems } from "./items";
import { SYSTEM_ROLE_PERMISSIONS } from "@/lib/auth/permissions";

const keysOf = (role: "owner" | "admin" | "member") => SYSTEM_ROLE_PERMISSIONS[role].keys;

function menuFor(viewer: { permissionKeys: string[]; eod?: boolean }) {
  const items = visibleNavItems(NAV_ITEMS, {
    permissionKeys: viewer.permissionKeys,
    // `settings`: el layout la calcula con `visibleSettingsTabs`; todos ven al menos Recursos, que no pide permiso.
    flags: { eod: viewer.eod ?? false, settings: true },
  });
  return navSections(items).map((s) => ({
    group: s.group,
    title: s.title,
    separatorBefore: s.separatorBefore,
    items: s.items.map((i) => i.name),
  }));
}

describe("caracterizacion: el menu por rol (formularios-ui)", () => {
  it("Owner y Admin ven todo, en este orden y con estos grupos (plano formularios-ui, D1-D4)", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(menuFor({ permissionKeys: keysOf(role), eod: true })).toEqual([
        { group: "inicio", title: null, separatorBefore: false, items: ["Dashboards", "Bandeja", "Mi reporte del día"] },
        { group: "adquisicion", title: "Adquisición", separatorBefore: true, items: ["Contenido", "Social"] },
        // Extra I: Owner y Admin ganan «Finanzas» al final del grupo; el resto del orden no cambia.
        { group: "ventas", title: "Ventas", separatorBefore: true, items: ["Contactos", "Agenda", "Llamadas", "Ventas", "Finanzas"] },
        { group: "herramientas", title: "Herramientas", separatorBefore: true, items: ["Tareas", "Automatizaciones", "Formularios", "Agentes IA", "Ajustes"] },
      ]);
    }
  });

  it("el Member de sistema pierde Recursos y gana Ajustes; sigue sin Social (plano formularios-ui, D4)", () => {
    expect(menuFor({ permissionKeys: keysOf("member"), eod: true })).toEqual([
      { group: "inicio", title: null, separatorBefore: false, items: ["Dashboards", "Bandeja", "Mi reporte del día"] },
      { group: "adquisicion", title: "Adquisición", separatorBefore: true, items: ["Contenido"] },
      // Cambio aprobado M9 (Extra I): el Member de sistema gana «Finanzas» (ve sus propias comisiones).
      { group: "ventas", title: "Ventas", separatorBefore: true, items: ["Contactos", "Agenda", "Llamadas", "Ventas", "Finanzas"] },
      { group: "herramientas", title: "Herramientas", separatorBefore: true, items: ["Tareas", "Automatizaciones", "Formularios", "Agentes IA", "Ajustes"] },
    ]);
  });

  it("Mi reporte del dia solo aparece con la condicion del servidor, tambien para un admin", () => {
    const flat = (eod: boolean) => menuFor({ permissionKeys: [], eod }).flatMap((s) => s.items);
    expect(flat(true)).toContain("Mi reporte del día");
    expect(flat(false)).not.toContain("Mi reporte del día");
  });

  it("un rol personalizado SIN forms.view no ve Formularios; CON forms.view si", () => {
    const sin = menuFor({ permissionKeys: ["social.view"] }).flatMap((s) => s.items);
    const con = menuFor({ permissionKeys: ["forms.view"] }).flatMap((s) => s.items);
    expect(sin).not.toContain("Formularios");
    expect(con).toContain("Formularios");
  });

  it("forms.manage sola no muestra Formularios (el item pide forms.view)", () => {
    const items = menuFor({ permissionKeys: ["forms.manage"] }).flatMap((s) => s.items);
    expect(items).not.toContain("Formularios");
  });

  it("un rol personalizado sin ninguna clave solo ve lo que no pide permiso (plano formularios-ui, D1-D4)", () => {
    // Equipo y roles (B1): cada item pide su clave, asi que sin ninguna solo queda Ajustes (que pide la bandeja
    // `settings`: todos llegan a Recursos).
    expect(menuFor({ permissionKeys: [] })).toEqual([
      { group: "herramientas", title: "Herramientas", separatorBefore: false, items: ["Ajustes"] },
    ]);
  });

  it("un grupo sin items visibles no muestra su titulo", () => {
    // Un viewer sin ninguna bandera ni permiso no ve ni Social, ni Formularios, ni Ajustes: "adquisicion" queda con Contenido,
    // pero si ademas se le saca ese item el grupo desaparece entero.
    const items = visibleNavItems(NAV_ITEMS, { permissionKeys: ["content.view"] }).filter((i) => i.name !== "Contenido");
    expect(navSections(items).some((s) => s.group === "adquisicion")).toBe(false);
  });
});
