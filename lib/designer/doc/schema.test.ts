import { describe, expect, it } from "vitest";
import cases from "./doc.cases.json";
import { docVariables, emptyDoc, migrateDesignDoc, newId, parseDesignDoc, variableProblems, variablesIn } from "./schema";

describe("DesignDoc (casos compartidos con validate_design_doc)", () => {
  it("hay al menos 20 casos, válidos e inválidos", () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
    expect(cases.some((c) => c.valid)).toBe(true);
    expect(cases.some((c) => !c.valid)).toBe(true);
  });

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const result = parseDesignDoc(c.doc);
    expect(result.ok).toBe(c.valid);
    if (!result.ok) {
      expect(result.problems.length).toBeGreaterThan(0);
      for (const problem of result.problems) expect(problem).toMatch(/[a-záéíóúñ]/i);
    }
  });

  it("lo que la base acepta incluye todo lo que acepta Zod (la base es la gemela mínima)", () => {
    for (const c of cases) if (c.valid) expect(c.sql, c.name).toBe(true);
  });

  it("los problemas dicen en qué página y en qué elemento están", () => {
    const doc = structuredClone(cases.find((c) => c.name === "color inválido")!.doc);
    const result = parseDesignDoc(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]).toMatch(/^Página 1 › elemento 1: /);
  });
});

describe("variables en un texto", () => {
  it("encuentra las claves en orden y sin repetir", () => {
    expect(variablesIn("{{contact.first_name}} y {{design.code}} y {{contact.first_name}}")).toEqual(["contact.first_name", "design.code"]);
  });
  it("marca la mal escrita, la vacía y la que no cierra", () => {
    expect(variableProblems("{{Nombre}}")).toHaveLength(1);
    expect(variableProblems("{{}}")).toHaveLength(1);
    expect(variableProblems("hola {{contact.first_name")).toHaveLength(1);
    expect(variableProblems("hola }} chau")).toHaveLength(1);
    expect(variableProblems("todo bien {{nombre_en_el_certificado}}")).toEqual([]);
  });
});

describe("helpers", () => {
  it("un documento sin `v` se trata como la versión 1", () => {
    expect(migrateDesignDoc({ format: "sq", pages: [] })).toMatchObject({ v: 1 });
  });
  it("los ids nuevos respetan el formato", () => {
    expect(newId("pg")).toMatch(/^pg_[a-z0-9]{8}$/);
    expect(newId("el")).toMatch(/^el_[a-z0-9]{8}$/);
  });
  it("el documento vacío es válido", () => {
    expect(parseDesignDoc(emptyDoc("story")).ok).toBe(true);
  });
  it("docVariables junta las de todos los textos", () => {
    const doc = emptyDoc("carta_h");
    doc.pages[0].elements.push({
      id: "el_aaaa01",
      type: "text",
      x: 50,
      y: 50,
      w: 80,
      text: "{{contact.display_name}} · {{design.code}}",
      font: { family: "Inter", weight: 400 },
      size: 30,
      align: "center",
      color: "#000000",
    });
    expect(docVariables(doc)).toEqual(["contact.display_name", "design.code"]);
  });
});
