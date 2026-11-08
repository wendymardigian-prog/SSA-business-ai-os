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

describe("mappingRows (las filas del panel)", () => {
  it("las propias primero; las automáticas no aparecen; sin repetidas", async () => {
    const { mappingRows } = await import("./node-config");
    const info = (key: string) => ({ label: key === "contact.first_name" ? "Nombre" : key, group: key.startsWith("contact.") ? "Contacto" : "Desconocida" });
    expect(
      mappingRows(
        ["contact.first_name", "nombre_en_el_certificado", "design.code", "design.issued_on", "curso", "contact.first_name"],
        [
          { key: "nombre_en_el_certificado", label: "Nombre en el certificado" },
          { key: "curso", label: "Curso", default: "Curso general" },
        ],
        info,
      ),
    ).toEqual([
      { key: "nombre_en_el_certificado", label: "Nombre en el certificado", group: "Propias", required: true },
      { key: "curso", label: "Curso", group: "Propias", required: false },
      { key: "contact.first_name", label: "Nombre", group: "Contacto", required: false },
    ]);
  });
});

describe("el selector de cada variable", () => {
  it("agrupa lo que ofrece el lienzo: disparador, pasos anteriores, contacto y negocio", async () => {
    const { groupVariableOptions } = await import("./node-config");
    expect(groupVariableOptions(["answer.nombre", "form.name", "design.link", "ai_response", "respuesta_crm", "contact.first_name", "workspace.name"])).toEqual([
      { label: "Del disparador", vars: ["answer.nombre", "form.name"] },
      { label: "De pasos anteriores", vars: ["design.link", "ai_response", "respuesta_crm"] },
      { label: "Contacto", vars: ["contact.first_name"] },
      { label: "Negocio", vars: ["workspace.name"] },
    ]);
    expect(groupVariableOptions([])).toEqual([]);
  });

  it("ida y vuelta entre la asignación y el valor del selector", async () => {
    const { mappingToSelect, selectToMapping } = await import("./node-config");
    expect(mappingToSelect(undefined)).toBe("template");
    expect(mappingToSelect({ mode: "variable", path: "answer.nombre" })).toBe("var:answer.nombre");
    expect(mappingToSelect({ mode: "combine", text: "x" })).toBe("combine");
    expect(selectToMapping("var:answer.nombre", undefined)).toEqual({ mode: "variable", path: "answer.nombre" });
    expect(selectToMapping("combine", { mode: "text", text: "Hola" })).toEqual({ mode: "combine", text: "Hola" });
    expect(selectToMapping("today", { mode: "text", text: "Hola" })).toEqual({ mode: "today" });
    expect(selectToMapping("var:", undefined)).toEqual({ mode: "template" });
    expect(selectToMapping("otra", undefined)).toEqual({ mode: "template" });
  });
});

describe("variableOptionLabel (las variables del disparador con sus rótulos, F57)", () => {
  it("el rótulo del disparador primero, después los conocidos, y la ruta aparte", async () => {
    const { variableOptionLabel } = await import("./node-config");
    expect(variableOptionLabel("answer.nombre_certificado", { "answer.nombre_certificado": "¿Cómo querés que aparezca tu nombre?" })).toBe("¿Cómo querés que aparezca tu nombre? · answer.nombre_certificado");
    expect(variableOptionLabel("contact.first_name")).toBe("Nombre · contact.first_name");
    expect(variableOptionLabel("design.link")).toBe("Diseño generado: link · design.link");
    expect(variableOptionLabel("respuesta_crm")).toBe("respuesta_crm");
  });
});
