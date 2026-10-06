/**
 * F105: la tabla de rendimiento agrupado. Se renderiza en el servidor: alcanza
 * para fijar que 'Sin asignar' esta, que va al final, que el total es la suma de
 * las filas y que un dato que falta es un guion y no un cero.
 */

import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { GroupRow } from "@/lib/dashboards/content";
import { GroupTable } from "./group-table";

const row = (over: Partial<GroupRow> & { key: string; label: string }): GroupRow => ({
  unassigned: false,
  posts: 1,
  pieces: 1,
  reach: null,
  interactions: null,
  avgEngagement: null,
  avgEngagementD7: null,
  leads: null,
  ...over,
});

const rows: GroupRow[] = [
  row({ key: "o-1", label: "Mentoria", posts: 3, pieces: 2, reach: 1800, interactions: 145, avgEngagement: 8.5, avgEngagementD7: 4, leads: 4 }),
  row({ key: "none", label: "Sin asignar", unassigned: true, posts: 2, pieces: 1, reach: 300, interactions: 11, leads: 0 }),
];

const render = (props: Partial<Parameters<typeof GroupTable>[0]> = {}) =>
  renderToStaticMarkup(createElement(GroupTable, { rows, dimensionLabel: "Oferta", ...props }));

describe("GroupTable (F105)", () => {
  it("una fila por grupo, con 'Sin asignar' y el total que suma las filas", () => {
    const markup = render();

    expect(markup).toContain("Mentoria");
    expect(markup).toContain("Sin asignar");
    // Total: 3 + 2 publicaciones, 1.800 + 300 de alcance, 4 + 0 leads.
    const footer = markup.slice(markup.indexOf("<tfoot"));
    expect(footer).toContain(">5<");
    expect(footer).toContain("2.100");
    expect(footer).toContain("156");
  });

  it("un dato que falta es un guion, no un cero", () => {
    const markup = render();
    const unassigned = markup.split("<tr").find((r) => r.includes("Sin asignar") && r.includes("<td"))!;
    const cells = [...unassigned.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => m[1]);

    // Publicaciones, Piezas, Alcance, Interacciones, Engag. prom., Engag. 7 dias, Leads.
    expect(cells).toEqual(["2", "1", "300", "11", "—", "—", "0"]);
  });

  it("una pieza cuenta cero para lo publicado a mano: se muestra un guion", () => {
    const markup = render({ rows: [row({ key: "none", label: "Sin asignar", unassigned: true, pieces: 0 })] });
    const cells = [...markup.split("<tr").find((r) => r.includes("<td"))!.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => m[1]);

    expect(cells[1]).toBe("—");
  });

  it("sin onSelect las filas no son botones; con onSelect, si", () => {
    expect(render()).not.toContain("<button");

    const interactive = render({ onSelect: () => undefined, selectedKey: "o-1" });
    expect(interactive).toContain("<button");
    expect(interactive).toContain('aria-pressed="true"');
  });

  it("vacia dice por que", () => {
    expect(render({ rows: [] })).toContain("No hay publicaciones en este periodo con estos filtros.");
  });

  it("los encabezados son de columna y el nombre de la dimension es el que se pidio", () => {
    const markup = render({ dimensionLabel: "Pilar" });

    expect(markup).toContain('scope="col"');
    expect(markup).toContain(">Pilar</th>");
    expect(markup).toContain("Leads</th>");
    expect(markup).toContain("overflow-x-auto");
  });
});
