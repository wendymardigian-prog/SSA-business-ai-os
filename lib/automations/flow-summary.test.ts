import { describe, it, expect } from "vitest";
import { CANVAS_SUMMARY, summarizeFlow } from "./flow-summary";
import { formTemplateGraph } from "@/lib/forms/automation/templates";
import { FLOW_TEMPLATES, templateGraph } from "@/lib/scheduling/automation/templates";

const form = { id: "11111111-1111-4111-8111-111111111111", name: "Aplicación", type: "custom" as const };
const base = { form, userEmail: "yo@ejemplo.com" };

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data });
const edge = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${target}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) });

describe("el resumen de un flujo", () => {
  it("una plantilla lineal: «Cuando se envía · 1 email»", () => {
    const g = formTemplateGraph("notify_me_email", base);
    expect(summarizeFlow(g.nodes, g.edges)).toBe("Cuando se envía · 1 email");
  });

  it("email + mensaje", () => {
    const g = formTemplateGraph("thank_you_message", base);
    expect(summarizeFlow(g.nodes, g.edges)).toBe("Cuando se envía · 1 email · 1 mensaje");
  });

  it("una encuesta dice «Cuando se responde»", () => {
    const g = formTemplateGraph("detractor_alert", { ...base, form: { ...form, type: "survey" } });
    expect(summarizeFlow(g.nodes, g.edges)).toBe("Cuando se responde · 1 email");
  });

  it("un flujo sin pasos dice que no tiene pasos", () => {
    expect(summarizeFlow([node("trigger", "trigger", { triggerType: "form_submitted" })], [])).toBe("Cuando se envía · sin pasos");
  });

  it("con Condiciones cuenta los caminos y «si no»", () => {
    const nodes = [
      node("trigger", "trigger", { triggerType: "form_submitted" }),
      node("b", "branch", { paths: [{ id: "p_aaaaaa", label: "A", logic: "and", conditions: [] }, { id: "p_bbbbbb", label: "B", logic: "and", conditions: [] }, { id: "p_cccccc", label: "C", logic: "and", conditions: [] }] }),
      node("e1", "action", { actionType: "send_email" }),
      node("e2", "action", { actionType: "send_email" }),
    ];
    const edges = [edge("trigger", "b"), edge("b", "e1", "p_aaaaaa"), edge("b", "e2", "else")];
    expect(summarizeFlow(nodes, edges)).toBe("Cuando se envía · 3 caminos + si no · 2 emails");
  });

  describe("«Armado en el canvas»", () => {
    it("un A/B", () => {
      const nodes = [node("trigger", "trigger"), node("s", "split"), node("a", "action"), node("b", "action")];
      expect(summarizeFlow(nodes, [edge("trigger", "s"), edge("s", "a", "A"), edge("s", "b", "B")])).toBe(CANVAS_SUMMARY);
    });
    it("caminos que se vuelven a juntar", () => {
      const nodes = [node("trigger", "trigger"), node("x", "action"), node("y", "action"), node("z", "action")];
      expect(summarizeFlow(nodes, [edge("trigger", "x"), edge("trigger", "y"), edge("x", "z"), edge("y", "z")])).toBe(CANVAS_SUMMARY);
    });
    it("sin disparador", () => {
      expect(summarizeFlow([node("a", "action")], [])).toBe(CANVAS_SUMMARY);
    });
    it("datos que no son un grafo (la base devolvio otra cosa)", () => {
      expect(summarizeFlow(null, undefined)).toBe(CANVAS_SUMMARY);
      expect(summarizeFlow("x", { a: 1 })).toBe(CANVAS_SUMMARY);
      expect(summarizeFlow([null, 3], [{}])).toBe(CANVAS_SUMMARY);
    });
  });

  it("las plantillas de la Agenda también se resumen (comparten el modelo)", () => {
    for (const template of FLOW_TEMPLATES) {
      const g = templateGraph(template, "e1");
      expect(summarizeFlow(g.nodes, g.edges), template.key).not.toBe(CANVAS_SUMMARY);
    }
  });
});
