import { describe, expect, it } from "vitest";
import type { MeasuredPage } from "../render-client";
import { findStyle } from "../styles";
import type { DesignDoc } from "../doc/schema";
import { countWords, fixOverlays, issuePages, qaIssues, qaMessage, qaProblemsForPrompt, qaWarnings, unmixOverlay } from "./qa";
import { carousel, page, textEl } from "./test-fixtures";
import { runQaLoop } from "./qa-loop";
import { MAX_CORRECTION_PASSES } from "./qa";

const style = findStyle("social");
const words = (n: number) => Array.from({ length: n }, (_, i) => `palabra${i}`).join(" ");

/** Una medición de muestra: una caja por elemento, al medio, sin desborde y con fondo oscuro. */
function measure(doc: DesignDoc, over: Record<string, Partial<MeasuredPage["elements"][number]>> = {}): MeasuredPage[] {
  return doc.pages.map((p, pageIdx) => ({
    page: pageIdx,
    elements: p.elements.map((e) => ({ id: e.id, x: 200, y: 400, w: 600, h: 120, overflow: false, bgLuminance: 0.02, ...over[e.id] })),
  }));
}

describe("ai/qa: los 5 problemas", () => {
  it("un documento sano no tiene problemas (con y sin medición)", () => {
    const doc = carousel();
    expect(qaIssues(measure(doc), doc, "v45", style)).toEqual([]);
    expect(qaIssues(null, doc, "v45", style)).toEqual([]);
  });

  it("1. detecta un texto desbordado", () => {
    const doc = carousel();
    const issues = qaIssues(measure(doc, { el_title01: { overflow: true } }), doc, "v45", style);
    expect(issues).toEqual([expect.objectContaining({ kind: "overflow", page: 0, elementId: "el_title01" })]);
  });

  it("2. detecta poco contraste con la luminancia medida del fondo", () => {
    const doc = carousel();
    const issues = qaIssues(measure(doc, { el_body001: { bgLuminance: 0.85 } }), doc, "v45", style);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "contrast", page: 1, elementId: "el_body001" });
    expect(issues[0].detail).toMatch(/1,\d:1 \(mínimo 3:1\)|1,\d:1 \(mínimo 4,5:1\)/);
  });

  it("2. un título grande necesita 3:1; el cuerpo, 4,5:1", () => {
    const doc = carousel();
    // Texto blanco sobre un gris medio (luminancia 0.3): ratio 1.05/0.35 = 3.0 → alcanza para título (64 px = 3:1)... y no para cuerpo.
    const title = qaIssues(measure(doc, { el_title01: { bgLuminance: 0.3 } }), doc, "v45", style);
    expect(title.filter((i) => i.kind === "contrast")).toHaveLength(0);
    const small = carousel();
    (small.pages[0].elements[0] as { size: number }).size = 40;
    const body = qaIssues(measure(small, { el_title01: { bgLuminance: 0.3 } }), small, "v45", style);
    expect(body.filter((i) => i.kind === "contrast")).toHaveLength(1);
  });

  it("3. detecta un texto fuera de la zona segura (medido)", () => {
    const doc = carousel();
    const issues = qaIssues(measure(doc, { el_cta0001: { x: 1000, w: 200 } }), doc, "v45", style);
    expect(issues).toEqual([expect.objectContaining({ kind: "safe_zone", page: 2, elementId: "el_cta0001" })]);
  });

  it("3. sin medición estima la zona segura con el documento", () => {
    const doc = carousel();
    doc.pages[1].elements[0] = { ...doc.pages[1].elements[0], x: 97, w: 20 } as never;
    const issues = qaIssues(null, doc, "v45", style);
    expect(issues.map((i) => i.kind)).toEqual(["safe_zone"]);
  });

  it("3. en una historia las zonas de arriba y abajo son más grandes", () => {
    const doc = carousel("story");
    doc.pages[0].elements[0] = { ...doc.pages[0].elements[0], y: 5 } as never;
    expect(qaIssues(null, doc, "story", style).map((i) => i.kind)).toContain("safe_zone");
    const ok = carousel("story");
    expect(qaIssues(null, ok, "story", style).filter((i) => i.kind === "safe_zone")).toEqual([]);
  });

  it("4. detecta letras por debajo del mínimo del formato", () => {
    const doc = carousel("story");
    (doc.pages[0].elements[1] as { size: number }).size = 30;
    expect(qaIssues(null, doc, "story", style)).toEqual([expect.objectContaining({ kind: "font_size", page: 0, elementId: "el_sub0001", detail: "30 px (mínimo 40)" })]);
  });

  it("4. una numeración «N/M» chica no cuenta como letras ni como palabras", () => {
    const doc = carousel();
    doc.pages[0].elements.push(textEl("el_num00001", "1/3", { size: 20, y: 94, x: 90, w: 10 }));
    expect(qaIssues(null, doc, "v45", style).filter((i) => i.kind === "font_size" || i.kind === "words")).toEqual([]);
  });

  it("5. detecta demasiadas palabras por página según la densidad del estilo", () => {
    const doc: DesignDoc = { v: 1, format: "v45", pages: [page("pg_dense001", [textEl("el_dense001", words(40), { size: 40, w: 90 })])] };
    const issues = qaIssues(null, doc, "v45", style);
    expect(issues).toContainEqual(expect.objectContaining({ kind: "words", page: 0, detail: "40 de máximo 25" }));
    // Con el estilo Minimal (18) el mismo texto de 20 palabras ya se pasa; con Editorial (35), no.
    const doc20: DesignDoc = { v: 1, format: "v45", pages: [page("pg_dense001", [textEl("el_dense001", words(20), { size: 40, w: 90 })])] };
    expect(qaIssues(null, doc20, "v45", findStyle("minimal")).map((i) => i.kind)).toContain("words");
    expect(qaIssues(null, doc20, "v45", findStyle("editorial")).map((i) => i.kind)).not.toContain("words");
  });

  it("cada variable cuenta como una palabra", () => {
    expect(countWords("Hola {{contact.display_name}}, bienvenida")).toBe(3);
    expect(countWords("— · 1/3")).toBe(1);
  });

  it("un elemento oculto no cuenta", () => {
    const doc = carousel();
    (doc.pages[0].elements[0] as { hidden?: boolean; size: number }).hidden = true;
    (doc.pages[0].elements[0] as { size: number }).size = 10;
    expect(qaIssues(null, doc, "v45", style)).toEqual([]);
  });
});

describe("ai/qa: avisos para la persona", () => {
  it("el aviso de contraste sobre una foto dice «subí la capa de color»", () => {
    const doc = carousel();
    doc.pages[3 - 1].background = { type: "image", image: { asset: "x/y.png", fit: "cover", focal: { x: 50, y: 50 }, locked: false } };
    const issue = { kind: "contrast" as const, page: 2, detail: "1,2:1 (mínimo 4,5:1)" };
    expect(qaMessage(issue, doc)).toBe("La página 3 tiene poco contraste: subí la capa de color.");
    expect(qaMessage({ ...issue, page: 0 }, doc)).toMatch(/cambiá el color del texto o del fondo/);
  });

  it("junta un aviso por tipo y página, y la lista para la IA lleva los id", () => {
    const issues = [
      { kind: "overflow" as const, page: 0, elementId: "el_a", detail: "x" },
      { kind: "overflow" as const, page: 0, elementId: "el_b", detail: "x" },
      { kind: "words" as const, page: 1, detail: "30 de máximo 25" },
    ];
    expect(qaWarnings(issues)).toHaveLength(2);
    expect(qaProblemsForPrompt(issues)[0]).toMatch(/Página 1 \(index 0\), elemento el_a/);
    expect(issuePages(issues)).toEqual([0, 1]);
  });

  it("con muchos problemas recorta la lista y avisa cuántos faltan", () => {
    const issues = Array.from({ length: 12 }, (_, i) => ({ kind: "words" as const, page: i, detail: "x" }));
    const out = qaWarnings(issues, undefined, 5);
    expect(out).toHaveLength(6);
    expect(out[5]).toMatch(/Y 7 avisos más/);
  });
});

describe("ai/qa: corregir el contraste con la capa de color, sin llamar a la IA", () => {
  const withPhoto = (overlay?: { color: string; opacity: number }): DesignDoc => {
    const doc = carousel();
    doc.pages[0].background = { type: "image", image: { asset: "ws/img.png", fit: "cover", focal: { x: 50, y: 50 }, locked: false }, ...(overlay ? { overlay } : {}) };
    return doc;
  };

  it("sube la opacidad hasta que alcanza el contraste", () => {
    const doc = withPhoto();
    const m = measure(doc, { el_title01: { bgLuminance: 0.7 }, el_sub0001: { bgLuminance: 0.7 } });
    const issues = qaIssues(m, doc, "v45", style);
    const fixed = fixOverlays(doc, issues, m, "v45");
    expect(fixed.fixedPages).toEqual([0]);
    const overlay = fixed.doc.pages[0].background.overlay;
    expect(overlay?.color).toBe("#0f1115");
    expect(overlay?.opacity).toBeGreaterThan(0.5);
    expect(overlay?.opacity).toBeLessThanOrEqual(0.9);
    // El original no cambia.
    expect(doc.pages[0].background.overlay).toBeUndefined();
  });

  it("parte de la foto sin la capa que ya tenía", () => {
    const lum = unmixOverlay(0.55, "#0f1115", 0.5);
    expect(lum).toBeGreaterThan(0.55);
    expect(unmixOverlay(0.3, "#0f1115", 0.99)).toBe(0.3);
  });

  it("no toca una página sin foto ni una que ya está bien", () => {
    const doc = carousel();
    const m = measure(doc, { el_body001: { bgLuminance: 0.85 } });
    expect(fixOverlays(doc, qaIssues(m, doc, "v45", style), m, "v45").fixedPages).toEqual([]);
  });

  it("con letras oscuras usa una capa clara", () => {
    const doc = withPhoto();
    for (const el of doc.pages[0].elements) (el as { color: string }).color = "#111111";
    const m = measure(doc, { el_title01: { bgLuminance: 0.1 }, el_sub0001: { bgLuminance: 0.1 } });
    const fixed = fixOverlays(doc, qaIssues(m, doc, "v45", style), m, "v45");
    expect(fixed.doc.pages[0].background.overlay?.color).toBe("#ffffff");
  });
});

describe("ai/qa: el ciclo nunca pasa de 2 pasadas de corrección", () => {
  const sameProblem = (doc: DesignDoc): MeasuredPage[] => measure(doc, { el_title01: { overflow: true } });

  it("con un proveedor simulado que siempre devuelve el mismo problema, corrige 2 veces y se detiene", async () => {
    let corrections = 0;
    let measures = 0;
    const result = await runQaLoop(carousel(), {
      format: "v45",
      style,
      measure: async (doc) => {
        measures++;
        return { status: "ok", measure: sameProblem(doc), images: [] };
      },
      correct: async ({ doc }) => {
        corrections++;
        return { ok: true, doc };
      },
    });
    expect(MAX_CORRECTION_PASSES).toBe(2);
    expect(corrections).toBe(2);
    expect(result.corrections).toBe(2);
    expect(measures).toBe(3); // mide al principio y después de cada corrección
    expect(result.issues).toHaveLength(1);
  });

  it("si no hay problemas, no corrige ni una vez", async () => {
    let corrections = 0;
    const result = await runQaLoop(carousel(), { format: "v45", style, measure: async (doc) => ({ status: "ok", measure: measure(doc), images: [] }), correct: async ({ doc }) => ((corrections++, { ok: true, doc })) });
    expect(corrections).toBe(0);
    expect(result.issues).toEqual([]);
  });

  it("si la corrección no cambia nada, corta sin repetir", async () => {
    let corrections = 0;
    const result = await runQaLoop(carousel(), { format: "v45", style, measure: async (doc) => ({ status: "ok", measure: sameProblem(doc), images: [] }), correct: async () => ((corrections++, { ok: false })) });
    expect(corrections).toBe(1);
    expect(result.unchecked.join(" ")).toMatch(/No pude hacer la corrección/);
  });

  it("sin servicio de render hace solo los chequeos que no lo necesitan y avisa por qué", async () => {
    const doc = carousel("story");
    (doc.pages[0].elements[1] as { size: number }).size = 30;
    const result = await runQaLoop(doc, { format: "story", style, measure: null, correct: async () => ({ ok: false }) });
    expect(result.issues.map((i) => i.kind)).toEqual(["font_size"]);
    expect(result.unchecked.join(" ")).toMatch(/falta conectar el servicio de render/);
  });

  it("con el render simulado no avisa nada", async () => {
    const result = await runQaLoop(carousel(), { format: "v45", style, measure: async () => ({ status: "unavailable", reason: "fake" }), correct: async () => ({ ok: false }) });
    expect(result.unchecked).toEqual([]);
  });
});
