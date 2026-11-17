// @plantilla-quitar(proyectos)
import { describe, expect, it } from "vitest";
import { ANALYSIS_DOC_MAX, analysisUserMessage, parseAnalysis } from "./analysis";

describe("parseAnalysis (F236)", () => {
  const ok = { summary: "Buena llamada", criteria: [{ name: "Preguntas abiertas", status: "improve", evidence: "min 12" }], top3: ["Preguntá la limitante"], follow_up: ["¿Cuántos turnos?"] };

  it("lee el JSON aunque venga con texto o un bloque de código alrededor", () => {
    expect(parseAnalysis(JSON.stringify(ok))).toEqual(ok);
    expect(parseAnalysis("Acá va:\n```json\n" + JSON.stringify(ok) + "\n```")).toEqual(ok);
    expect(parseAnalysis(JSON.stringify({ ...ok, follow_up: undefined }))?.follow_up).toEqual([]);
  });

  it("rechaza lo que no cumple el esquema (no se guarda ni se cobra)", () => {
    expect(parseAnalysis("no es json")).toBeNull();
    expect(parseAnalysis(JSON.stringify({ ...ok, criteria: [{ name: "a", status: "bien", evidence: "" }] }))).toBeNull();
    expect(parseAnalysis(JSON.stringify({ ...ok, criteria: [] }))).toBeNull();
    expect(parseAnalysis(JSON.stringify({ ...ok, top3: ["a", "b", "c", "d"] }))).toBeNull();
    expect(parseAnalysis(JSON.stringify({ ...ok, summary: "" }))).toBeNull();
  });

  it("el documento va envuelto como dato y una transcripción muy larga se corta", () => {
    const m = analysisUserMessage("n1", { name: "La llamada", text: "x".repeat(ANALYSIS_DOC_MAX + 5) }, [{ name: "Brief", text: null }]);
    expect(m.truncated).toBe(true);
    expect(m.text).toContain("<<<conocimiento n1>>>");
    expect(m.text).toContain("## Brief\n[Todavía no lo pegó]");
  });
});
