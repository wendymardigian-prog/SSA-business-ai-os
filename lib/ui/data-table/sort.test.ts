import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ariaSort, nextSort } from "./sort";
import { DataTable, type DataColumn } from "@/components/ui/data-table/data-table";
import { emptyPrefs } from "./prefs";
import type { TablePrefsState } from "@/components/ui/data-table/use-table-prefs";

describe("ordenar con un clic en el título", () => {
  it("la misma columna invierte; otra arranca con su sentido", () => {
    expect(nextSort({ key: "a", dir: "asc" }, "a", "desc")).toEqual({ key: "a", dir: "desc" });
    expect(nextSort({ key: "a", dir: "desc" }, "a", "desc")).toEqual({ key: "a", dir: "asc" });
    expect(nextSort({ key: "a", dir: "desc" }, "b", "asc")).toEqual({ key: "b", dir: "asc" });
    expect(nextSort(null, "b", "desc")).toEqual({ key: "b", dir: "desc" });
  });

  it("aria-sort", () => {
    expect(ariaSort({ key: "a", dir: "asc" }, "a")).toBe("ascending");
    expect(ariaSort({ key: "a", dir: "desc" }, "a")).toBe("descending");
    expect(ariaSort({ key: "a", dir: "desc" }, "b")).toBe("none");
  });
});

describe("DataTable con y sin orden", () => {
  type Row = { id: string; n: number };
  const columns: DataColumn<Row>[] = [
    { key: "id", label: "Id", render: (r) => r.id },
    { key: "n", label: "Número", align: "right", sortable: true, render: (r) => r.n },
  ];
  const prefs = emptyPrefs();
  const state = { prefs, base: prefs, dirty: false, setPrefs: () => {}, update: () => {}, discard: () => {}, metas: columns } as TablePrefsState;
  const render = (extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(createElement(DataTable<Row>, { columns, rows: [{ id: "x", n: 1 }], rowKey: (r: Row) => r.id, state, ...extra }));

  it("sin onSortChange, los títulos son texto como siempre (aunque la columna diga sortable)", () => {
    const html = render();
    expect(html).not.toContain("<button");
    expect(html).not.toContain("aria-sort");
  });

  it("con onSortChange, la columna ordenable es un botón con aria-sort; las demás, no", () => {
    const html = render({ sort: { key: "n", dir: "asc" }, onSortChange: () => {} });
    expect(html).toContain('aria-sort="ascending"');
    expect((html.match(/<button/g) ?? []).length).toBe(1);
    expect(html).toContain("Ordenar por Número");
  });
});
