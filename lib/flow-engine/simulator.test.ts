import { describe, it, expect } from "vitest";
import type { Node, Edge } from "@xyflow/react";
import { simulateFlow } from "./simulator";
import type { BranchPath } from "./condition-eval";

const paths: BranchPath[] = [
  { id: "p_alta01", label: "Alta", logic: "and", conditions: [{ field: "answer.facturacion", operator: "is", value: "Alta", valueType: "single_select" }] },
  { id: "p_vip001", label: "VIP", logic: "and", conditions: [{ field: "contact.tags", operator: "includes", value: "vip", valueType: "multi_select" }] },
];

const nodes = [
  { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { triggerType: "default" } },
  { id: "b", type: "branch", position: { x: 0, y: 0 }, data: { label: "Segun", paths } },
  { id: "a", type: "sendMessage", position: { x: 0, y: 0 }, data: { messages: [{ text: "alta" }] } },
  { id: "v", type: "sendMessage", position: { x: 0, y: 0 }, data: { messages: [{ text: "vip" }] } },
  { id: "e", type: "sendMessage", position: { x: 0, y: 0 }, data: { messages: [{ text: "resto" }] } },
] as Node[];

const edges = [
  { id: "1", source: "t", target: "b" },
  { id: "2", source: "b", target: "a", sourceHandle: "p_alta01" },
  { id: "3", source: "b", target: "v", sourceHandle: "p_vip001" },
  { id: "4", source: "b", target: "e", sourceHandle: "else" },
] as Edge[];

const texts = (result: ReturnType<typeof simulateFlow>) => result.steps.flatMap((s) => (s.result.type === "message" ? s.result.texts : []));

describe("el simulador y el nodo branch", () => {
  it("va por el primer camino que se cumple con los valores de prueba", () => {
    const result = simulateFlow(nodes, edges, { incomingMessage: "hola", mockValues: { "answer.facturacion": "Alta" }, mockContact: { tags: ["vip"] } });
    expect(texts(result)).toEqual(["alta"]);
    const branch = result.steps.find((s) => s.nodeType === "branch")!;
    expect(branch.result).toMatchObject({ type: "branch", pathId: "p_alta01", pathLabel: "Alta" });
  });

  it("usa el contacto de prueba (tags) cuando no hay valor para el campo", () => {
    expect(texts(simulateFlow(nodes, edges, { incomingMessage: "hola", mockContact: { tags: ["vip"] } }))).toEqual(["vip"]);
  });

  it("sin datos en la prueba: «Si no»", () => {
    const result = simulateFlow(nodes, edges, { incomingMessage: "hola" });
    expect(texts(result)).toEqual(["resto"]);
    expect(result.steps.find((s) => s.nodeType === "branch")!.result).toMatchObject({ pathId: "else", pathLabel: "Si no" });
  });

  it("si «Si no» no tiene pasos, termina (no se va por otra salida, como el motor)", () => {
    const sinElse = edges.filter((e) => e.id !== "4");
    const result = simulateFlow(nodes, sinElse, { incomingMessage: "hola" });
    expect(texts(result)).toEqual([]);
    expect(result.steps[result.steps.length - 1].result.type).toBe("flow_end");
    expect(result.completed).toBe(true);
  });

  it("los checks no llevan valores", () => {
    const result = simulateFlow(nodes, edges, { incomingMessage: "hola", mockValues: { "answer.facturacion": "Alta" } });
    const raw = JSON.stringify(result.steps.find((s) => s.nodeType === "branch")!.result);
    expect(raw).not.toContain('"value"');
  });
});
