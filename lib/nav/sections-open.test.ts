import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLLAPSIBLE_GROUPS } from "./items";
import { SECTION_HIDDEN_CLASS, activeSectionGroup, sectionOpen, sectionOpenKey, sectionsOpenHeadScript } from "./sections-open";

describe("sectionOpen (plano formularios-ui F2, todas las secciones desde el 9/11/2026)", () => {
  it("sin nada guardado: Herramientas cerrada y las demas abiertas, como se veia antes", () => {
    expect(sectionOpen("herramientas", null, "/dashboard/inbox")).toBe(false);
    expect(sectionOpen("ventas", undefined, null)).toBe(true);
    expect(sectionOpen("adquisicion", null, "/dashboard/inbox")).toBe(true);
    expect(sectionOpen("servicio", null, "/dashboard/inbox")).toBe(true); // @plantilla-quitar(ventas)
  });

  it("cerrada a mano se queda cerrada, aunque abra por defecto", () => {
    expect(sectionOpen("ventas", "0", "/dashboard/inbox")).toBe(false);
  });

  it("guardada abierta y la pantalla activa afuera: abierta", () => {
    expect(sectionOpen("herramientas", "1", "/dashboard/inbox")).toBe(true);
    expect(sectionOpen("adquisicion", "1", "/dashboard/inbox")).toBe(true);
  });

  it("guardada cerrada y la pantalla activa afuera: cerrada", () => {
    expect(sectionOpen("herramientas", "0", "/dashboard/inbox")).toBe(false);
  });

  it("con la pantalla activa adentro se ve abierta aunque la persona la haya cerrado", () => {
    expect(sectionOpen("herramientas", "0", "/dashboard/formularios")).toBe(true); // @plantilla-quitar(formularios)
    expect(sectionOpen("herramientas", "0", "/dashboard/flows")).toBe(true);
    expect(sectionOpen("herramientas", "0", "/dashboard/settings")).toBe(true);
    expect(sectionOpen("ventas", "0", "/dashboard/contacts")).toBe(true);
    expect(sectionOpen("adquisicion", "0", "/dashboard/content")).toBe(true);
    expect(sectionOpen("servicio", "0", "/dashboard/afiliados")).toBe(true); // @plantilla-quitar(ventas)
  });

  it("la pantalla activa abre SOLO su seccion", () => {
    expect(sectionOpen("herramientas", "0", "/dashboard/contacts")).toBe(false);
    expect(sectionOpen("ventas", "0", "/dashboard/flows")).toBe(false);
  });

  it("un valor guardado raro no la abre", () => {
    expect(sectionOpen("herramientas", "si" as never, "/dashboard/inbox")).toBe(false);
  });
});

describe("activeSectionGroup", () => {
  it("dice en que seccion colapsable esta cada pantalla", () => {
    expect(activeSectionGroup("/dashboard/flows")).toBe("herramientas");
    expect(activeSectionGroup("/dashboard/settings")).toBe("herramientas");
    expect(activeSectionGroup("/dashboard/contacts")).toBe("ventas");
    expect(activeSectionGroup("/dashboard/content")).toBe("adquisicion");
    expect(activeSectionGroup("/dashboard/afiliados")).toBe("servicio"); // @plantilla-quitar(ventas)
  });

  it("los sueltos de arriba y nada no son de ninguna seccion", () => {
    for (const href of ["/dashboard/inbox", "/dashboard/dashboards/chat", null, undefined]) {
      expect(activeSectionGroup(href)).toBe(null);
    }
  });
});

describe("el mecanismo sin parpadeo cubre cada seccion colapsable", () => {
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

  it("cada seccion tiene su clase de escondida, su variante CSS y su clave", () => {
    for (const group of COLLAPSIBLE_GROUPS) {
      expect(SECTION_HIDDEN_CLASS[group], group).toBe(`hidden open-${group}:block collapsed:block`);
      expect(css, group).toContain(`@custom-variant open-${group} (html.${sectionOpenKey(group)} &);`);
    }
  });

  it("el script del <head> recorre todas las secciones y respeta la clave vieja de Herramientas", () => {
    const script = sectionsOpenHeadScript();
    for (const group of COLLAPSIBLE_GROUPS) expect(script).toContain(`"${group}"`);
    expect(script).toContain("nav-tools-open");
    expect(script).toContain("try{");
  });

  it("el script del <head> pone la clase de una seccion guardada abierta, y la clave vieja abre Herramientas", () => {
    const run = (stored: Record<string, string>) => {
      const classes = new Set<string>();
      const fakeDocument = { documentElement: { classList: { add: (c: string) => classes.add(c) } } };
      const fakeStorage = { getItem: (k: string) => stored[k] ?? null };
      new Function("document", "localStorage", sectionsOpenHeadScript())(fakeDocument, fakeStorage);
      return [...classes].sort();
    };
    const porDefecto = COLLAPSIBLE_GROUPS.filter((g) => g !== "herramientas").map(sectionOpenKey).sort();
    expect(run({})).toEqual(porDefecto);
    expect(run({ "nav-open-ventas": "0", "nav-open-adquisicion": "0" })).toEqual(porDefecto.filter((c) => c !== "nav-open-ventas" && c !== "nav-open-adquisicion"));
    expect(run({ "nav-tools-open": "1" })).toEqual([...porDefecto, "nav-open-herramientas"].sort());
    // Lo nuevo le gana a lo viejo: cerrada a mano despues del cambio, queda cerrada.
    expect(run({ "nav-tools-open": "1", "nav-open-herramientas": "0" })).toEqual(porDefecto);
  });

  it("sin almacenamiento (ventana privada) quedan los valores por defecto y no lanza", () => {
    const classes = new Set<string>();
    const fakeDocument = { documentElement: { classList: { add: (c: string) => classes.add(c) } } };
    const blocked = { getItem: () => { throw new Error("SecurityError"); } };
    expect(() => new Function("document", "localStorage", sectionsOpenHeadScript())(fakeDocument, blocked)).not.toThrow();
    expect([...classes].sort()).toEqual(COLLAPSIBLE_GROUPS.filter((g) => g !== "herramientas").map(sectionOpenKey).sort());
  });
});
