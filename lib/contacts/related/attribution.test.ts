import { describe, expect, it } from "vitest";
import { contactListPlan, parseContactListFilters } from "../list-query";
import { contactCells } from "../columns";
import { attributionOptionsFromRpc } from "./attribution";

const parse = (params: Record<string, string | string[]>) => parseContactListFilters(params, []);
const clauses = (params: Record<string, string | string[]>) =>
  contactListPlan(parse(params)).clauses.filter((c) => !("column" in c && c.column === "is_anonymous"));

describe("atribución: filtros", () => {
  it("campaña, contenido y término del primer toque, por la ruta jsonb canónica", () => {
    expect(clauses({ campana: ["lanzamiento", "black friday"], termino: "crm" })).toEqual([
      { op: "in", column: "attribution->first_touch->>campaign", values: ["lanzamiento", "black friday"] },
      { op: "in", column: "attribution->first_touch->>term", values: ["crm"] },
    ]);
  });

  it("el último toque tiene sus propios parámetros", () => {
    expect(clauses({ fuente_ult: "instagram", medio_ult: "dm", contenido_ult: "reel 3" })).toEqual([
      { op: "in", column: "attribution->last_touch->>source", values: ["instagram"] },
      { op: "in", column: "attribution->last_touch->>medium", values: ["dm"] },
      { op: "in", column: "attribution->last_touch->>content", values: ["reel 3"] },
    ]);
  });

  it("un texto con comillas, barras o demasiado largo no entra a la consulta", () => {
    expect(clauses({ campana: ['a"b', "a\\b", "x".repeat(151), "ok"] })).toEqual([
      { op: "in", column: "attribution->first_touch->>campaign", values: ["ok"] },
    ]);
  });
});

describe("atribución: columnas y opciones", () => {
  it("lee la forma canónica del primer y último toque", () => {
    const cells = contactCells({
      attribution: {
        version: 2,
        first_touch: { source: "instagram", medium: "comment", campaign: "lanzamiento" },
        last_touch: { source: "web", medium: "booking", occurred_at: "2026-10-01T12:00:00Z", term: "crm" },
      },
    });
    expect(cells.first_source).toEqual({ t: "text", text: "Instagram" });
    expect(cells.first_campaign).toEqual({ t: "text", text: "lanzamiento" });
    expect(cells.first_term).toBeNull();
    expect(cells.last_term).toEqual({ t: "text", text: "crm" });
    expect(cells.last_at).toEqual({ t: "date", at: "2026-10-01T12:00:00Z", mode: "day" });
  });

  it("sin atribución, todo vacío y nada lanza", () => {
    const cells = contactCells({ attribution: null });
    expect(cells.first_source).toBeNull();
    expect(cells.last_at).toBeNull();
  });

  it("las opciones de la base: solo listas de textos seguros", () => {
    expect(attributionOptionsFromRpc({ first_campaign: ["a", 3, 'mal"o'], last_term: ["crm"], otra: ["x"] })).toEqual({
      first_campaign: [{ value: "a", label: "a" }],
      last_term: [{ value: "crm", label: "crm" }],
    });
    expect(attributionOptionsFromRpc(null)).toEqual({});
    expect(attributionOptionsFromRpc([1, 2])).toEqual({});
  });
});
