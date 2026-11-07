import { describe, expect, it } from "vitest";
import { interpolateVariables } from "@/lib/flow-engine/interpolate";
import {
  designGenerateDefaults,
  designGenerateOutputs,
  designGenerateProblem,
  hasDesignStepBefore,
  isDesignGenerateNode,
  parseMapping,
  resolveNodeOverrides,
} from "./node-config";

const interpolate = (text: string, vars: Record<string, unknown>) => interpolateVariables(text, vars as never);
const variables = { answer: { nombre: "Ana", apellido: "Pérez", vacia: "" }, contact: { first_name: "Ana" } };

describe("resolveNodeOverrides (F57)", () => {
  it("cada modo da su valor; lo que no resuelve o queda vacío no se pasa", () => {
    expect(
      resolveNodeOverrides(
        {
          plantilla: { mode: "template" },
          disparador: { mode: "variable", path: "answer.nombre" },
          contacto: { mode: "variable", path: "contact.first_name" },
          hoy: { mode: "today" },
          fijo: { mode: "text", text: "  Curso de verano  " },
          combinado: { mode: "combine", text: "{{answer.nombre}} {{answer.apellido}}" },
          medio: { mode: "combine", text: "{{answer.nombre}} {{answer.inexistente}}" },
          vacia: { mode: "variable", path: "answer.vacia" },
          inexistente: { mode: "variable", path: "answer.no_esta" },
          basura: { mode: "inventado" },
          ruta_mala: { mode: "variable", path: "answer nombre" },
        },
        { variables, today: "7 de noviembre de 2026", interpolate },
      ),
    ).toEqual({
      disparador: "Ana",
      contacto: "Ana",
      hoy: "7 de noviembre de 2026",
      fijo: "Curso de verano",
      combinado: "Ana Pérez",
      medio: "Ana",
    });
  });

  it("sin asignaciones no pasa nada", () => {
    expect(resolveNodeOverrides(undefined, { variables, today: "x", interpolate })).toEqual({});
  });

  it("parseMapping descarta lo que no es una asignación", () => {
    expect(parseMapping(null)).toBeNull();
    expect(parseMapping({ mode: "text" })).toBeNull();
    expect(parseMapping({ mode: "variable", path: "" })).toBeNull();
    expect(parseMapping({ mode: "today", extra: 1 })).toEqual({ mode: "today" });
  });
});

describe("la configuración del paso", () => {
  it("por defecto: «No generar y avisarme», publicar y esperar el PDF", () => {
    expect(designGenerateDefaults({})).toEqual({ missingPolicy: "fail", publish: true, waitForPdf: true });
    expect(designGenerateDefaults({ missingPolicy: "empty", publish: false, waitForPdf: false })).toEqual({ missingPolicy: "empty", publish: false, waitForPdf: false });
    expect(designGenerateDefaults({ missingPolicy: "otra" as never })).toMatchObject({ missingPolicy: "fail" });
  });

  it("sin plantilla no se publica", () => {
    expect(designGenerateProblem({})).toBe("Elegí la plantilla del paso «Generar desde plantilla».");
    expect(designGenerateProblem({ templateId: "  " })).not.toBeNull();
    expect(designGenerateProblem({ templateId: "tpl-1" })).toBeNull();
  });

  it("las seis salidas (F58), con su rótulo", () => {
    expect(designGenerateOutputs().map((o) => [o.path, o.label])).toEqual([
      ["design.id", "Diseño generado: id"],
      ["design.link", "Diseño generado: link"],
      ["design.pdf_url", "Diseño generado: link del PDF"],
      ["design.code", "Diseño generado: código"],
      ["design.status", "Diseño generado: estado"],
      ["design.doc_type", "Diseño generado: tipo de documento"],
    ]);
  });

  it("reconoce el paso guardado con su tipo o como acción", () => {
    expect(isDesignGenerateNode({ type: "designGenerate" })).toBe(true);
    expect(isDesignGenerateNode({ type: "action", data: { actionType: "designGenerate" } })).toBe(true);
    expect(isDesignGenerateNode({ type: "action", data: { actionType: "send_email" } })).toBe(false);
  });

  it("hasDesignStepBefore: solo si hay un «Generar desde plantilla» ANTES del paso", () => {
    const nodes = [
      { id: "t", type: "trigger" },
      { id: "g", type: "action", data: { actionType: "designGenerate" } },
      { id: "e", type: "action", data: { actionType: "send_email" } },
      { id: "e0", type: "action", data: { actionType: "send_email" } },
    ];
    const edges = [
      { source: "t", target: "e0" },
      { source: "e0", target: "g" },
      { source: "g", target: "e" },
    ];
    expect(hasDesignStepBefore("e", nodes, edges)).toBe(true);
    expect(hasDesignStepBefore("e0", nodes, edges)).toBe(false);
  });
});
