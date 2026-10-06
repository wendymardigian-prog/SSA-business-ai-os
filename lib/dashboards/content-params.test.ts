import { describe, expect, it } from "vitest";
import { DEFAULT_GROUP, GROUP_PARAM, parseClassificationParams, selectedFor, withParam } from "./content-params";
import { GROUP_DIMENSIONS } from "./content";

describe("los filtros del dashboard de contenido en la URL (F105)", () => {
  it("sin nada en la URL, agrupa por oferta y no filtra", () => {
    const parsed = parseClassificationParams({});

    expect(DEFAULT_GROUP).toBe("offer");
    expect(parsed.group).toBe("offer");
    expect(parsed.filters).toEqual({});
  });

  it("lee agrupar y los cinco filtros", () => {
    const parsed = parseClassificationParams({
      agrupar: "pillar",
      pieza: "pc-1",
      oferta: "o-1",
      pilar: "p-1",
      embudo: "mofu",
      formato: "reel",
    });

    expect(parsed.group).toBe("pillar");
    expect(parsed.filters).toEqual({ piece: "pc-1", offer: "o-1", pillar: "p-1", funnel: "mofu", format: "reel" });
  });

  it("'none' es un valor valido: elige lo sin asignar", () => {
    expect(parseClassificationParams({ oferta: "none" }).filters).toEqual({ offer: "none" });
  });

  it("una dimension desconocida vuelve al valor por defecto", () => {
    expect(parseClassificationParams({ agrupar: "cualquier-cosa" }).group).toBe("offer");
    expect(parseClassificationParams({ agrupar: ["pillar", "offer"] }).group).toBe("offer");
  });

  it("ignora vacios, listas y valores desmedidos", () => {
    const parsed = parseClassificationParams({
      oferta: "   ",
      pilar: ["a", "b"],
      embudo: "x".repeat(200),
      formato: undefined,
    });

    expect(parsed.filters).toEqual({});
  });

  it("withParam arma la URL sin tocar el resto y quita el parametro vacio", () => {
    const base = new URLSearchParams("periodo=30d&red=instagram");

    expect(withParam(base, "oferta", "o-1")).toBe("periodo=30d&red=instagram&oferta=o-1");
    expect(withParam(new URLSearchParams("oferta=o-1&red=tiktok"), "oferta", null)).toBe("red=tiktok");
    expect(withParam(new URLSearchParams("agrupar=pillar"), "agrupar", "offer")).toBe("");
  });

  it("cada dimension de la tabla tiene su parametro y su valor elegido", () => {
    expect(GROUP_DIMENSIONS.every((d) => typeof GROUP_PARAM[d.value] === "string")).toBe(true);

    const filters = { offer: "o-1", funnel: "tofu", piece: "pc-1" };
    expect(selectedFor("offer", filters, null)).toBe("o-1");
    expect(selectedFor("funnel", filters, null)).toBe("tofu");
    expect(selectedFor("piece", filters, null)).toBe("pc-1");
    expect(selectedFor("pillar", filters, null)).toBeNull();
    // La red no es un filtro de clasificacion: viene del parametro `red`.
    expect(selectedFor("platform", filters, "instagram")).toBe("instagram");
  });
});
