import { describe, it, expect } from "vitest";
import { FORM_FLOW_TEMPLATES, templatesForType, formTemplateGraph, blankFormFlowGraph, nextAutomationName, formFlowName, formTemplateByKey } from "./templates";
import { flowToLinear, linearToFlow } from "@/lib/scheduling/automation/linear-flow";
import { buildDesiredTriggers } from "@/lib/flow-triggers";
import { resolveNodeType } from "@/lib/flow-engine/registry";
import "@/lib/flow-engine/registry";

const form = (type: "custom" | "survey" | "contract" = "custom") => ({ id: "11111111-1111-4111-8111-111111111111", name: "Aplicación", type });
const ctx = (type: "custom" | "survey" | "contract" = "custom") => ({ form: form(type), userEmail: "yo@ejemplo.com", tagName: "calificado" });

describe("plantillas de formulario", () => {
  it("la de detractor solo se ofrece para encuestas", () => {
    expect(templatesForType("custom").map((t) => t.key)).not.toContain("detractor_alert");
    expect(templatesForType("survey").map((t) => t.key)).toContain("detractor_alert");
  });

  it.each(FORM_FLOW_TEMPLATES.map((t) => [t.key] as const))("%s es lineal y vuelve igual", (key) => {
    const type = key === "detractor_alert" ? "survey" : "custom";
    const { nodes, edges } = formTemplateGraph(key, ctx(type));
    const linear = flowToLinear(nodes, edges);
    expect(linear, "tiene que poder verse como lista").not.toBeNull();
    const back = linearToFlow(linear!);
    const again = flowToLinear(back.nodes, back.edges)!;
    expect(again.steps).toEqual(linear!.steps);
    expect(again.trigger.type).toBe(type === "survey" ? "survey_answered" : "form_submitted");
  });

  it("todos los nodos de las plantillas están en el registro (con otro nombre el motor no los corre)", () => {
    for (const t of FORM_FLOW_TEMPLATES) {
      const type = t.key === "detractor_alert" ? "survey" : "custom";
      for (const node of formTemplateGraph(t.key, ctx(type)).nodes) {
        if (node.type === "trigger") continue;
        expect(resolveNodeType(node as never), `${t.key}: ${node.type}`).toBeTruthy();
      }
    }
  });

  it("el trigger se guarda con el formulario y el tipo correctos", () => {
    const { nodes } = formTemplateGraph("notify_me_email", ctx("contract"));
    const rows = buildDesiredTriggers(nodes as never, "flow-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("contract_signed");
    expect(rows[0].config).toEqual({ form_ids: [form().id] });
  });

  it("notify_me_email nace con to: fixed y el email de quien la crea", () => {
    const { nodes } = formTemplateGraph("notify_me_email", ctx());
    expect(nodes.find((n) => n.id === "step-1")?.data).toMatchObject({ actionType: "send_email", to: "fixed", fixedEmail: "yo@ejemplo.com" });
  });

  it("detractor_alert filtra por detractores y avisa por email", () => {
    const { nodes } = formTemplateGraph("detractor_alert", ctx("survey"));
    const rows = buildDesiredTriggers(nodes as never, "flow-1");
    expect(rows[0].type).toBe("survey_answered");
    expect(rows[0].config).toMatchObject({ nps_categories: ["detractor"] });
  });

  it("add_tag lleva el tag elegido", () => {
    expect(formTemplateGraph("add_tag", ctx()).nodes.find((n) => n.id === "step-1")?.data).toMatchObject({ actionType: "addTag", tagName: "calificado" });
  });

  it("la automatización en blanco es solo el trigger del tipo del formulario", () => {
    const graph = blankFormFlowGraph(form("survey"));
    expect(graph.edges).toEqual([]);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].data).toMatchObject({ triggerType: "survey_answered", form_ids: [form().id] });
  });

  it("los nombres no chocan", () => {
    expect(formFlowName("Aplicación", "Algo")).toBe("Aplicación · Algo");
    expect(nextAutomationName("A", [])).toBe("A · Automatización 1");
    expect(nextAutomationName("A", ["A · Automatización 2"])).toBe("A · Automatización 3");
    expect(formTemplateByKey("nada")).toBeUndefined();
  });
});
