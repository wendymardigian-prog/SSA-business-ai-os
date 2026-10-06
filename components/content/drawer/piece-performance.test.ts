/**
 * F102: lo que se ve en la seccion de rendimiento del drawer. Se renderiza en
 * el servidor: alcanza para fijar las columnas, la edad de cada red, el aviso de
 * LinkedIn y que no aparezca ningun cero donde falta el dato.
 */

import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { IndexPublication } from "@/lib/dashboards/piece-index";
import { pieceLeads } from "@/lib/dashboards/piece-leads";
import { buildPiecePerformance, type PerformancePublication } from "@/lib/dashboards/piece-performance";
import type { Snapshot } from "@/lib/dashboards/post-analysis";
import { PiecePerformanceSection } from "./piece-performance";

const NOW = new Date("2026-10-06T12:00:00Z");
const ago = (days: number) => {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
};

function snaps(publishedAt: string, lastDay: number, make: (d: number) => Partial<Snapshot>): Snapshot[] {
  return Array.from({ length: lastDay + 1 }, (_, day) => {
    const d = new Date(publishedAt);
    d.setUTCDate(d.getUTCDate() + day);
    return {
      date: d.toISOString().slice(0, 10),
      views: null,
      reach: null,
      likes: null,
      comments: null,
      shares: null,
      saves: null,
      ...make(day),
    };
  });
}

const ig: PerformancePublication = {
  socialPostId: "ig-1",
  platform: "instagram",
  mediaType: "reel",
  publishedAt: ago(10),
  engagementD7: 7.2,
  snapshots: snaps(ago(10), 10, (d) => ({ reach: 100 * (d + 1), likes: 10 * (d + 1) })),
};
const yt: PerformancePublication = {
  socialPostId: "yt-1",
  platform: "youtube",
  mediaType: "short",
  publishedAt: ago(3),
  engagementD7: null,
  snapshots: snaps(ago(3), 3, (d) => ({ views: 50 * (d + 1), likes: 5 * (d + 1) })),
};
const li: PerformancePublication = {
  socialPostId: "li-1",
  platform: "linkedin",
  mediaType: "text",
  publishedAt: ago(12),
  engagementD7: null,
  snapshots: [],
};

const peers: IndexPublication[] = [30, 40, 50].map((days, i) => ({
  socialPostId: `peer-${i}`,
  platform: "instagram",
  mediaType: "reel",
  publishedAt: ago(days),
  engagementD7: [2, 4, 6][i],
}));

function html(publications: PerformancePublication[], population: IndexPublication[] = peers) {
  const performance = buildPiecePerformance({
    publications,
    population,
    leads: pieceLeads({
      pieceId: "p",
      publicationIds: publications.map((p) => p.socialPostId),
      touches: [],
    }),
    now: NOW,
  });
  return renderToStaticMarkup(
    createElement(PiecePerformanceSection, { performance, timeZone: "America/Costa_Rica" }),
  );
}

/** Las celdas de una fila, en texto plano. */
function rowCells(markup: string, platformLabel: string): string[] {
  const row = markup.split("<tr>").find((r) => r.includes(platformLabel) && r.includes("<td"));
  if (!row) throw new Error(`no hay fila de ${platformLabel}`);
  return [...row.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
}

describe("PiecePerformanceSection (F102)", () => {
  it("no aparece si la pieza no tiene publicaciones que hayan salido", () => {
    const empty = renderToStaticMarkup(
      createElement(PiecePerformanceSection, { performance: null, timeZone: "America/Costa_Rica" }),
    );
    expect(empty).toBe("");
  });

  it("muestra una fila por red con su edad: 10 en Instagram y 3 en YouTube", () => {
    const markup = html([ig, yt]);

    // Celdas: Publicado, Edad, Alcance, Interacciones, Engagement, Indice, Leads.
    expect(rowCells(markup, "Instagram")[1]).toBe("10");
    expect(rowCells(markup, "YouTube")[1]).toBe("3");
    for (const label of ["Red", "Publicado", "Edad", "Alcance", "Interacciones", "Engag. 7 días", "Índice", "Leads"]) {
      expect(markup).toContain(`>${label}</th>`);
    }
  });

  it("compara a la misma edad, con el dia en el texto", () => {
    const markup = html([ig, yt]);
    expect(markup).toContain("A la misma edad (día 3)");
  });

  it("el indice se ve con flecha y color: 1,8× en verde para Instagram", () => {
    const cells = rowCells(html([ig, yt]), "Instagram");

    expect(cells[5]).toBe("▲ 1,8×");
  });

  it("YouTube con 3 dias queda 'En curso', no en cero ni en rojo", () => {
    const cells = rowCells(html([ig, yt]), "YouTube");

    expect(cells[5]).toBe("En curso");
    // El alcance de YouTube son vistas, y lo dice.
    expect(cells[2]).toContain("200");
    expect(cells[2]).toContain("vistas");
  });

  it("con menos de 3 comparables dice 'Base insuficiente' y NO muestra indice", () => {
    const markup = html([ig], peers.slice(0, 2));

    // Solo la tabla: la nota de abajo explica el indice con "1,0×".
    const table = markup.slice(0, markup.indexOf("</table>"));

    expect(table).toContain("Base insuficiente");
    expect(table).not.toContain("▲");
    expect(table).not.toMatch(/\d,\d×/);
    // Los crudos siguen a la vista.
    expect(rowCells(markup, "Instagram")[4]).toContain("7,2%");
  });

  it("LinkedIn muestra el aviso y NINGUN cero", () => {
    const markup = html([ig, li]);
    const row = markup.split("<tr>").find((r) => r.includes("LinkedIn") && r.includes("<td"))!;

    expect(row).toContain("LinkedIn no entrega métricas con esta conexión.");
    // Una sola celda de aviso ocupa el lugar de las cifras: no hay un "0".
    expect(row).toContain('colSpan="5"');
    expect(row).not.toMatch(/>0</);
  });

  it("los leads de una red que no los mide son un guion; los de una que si, un cero real", () => {
    const markup = html([ig, yt]);

    expect(rowCells(markup, "Instagram")[6]).toBe("0");
    expect(rowCells(markup, "YouTube")[6]).toBe("—");
  });

  it("el total dice cuantas publicaciones y aclara que las sumas son contexto", () => {
    const markup = html([ig, yt]);

    expect(markup).toContain("2 publicaciones");
    expect(markup).toContain("es contexto, no un ranking");
  });

  it("la tabla se desliza sola en pantallas angostas, sin ensanchar la pagina", () => {
    expect(html([ig, yt])).toContain("overflow-x-auto");
  });
});
