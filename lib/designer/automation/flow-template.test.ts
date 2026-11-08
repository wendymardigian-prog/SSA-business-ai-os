import { describe, expect, it } from "vitest";
import { triggerProblems } from "@/lib/flow-engine/publish-rules";
import { configProblems } from "@/lib/flow-engine/node-requirements";
import { emailAttachmentProblems, parseEmailAttachments } from "@/lib/email/attachment-limits";
import { designFlowFormProblem, designFlowName, designFlowTemplate, FORM_NOT_CHOSEN_PROBLEM } from "./flow-template";

const template = { id: "11111111-1111-4111-8111-111111111111", name: "Constancia del curso", docNoun: "constancia" };

function problemsOf(graph: ReturnType<typeof designFlowTemplate>): string[] {
  return [...triggerProblems(graph.nodes, graph.edges), ...emailAttachmentProblems(graph.nodes), ...configProblems(graph.nodes, graph.edges)];
}

describe("«Automatizar» desde una plantilla (F60)", () => {
  it("el borrador pasa la validación del registro salvo el formulario", () => {
    expect(problemsOf(designFlowTemplate(template))).toEqual([FORM_NOT_CHOSEN_PROBLEM]);
  });

  it("con el formulario elegido, no queda ningún problema", () => {
    const graph = designFlowTemplate(template);
    graph.nodes[0].data.form_ids = ["22222222-2222-4222-8222-222222222222"];
    expect(problemsOf(graph)).toEqual([]);
  });

  it("arma disparador → generar → email con el link y el PDF adjunto", () => {
    const graph = designFlowTemplate(template);
    expect(graph.nodes.map((n) => [n.id, n.data.triggerType ?? n.data.actionType])).toEqual([
      ["trigger", "form_submitted"],
      ["step-1", "designGenerate"],
      ["step-2", "send_email"],
    ]);
    expect(graph.nodes[1].data).toMatchObject({ templateId: template.id, templateName: "Constancia del curso", missingPolicy: "fail", publish: true, waitForPdf: true });
    expect(graph.nodes[2].data.subject).toBe("Tu constancia");
    expect(String(graph.nodes[2].data.body)).toContain("{{design.link}}");
    expect(parseEmailAttachments(graph.nodes[2].data.attachments)).toEqual([{ kind: "design", from: "design" }]);
    expect(graph.edges.map((e) => `${e.source}>${e.target}`)).toEqual(["trigger>step-1", "step-1>step-2"]);
  });

  it("sin tipo de documento, habla de «diseño»", () => {
    expect(designFlowTemplate({ ...template, docNoun: null }).nodes[2].data.subject).toBe("Tu diseño");
    expect(designFlowName("  Constancia del curso ")).toBe("Generar «Constancia del curso»");
  });

  it("el freno del formulario solo mira flujos que generan diseños", () => {
    const trigger = { type: "trigger", data: { triggerType: "form_submitted", form_ids: [] } };
    expect(designFlowFormProblem([trigger, { type: "action", data: { actionType: "send_email" } }])).toBeNull();
    expect(designFlowFormProblem([trigger, { type: "designGenerate", data: {} }])).toBe(FORM_NOT_CHOSEN_PROBLEM);
    expect(designFlowFormProblem([{ type: "trigger", data: { triggerType: "keyword" } }, { type: "designGenerate", data: {} }])).toBeNull();
    expect(designFlowFormProblem([{ type: "trigger", data: { triggerType: "survey_answered", config: { form_ids: ["x"] } } }, { type: "designGenerate", data: {} }])).toBeNull();
  });
});
