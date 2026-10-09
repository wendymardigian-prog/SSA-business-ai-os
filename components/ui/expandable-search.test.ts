import { describe, expect, it } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExpandableSearch } from "./expandable-search";
import { FilterMenu } from "./filter-menu";

/**
 * Los dos controles compactos de las barras de Agenda y Contactos.
 * `renderToStaticMarkup` alcanza: renderizan el estado inicial, sin efectos.
 */

const search = (props: Partial<Parameters<typeof ExpandableSearch>[0]> = {}) =>
  renderToStaticMarkup(createElement(ExpandableSearch, { value: "", onCommit: () => {}, label: "Buscar contacto", ...props }));

describe("ExpandableSearch", () => {
  it("sin busqueda aplicada es solo una lupa, cerrada", () => {
    const html = search();
    expect(html).toContain('aria-label="Buscar contacto"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("<input");
  });

  it("con una busqueda aplicada arranca abierta: no se puede esconder lo que esta filtrando", () => {
    const html = search({ value: "ana" });
    expect(html).toContain("<input");
    expect(html).toContain('value="ana"');
    expect(html).toContain('aria-label="Limpiar la búsqueda"');
  });

  it("el cartel de alcance va atado al campo (aria-describedby) y tambien como title nativo", () => {
    const html = search({ value: "ana", hint: "Se busca solo dentro de: Hoy." });
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("Se busca solo dentro de: Hoy.");
    expect(html).toMatch(/aria-describedby="[^"]+"/);
    expect(html).toContain('title="Se busca solo dentro de: Hoy."');
  });

  it("sin cartel no hay tooltip", () => {
    expect(search({ value: "ana", hint: null })).not.toContain('role="tooltip"');
  });
});

describe("FilterMenu compacto", () => {
  const menu = (badge: number) =>
    renderToStaticMarkup(
      createElement(
        FilterMenu,
        { label: "Filtros", compact: true, badge, active: badge > 0 } as ComponentProps<typeof FilterMenu>,
        createElement("p", null, "x"),
      ),
    );

  it("es un boton de solo icono: sin texto, sin chevron, con su nombre accesible", () => {
    const html = menu(0);
    expect(html).toContain('aria-label="Filtros"');
    expect(html).toContain('title="Filtros"');
    expect(html).not.toContain("Filtros:");
  });

  it("el globito dice cuantos filtros hay y el lector de pantalla lo anuncia", () => {
    const html = menu(3);
    expect(html).toContain('aria-label="Filtros, 3 activos"');
    expect(html).toContain(">3<");
    expect(menu(1)).toContain('aria-label="Filtros, 1 activo"');
  });

  it("sin filtros no dibuja el globito", () => {
    expect(menu(0)).not.toContain("rounded-full bg-primary");
  });
});
