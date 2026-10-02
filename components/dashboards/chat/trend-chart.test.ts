import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { TrendChart, type TrendPoint } from "./trend-chart";
import type { ChartSeries } from "@/components/dashboards/charts";

/**
 * `hrefFor` (Bloque A, A4): un prop opcional para que un punto del dashboard
 * de IA lleve a Corridas. `renderToStaticMarkup` alcanza: TrendChart usa
 * `useState`, pero solo para el hover, que no entra en el render inicial.
 */

const points: TrendPoint[] = [
  { bucket: "28 sept", label: "lunes 28 de septiembre" },
  { bucket: "29 sept", label: "martes 29 de septiembre" },
];
const stackSeries: ChartSeries[] = [
  { key: "agent", label: "Agente", color: "var(--src-agent)", points: [{ bucket: "28 sept", value: 3 }, { bucket: "29 sept", value: 1 }] },
  { key: "flow_ai_node", label: "Automatizacion", color: "var(--src-flow)", points: [{ bucket: "28 sept", value: 2 }, { bucket: "29 sept", value: 0 }] },
];

function renderChart(hrefFor?: (i: number, seriesKey?: string) => string | null | undefined) {
  return renderToStaticMarkup(
    createElement(TrendChart, { points, series: stackSeries, mode: "stack", ariaLabel: "gasto por dia", hrefFor }),
  );
}

describe("TrendChart.hrefFor (A4)", () => {
  it("sin el prop, no envuelve ninguna barra en un link: el grafico no cambia", () => {
    expect(renderChart()).not.toContain("<a ");
  });

  it("con el prop, una barra con href queda envuelta en un <a> de verdad", () => {
    const html = renderChart((i) => (i === 0 ? "/dashboard/agents/runs?desde=2026-09-28" : null));
    expect(html).toContain('href="/dashboard/agents/runs?desde=2026-09-28"');
  });

  it("recibe el indice de la columna y la clave del tramo (dia + origen)", () => {
    const calls: Array<[number, string | undefined]> = [];
    renderChart((i, seriesKey) => {
      calls.push([i, seriesKey]);
      return null;
    });
    // Un tramo visible por columna y tramo (el segundo dia no tiene flow_ai_node: valor 0, sin tramo).
    expect(calls).toContainEqual([0, "agent"]);
    expect(calls).toContainEqual([0, "flow_ai_node"]);
    expect(calls).toContainEqual([1, "agent"]);
    expect(calls).not.toContainEqual([1, "flow_ai_node"]);
  });

  it("un tramo sin href (null) no queda envuelto, aunque su columna tenga otros con link", () => {
    const html = renderChart((_i, seriesKey) => (seriesKey === "agent" ? "/x" : null));
    // Dos columnas, las dos con el tramo "agent": dos <a>, nunca el de "flow_ai_node".
    expect(html.match(/<a /g)?.length).toBe(2);
  });
});
