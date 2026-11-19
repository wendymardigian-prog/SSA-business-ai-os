/**
 * Lo que la tabla común agregó para las pantallas que se pasaron a ella (19/11/2026): filas con clases propias, celdas de
 * varias líneas y grupos con título adentro de la misma tabla. Se dibuja en el servidor (sin router: las filas no navegan).
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyPrefs } from "@/lib/ui/data-table/prefs";
import { DataTable, type DataColumn } from "./data-table";
import type { TablePrefsState } from "./use-table-prefs";

interface Row {
  id: string;
  name: string;
  voided?: boolean;
}

const columns: DataColumn<Row>[] = [
  { key: "name", label: "Nombre", render: (r) => r.name },
  { key: "tags", label: "Etiquetas", wrap: true, render: () => "a b c" },
];

const state: TablePrefsState = {
  prefs: emptyPrefs(),
  base: emptyPrefs(),
  dirty: false,
  setPrefs: () => {},
  update: () => {},
  discard: () => {},
  metas: columns,
};

const render = (props: Partial<Parameters<typeof DataTable<Row>>[0]>) =>
  renderToStaticMarkup(createElement(DataTable<Row>, { columns, rows: [], rowKey: (r: Row) => r.id, state, ...props }));

describe("DataTable", () => {
  it("una columna con wrap no corta en una línea", () => {
    const html = render({ rows: [{ id: "1", name: "Ana" }] });
    expect(html).toMatch(/whitespace-normal[^"]*">a b c/);
    expect(html).toMatch(/whitespace-nowrap[^"]*">Ana/);
  });

  it("rowClassName suma clases a la fila", () => {
    const html = render({ rows: [{ id: "1", name: "Ana", voided: true }, { id: "2", name: "Bea" }], rowClassName: (r) => (r.voided ? "opacity-60" : undefined) });
    expect(html.match(/opacity-60/g)?.length).toBe(1);
  });

  it("los grupos dibujan su título y se saltean los vacíos", () => {
    const html = render({
      groups: [
        { key: "a", label: "Pendientes", aside: "US$ 10", rows: [{ id: "1", name: "Ana" }] },
        { key: "b", label: "Vacío", rows: [] },
        { key: "c", label: "Pagadas", rows: [{ id: "2", name: "Bea" }] },
      ],
    });
    expect(html).toContain("Pendientes");
    expect(html).toContain("US$ 10");
    expect(html).toContain("Pagadas");
    expect(html).not.toContain("Vacío");
    expect(html.match(/scope="rowgroup"/g)?.length).toBe(2);
    expect(html.match(/<tbody/g)?.length).toBe(2);
  });

  it("sin grupos, una sola sección y ningún título de grupo", () => {
    const html = render({ rows: [{ id: "1", name: "Ana" }] });
    expect(html).not.toContain('scope="rowgroup"');
    expect(html.match(/<tbody/g)?.length).toBe(1);
  });
});
