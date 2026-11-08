import { describe, expect, it } from "vitest";
import { blockersMessage, buildGenerateManyInput, countLine, manyPrimaryLabel, manyReason, MAX_PER_BATCH, paramsToQuery, skipLabel, type GenerateManyState, type ManyCounts } from "./generate-many";

const counts = (over: Partial<ManyCounts> = {}): ManyCounts => ({ total: 23, existing: 4, willGenerate: 19, over: false, blockers: [], ...over });
const state = (over: Partial<GenerateManyState> = {}): GenerateManyState => ({ counts: counts(), skipExisting: true, publish: true, emailOn: false, email: { subject: "Tu certificado", body: "Acá: {{design.link}}" }, ...over });

describe("«Generar para varios» (F51)", () => {
  it("los filtros de Contactos como parámetros de URL: repetidos, sin vacíos y escapados", () => {
    expect(paramsToQuery({ tag: ["cohorte-octubre", "certificada"], q: "Ana Pérez", vacio: "  ", lista: [] })).toBe("tag=cohorte-octubre&tag=certificada&q=Ana+P%C3%A9rez");
    expect(paramsToQuery({})).toBe("");
  });

  it("«23 cumplen · 4 ya tienen uno válido (se saltean)»", () => {
    expect(countLine(counts(), true)).toBe("23 cumplen · 4 ya tienen uno válido (se saltean)");
    expect(countLine(counts(), false)).toBe("23 cumplen · 4 ya tienen uno válido (se reemplaza)");
    expect(countLine(counts({ total: 1, existing: 1 }), true)).toBe("1 cumple · 1 ya tiene uno válido (se saltea)");
    expect(countLine(counts({ existing: 0 }), true)).toBe("23 cumplen");
  });

  it("«Saltear a quienes ya tienen uno válido» habla del tipo de documento", () => {
    expect(skipLabel({ doc_type: "certificado", doc_type_label: null })).toBe("Saltear a quienes ya tienen un certificado válido");
    expect(skipLabel({ doc_type: "constancia", doc_type_label: null })).toBe("Saltear a quienes ya tienen una constancia válida");
    expect(skipLabel({ doc_type: "diploma", doc_type_label: null })).toBe("Saltear a quienes ya tienen un diploma válido");
    expect(skipLabel({ doc_type: "otro", doc_type_label: "Credencial" })).toBe("Saltear a quienes ya tienen uno válido");
    expect(skipLabel({ doc_type: null, doc_type_label: null })).toBe("Saltear a quienes ya tienen uno válido");
  });

  it("el botón dice cuántas piezas se generan: con «saltear», las que no tienen una válida", () => {
    expect(manyPrimaryLabel(counts(), true)).toBe("Generar 19");
    expect(manyPrimaryLabel(counts(), false)).toBe("Generar 23");
    expect(manyPrimaryLabel(null, true)).toBe("Generar");
    expect(manyPrimaryLabel(counts({ total: 0, willGenerate: 0 }), true)).toBe("Generar");
  });

  it("cuándo no se puede confirmar, y por qué", () => {
    expect(manyReason(state())).toBeNull();
    expect(manyReason(state({ counts: null }))).toBe("Contando a quiénes les toca…");
    expect(manyReason(state({ counts: counts({ total: 0, existing: 0, willGenerate: 0 }) }))).toBe("No hay contactos con esos filtros.");
    expect(manyReason(state({ counts: counts({ total: 1200, over: true }) }))).toContain(`el máximo es ${MAX_PER_BATCH} por vez`);
    expect(manyReason(state({ counts: counts({ total: 3, existing: 3, willGenerate: 0 }) }))).toBe("Todos ya tienen una pieza válida: no hay nada para generar.");
    expect(manyReason(state({ counts: counts({ blockers: ["Nombre como lo quiere en el certificado"] }) }))).toBe(blockersMessage(["Nombre como lo quiere en el certificado"]));
    expect(manyReason(state({ emailOn: true, email: { subject: "", body: "x" } }))).toBe("Escribí el asunto del email.");
    expect(manyReason(state({ emailOn: true }))).toBeNull();
  });

  it("lo que se manda: la audiencia como URL, «saltear», publicar y el email recortado", () => {
    expect(buildGenerateManyInput("t1", { tag: "cohorte" }, state({ emailOn: true, email: { subject: " Tu certificado ", body: " Acá " } }))).toEqual({
      templateId: "t1",
      audienceParams: "tag=cohorte",
      skipExisting: true,
      publish: true,
      email: { subject: "Tu certificado", body: "Acá" },
    });
    expect(buildGenerateManyInput("t1", {}, state({ skipExisting: false, publish: false })).email).toBeNull();
  });

  it("el máximo por tanda es el del job (500)", () => {
    expect(MAX_PER_BATCH).toBe(500);
  });
});
