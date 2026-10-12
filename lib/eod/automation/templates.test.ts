import { describe, it, expect } from "vitest";
import "@/lib/flow-engine/registry";
import { memberFlowProblems } from "@/lib/flow-engine/member-flow";
import { flowToTree } from "@/lib/automations/step-tree";
import { prepareTreeSave } from "@/lib/automations/step-tree-save";
import { blankEodFlowGraph, EOD_FLOW_TEMPLATES, eodTemplateGraph } from "./templates";

const ctx = { form: { id: "f-1", name: "EOD" }, userId: "11111111-1111-4111-8111-111111111111", userEmail: "yo@x.com" };

describe("plantillas del EOD", () => {
  it.each(EOD_FLOW_TEMPLATES.map((t) => t.key))("%s: disparador del EOD fijo y ningún paso que necesite contacto", (key) => {
    const graph = eodTemplateGraph(key, ctx);
    const trigger = graph.nodes.find((n) => n.type === "trigger");
    expect(trigger?.data).toMatchObject({ triggerType: "eod_submitted", form_ids: ["f-1"], on: "first" });
    expect(memberFlowProblems(graph.nodes)).toEqual([]);
    // Se puede abrir y volver a guardar desde el editor de pasos del EOD.
    const tree = flowToTree(graph.nodes, graph.edges);
    expect(tree).not.toBeNull();
    const saved = prepareTreeSave({ screen: "eod", stored: graph, tree: { steps: tree!.steps }, triggerData: trigger!.data as Record<string, unknown> });
    expect(saved.ok, saved.ok ? "" : saved.error).toBe(true);
  });

  it("Alerta por bajo rendimiento: un camino 'links en total < 10' con email a quien envió y aviso a quien la crea, y 'Si no' vacío", () => {
    const tree = flowToTree(...(Object.values(eodTemplateGraph("eod_low_performance", ctx)) as [never, never]));
    const branch = tree!.steps[0];
    expect(branch.kind).toBe("branch");
    if (branch.kind !== "branch") return;
    expect(branch.paths).toHaveLength(1);
    expect(branch.paths[0].conditions[0]).toMatchObject({ field: "metrics.total.links_enviados", operator: "lt", value: "10" });
    expect(branch.paths[0].steps.map((s) => (s.kind === "action" ? s.data.actionType : s.kind))).toEqual(["send_email", "notify_team"]);
    expect(branch.otherwise).toEqual([]);
  });

  it("una nueva automatización arranca solo con el disparador", () => {
    expect(blankEodFlowGraph("f-1").nodes).toHaveLength(1);
  });

  it("guardar un mensaje en un flujo de EOD se rechaza", () => {
    const graph = blankEodFlowGraph("f-1");
    const result = prepareTreeSave({
      screen: "eod",
      stored: graph,
      tree: { steps: [{ kind: "action", id: "m1", nodeType: "sendMessage", data: { messages: [{ text: "hola" }] } }] },
      triggerData: graph.nodes[0].data as Record<string, unknown>,
    });
    expect(result.ok).toBe(false);
  });
});
