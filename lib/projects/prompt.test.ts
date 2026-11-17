// @plantilla-quitar(proyectos)
import { describe, expect, it } from "vitest";
import { DOC_MAX_CHARS, MISSING_DOC, buildPrompt, type PromptParts } from "./prompt";

const base: PromptParts = {
  step: { key: "guion", name: "Guion" },
  template: { text: "Armá el guion para {{proyecto}}.\nBrief: {{brief}}\nPresupuesto: {{rango_presupuesto}}", version: 3 },
  project: { kind: "real", title: "Web de Ana", description: "Una web con turnos", client: { company: "Ana SRL", email: "ana@x.com" }, status: "draft", sold_cents: 300000, phases: [{ key: "f1", name: "Diseño", price_cents: 100000 }] },
  fields: { brief: { volcado: "ideas sueltas", tipo: "" } },
  roadmap: { mode: "phase", stages: [{ key: "e1", name: "Etapa 1", phases: [{ key: "f1", name: "Login" }] }] },
  unit: null,
  budget_ranges: [{ size: "small", min_cents: 50000, max_cents: 150000 }],
  documents: [
    { step: "brief", name: "Brief inicial", version: { n: 2, path: "p/brief/2.md" } },
    { step: "investigacion", name: "Investigación", version: null },
  ],
  requirements: null,
};

describe("buildPrompt (F234)", () => {
  it("reemplaza las variables y usa la última versión de cada documento", () => {
    const r = buildPrompt(base, { "p/brief/2.md": "EL BRIEF" });
    expect(r.text).toContain("Armá el guion para Proyecto real: Web de Ana\nUna web con turnos\nCliente: Ana SRL · ana@x.com.");
    expect(r.text).toContain("Brief: EL BRIEF");
    expect(r.text).toContain("Presupuesto: chico: de US$500 a US$1.500");
    expect(r.used).toEqual(["Brief inicial v2"]);
    expect(r.version).toBe(3);
  });

  it("un documento que falta se marca y va al final si las instrucciones no lo nombran", () => {
    const r = buildPrompt(base, { "p/brief/2.md": "EL BRIEF" });
    expect(r.missing).toEqual(["Investigación"]);
    expect(r.text).toContain(`## Investigación\n${MISSING_DOC}`);
  });

  it("un documento referenciado que todavía no se pegó dice que falta", () => {
    expect(buildPrompt(base, {}).text).toContain(`Brief: ${MISSING_DOC}`);
  });

  it("corta un documento muy largo y avisa si el prompt es muy largo", () => {
    const long = "x".repeat(DOC_MAX_CHARS + 10);
    const r = buildPrompt({ ...base, documents: [base.documents[0], { step: "llamada", name: "La llamada", version: { n: 1, path: "p/ll/1.md" } }] }, { "p/brief/2.md": long, "p/ll/1.md": long });
    expect(r.truncated).toEqual(["Brief inicial", "La llamada"]);
    expect(r.tooLong).toBe(true);
  });

  it("datos, montos, parte y modo; una variable desconocida queda como está", () => {
    const r = buildPrompt({ ...base, unit: "f1", template: { text: "{{datos}}|{{montos}}|{{parte}}|{{modo}}|{{otra}}", version: 1 }, documents: [] }, {});
    expect(r.text).toBe("brief.volcado: ideas sueltas|Total: US$3.000\nDiseño: US$1.000|Fase «Login» (etapa «Etapa 1»)|por fase|{{otra}}");
  });
});
