import { describe, expect, it } from "vitest";
import { z } from "zod";
import { aiDocOutputSchema, aiPatchOutputSchema, parseAiDocOutput, parseAiPatch, parseAiPatchOutput } from "./schema";

const text = { type: "text", x: 50, y: 50, w: 80, text: "Hola", font: { family: "Inter", weight: 700 }, size: 60, align: "center", color: "#ffffff" };

describe("ai/schema: el parche y el documento que devuelve la IA", () => {
  it("acepta un parche con las cuatro operaciones", () => {
    const r = parseAiPatch({
      pages: [
        {
          index: 0,
          ops: [
            { op: "add", element: text },
            { op: "update", id: "el_title01", set: { size: 80 } },
            { op: "remove", id: "el_sub0001" },
            { op: "reorder", ids: ["el_title01"] },
          ],
        },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("un elemento nuevo no necesita id (lo pone el servidor)", () => {
    expect(parseAiPatch({ pages: [{ index: 1, ops: [{ op: "add", element: text }] }] }).ok).toBe(true);
  });

  it("rechaza un parche inválido y dice por qué", () => {
    const sinIndex = parseAiPatch({ pages: [{ ops: [] }] });
    expect(sinIndex.ok).toBe(false);
    if (!sinIndex.ok) expect(sinIndex.problems.join(" ")).toMatch(/index/);

    const opRara = parseAiPatch({ pages: [{ index: 0, ops: [{ op: "explotar", id: "x" }] }] });
    expect(opRara.ok).toBe(false);

    const fueraDeRango = parseAiPatch({ pages: [{ index: 0, ops: [{ op: "add", element: { ...text, x: 400 } }] }] });
    expect(fueraDeRango.ok).toBe(false);
    if (!fueraDeRango.ok) expect(fueraDeRango.problems.join(" ")).toMatch(/0 a 100/);
  });

  it("no acepta elementos html: la IA no edita HTML cargado", () => {
    const r = parseAiPatch({ pages: [{ index: 0, ops: [{ op: "add", element: { type: "html", x: 50, y: 50, w: 50, html: "<b>x</b>" } }] }] });
    expect(r.ok).toBe(false);
  });

  it("acepta páginas nuevas y quitar páginas", () => {
    const r = parseAiPatch({
      pages: [],
      newPages: [{ after: 1, page: { background: { type: "color", color: "#000000" }, elements: [text] } }],
      removePages: [2],
    });
    expect(r.ok).toBe(true);
  });

  it("la salida de cambios pide mensaje y parche", () => {
    expect(parseAiPatchOutput({ message: "Listo", patch: { pages: [] } }).ok).toBe(true);
    expect(parseAiPatchOutput({ patch: { pages: [] } }).ok).toBe(false);
  });

  it("la primera versión pide al menos una página y un mensaje", () => {
    const page = { background: { type: "color", color: "#ffffff" }, elements: [text] };
    expect(parseAiDocOutput({ message: "Armé 1 página", doc: { pages: [page] } }).ok).toBe(true);
    expect(parseAiDocOutput({ message: "x", doc: { pages: [] } }).ok).toBe(false);
  });

  it("los dos esquemas se pueden convertir a JSON Schema para el proveedor", () => {
    expect(() => z.toJSONSchema(aiDocOutputSchema)).not.toThrow();
    expect(() => z.toJSONSchema(aiPatchOutputSchema)).not.toThrow();
  });
});
