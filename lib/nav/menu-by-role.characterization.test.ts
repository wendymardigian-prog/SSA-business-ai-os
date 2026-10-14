/**
 * Caracterizacion del menu lateral ANTES de la corrida formularios-ui (B1).
 *
 * Fija lo que ve hoy cada rol: nombre, grupo, orden y separadores. B1 mueve
 * grupos y saca tres items (plano formularios-ui D1-D4); las aserciones que
 * cambian por esas decisiones se reescriben alli con un comentario que cita el
 * plano. Todo lo demas tiene que seguir dando igual.
 */

import { describe, expect, it } from "vitest";
import { NAV_ITEMS, navSections, visibleNavItems } from "./items";
import { SYSTEM_ROLE_PERMISSIONS } from "@/lib/auth/permissions";

const keysOf = (role: "owner" | "admin" | "member") => SYSTEM_ROLE_PERMISSIONS[role].keys;

function menuFor(viewer: { isAdmin: boolean; permissionKeys: string[]; eod?: boolean }) {
  const items = visibleNavItems(NAV_ITEMS, {
    isAdmin: viewer.isAdmin,
    permissionKeys: viewer.permissionKeys,
    flags: { eod: viewer.eod ?? false },
  });
  return navSections(items).map((s) => ({
    group: s.group,
    title: s.title,
    separatorBefore: s.separatorBefore,
    items: s.items.map((i) => i.name),
  }));
}

describe("caracterizacion: el menu de hoy por rol (formularios-ui, antes de B1)", () => {
  it("Owner y Admin ven todo, en este orden y con estos grupos", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(menuFor({ isAdmin: true, permissionKeys: keysOf(role), eod: true })).toEqual([
        { group: "inicio", title: null, separatorBefore: false, items: ["Dashboards", "Bandeja", "Tareas", "Mi reporte del día"] },
        { group: "adquisicion", title: "Adquisición", separatorBefore: true, items: ["Contenido", "Social", "Formularios"] },
        { group: "ventas", title: "Ventas", separatorBefore: true, items: ["Contactos", "Agenda", "Llamadas", "Ventas"] },
        {
          group: "automatizacion",
          title: "Automatización",
          separatorBefore: true,
          items: ["Automatizaciones", "Agentes IA", "Conocimiento", "Recursos"],
        },
        { group: "sistema", title: null, separatorBefore: true, items: ["Integraciones", "Ajustes"] },
      ]);
    }
  });

  it("el Member de sistema ve su menu de hoy (sin Social, sin Conocimiento, sin Integraciones, sin Ajustes)", () => {
    expect(menuFor({ isAdmin: false, permissionKeys: keysOf("member"), eod: true })).toEqual([
      { group: "inicio", title: null, separatorBefore: false, items: ["Dashboards", "Bandeja", "Tareas", "Mi reporte del día"] },
      { group: "adquisicion", title: "Adquisición", separatorBefore: true, items: ["Contenido", "Formularios"] },
      { group: "ventas", title: "Ventas", separatorBefore: true, items: ["Contactos", "Agenda", "Llamadas", "Ventas"] },
      { group: "automatizacion", title: "Automatización", separatorBefore: true, items: ["Automatizaciones", "Agentes IA", "Recursos"] },
    ]);
  });

  it("Mi reporte del dia solo aparece con la condicion del servidor, tambien para un admin", () => {
    const flat = (eod: boolean) => menuFor({ isAdmin: true, permissionKeys: [], eod }).flatMap((s) => s.items);
    expect(flat(true)).toContain("Mi reporte del día");
    expect(flat(false)).not.toContain("Mi reporte del día");
  });

  it("un rol personalizado SIN forms.view no ve Formularios; CON forms.view si", () => {
    const sin = menuFor({ isAdmin: false, permissionKeys: ["social.view"] }).flatMap((s) => s.items);
    const con = menuFor({ isAdmin: false, permissionKeys: ["forms.view"] }).flatMap((s) => s.items);
    expect(sin).not.toContain("Formularios");
    expect(con).toContain("Formularios");
  });

  it("forms.manage sola no muestra Formularios (el item pide forms.view)", () => {
    const items = menuFor({ isAdmin: false, permissionKeys: ["forms.manage"] }).flatMap((s) => s.items);
    expect(items).not.toContain("Formularios");
  });

  it("un rol personalizado sin ninguna clave solo ve lo que no pide permiso", () => {
    expect(menuFor({ isAdmin: false, permissionKeys: [] })).toEqual([
      { group: "inicio", title: null, separatorBefore: false, items: ["Dashboards", "Bandeja"] },
      { group: "adquisicion", title: "Adquisición", separatorBefore: true, items: ["Contenido"] },
      { group: "ventas", title: "Ventas", separatorBefore: true, items: ["Contactos"] },
      { group: "automatizacion", title: "Automatización", separatorBefore: true, items: ["Automatizaciones", "Agentes IA", "Recursos"] },
    ]);
  });

  it("un grupo sin items visibles no muestra su titulo", () => {
    expect(menuFor({ isAdmin: false, permissionKeys: [] }).some((s) => s.group === "sistema")).toBe(false);
  });
});
