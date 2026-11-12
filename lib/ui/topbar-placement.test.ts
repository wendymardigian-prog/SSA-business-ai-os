// @plantilla-quitar(servicios)
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Servicios A2, F130.0: en las pantallas del modulo (Clientes, Portal, un programa, Afiliados, Grabaciones y Finanzas ›
 * Comisiones) las pestañas de la pagina y la barra de herramientas van en la barra superior (`PageHeader`), nunca
 * adentro del contenido. Un caso por pantalla: lo que la pantalla le pasa a la barra y lo que su contenido NO puede
 * dibujar. La comprobacion en el navegador (que los controles queden adentro de `[data-topbar]`) la hace
 * `scripts/check-responsive.mjs`.
 */

const root = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/** El texto de la llamada a <PageHeader … /> (hasta su cierre), para mirar que props recibe. */
function headerCall(src: string): string {
  const start = src.indexOf("<PageHeader");
  expect(start, "la pantalla dibuja la barra superior").toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (depth === 0 && src.startsWith("/>", i)) return src.slice(start, i + 2);
  }
  return src.slice(start);
}

/** Lo que una barra de herramientas o una fila de pestañas de pagina dibujaria adentro del contenido. */
const TOOLBAR_IN_CONTENT = [/<TopbarTabs\b/, /<ViewToggle\b/, /<ExpandableSearch\b/, /<QuickFilterMenu\b/, /<GroupMenu\b/, /role="tablist"/, /aria-label="Atajos"/];

function expectCleanContent(rel: string, extra: RegExp[] = []) {
  const src = read(rel);
  for (const re of [...TOOLBAR_IN_CONTENT, ...extra]) expect(src, `${rel} no dibuja ${re} adentro del contenido`).not.toMatch(re);
}

describe("barra superior: cada pantalla del modulo pone sus controles arriba", () => {
  it("Clientes › Servicios: pestañas, vista, filtro rápido, buscador, agrupar, ⋯ y + Servicio en la barra", () => {
    const h = headerCall(read("components/services/clients/services-list-view.tsx"));
    for (const prop of ["tabs=", "view=", "quickFilter=", "search=", "group=", "more=", "primary="]) expect(h).toContain(prop);
  });

  it("Clientes › Clientes: lo mismo, con vistas y columnas en la barra", () => {
    const h = headerCall(read("components/services/clients/clients-list-view.tsx"));
    for (const prop of ["tabs=", "view=", "quickFilter=", "search=", "group=", "more=", "primary="]) expect(h).toContain(prop);
    expect(h).toContain("<ViewsMenu");
    expect(h).toContain("<ColumnsMenu");
  });

  it("Portal: las pestañas y el filtro de Por revisar en la barra; la lista sin filtros propios", () => {
    const h = headerCall(read("app/(dashboard)/dashboard/portal/page.tsx"));
    for (const prop of ["tabs=", "quickFilter="]) expect(h).toContain(prop);
    expectCleanContent("components/services/portal/review-list.tsx");
  });

  it("Portal › un programa: pestañas, vista del calendario, filtro de la comunidad, ⋯ y el botón principal en la barra", () => {
    const h = headerCall(read("app/(dashboard)/dashboard/portal/[productId]/page.tsx"));
    for (const prop of ["tabs=", "view=", "quickFilter=", "more=", "primary="]) expect(h).toContain(prop);
    expectCleanContent("components/services/portal/program-content-editor.tsx", [/>\s*<Plus[^>]*\/>\s*Módulo/]);
    expectCleanContent("components/services/portal/program-calendar.tsx", [/aria-label="Vistas del calendario"/, /aria-label="Mes anterior"/, /Sesiones recurrentes \(/]);
    expectCleanContent("components/services/portal/program-community.tsx", [/aria-label="Espacios de la comunidad" onClick/]);
  });

  it("Afiliados: las pestañas en la barra", () => {
    const src = read("app/(dashboard)/dashboard/afiliados/page.tsx");
    expect(headerCall(src)).toContain("tabs=");
    expect(src.slice(src.indexOf("/>", src.indexOf("<PageHeader")))).not.toMatch(/role="tablist"/);
  });

  it("Grabaciones: buscador y filtros en la barra", () => {
    const h = headerCall(read("components/calls/calls-list.tsx"));
    expect(h).toMatch(/filters=|search=/);
  });

  it("Finanzas › Comisiones: los atajos son el filtro rápido de la barra, no botones en el contenido", () => {
    const src = read("components/commissions/commissions-list.tsx");
    const h = headerCall(src);
    for (const prop of ["tabs=", "quickFilter="]) expect(h).toContain(prop);
    expect(src).not.toMatch(/aria-label="Atajos"/);
  });
});
