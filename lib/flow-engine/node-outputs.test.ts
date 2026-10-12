import { describe, it, expect } from "vitest";
import { nodeOutputs, canonicalNodeType, nodeTypesWithOutputs } from "./node-outputs";
import { listNodes } from "./registry";

describe("nodeOutputs", () => {
  it("httpRequest aporta la variable donde guarda la respuesta", () => {
    const out = nodeOutputs({ type: "action", data: { actionType: "httpRequest", responseVariable: "crm" } });
    expect(out).toEqual([{ path: "variable:crm", label: "Respuesta de la llamada HTTP (crm)", type: "text", group: "De pasos anteriores" }]);
  });
  it("httpRequest sin variable elegida no aporta nada", () => {
    expect(nodeOutputs({ type: "action", data: { actionType: "httpRequest" } })).toEqual([]);
    expect(nodeOutputs({ type: "action", data: { actionType: "httpRequest", responseVariable: "  " } })).toEqual([]);
  });
  it("aiResponse siempre guarda {{ai_response}}", () => {
    expect(nodeOutputs({ type: "aiResponse", data: { sendDirectly: false } }).map((s) => s.path)).toEqual(["variable:ai_response"]);
    expect(nodeOutputs({ type: "aiResponse" }).map((s) => s.path)).toEqual(["variable:ai_response"]);
  });
  it("los demas nodos no aportan nada", () => {
    for (const node of [{ type: "sendMessage", data: {} }, { type: "delay", data: {} }, { type: "action", data: { actionType: "addTag" } }, { type: "trigger" }]) {
      expect(nodeOutputs(node)).toEqual([]);
    }
  });
  it("canonicalNodeType: un nodo de accion se reconoce por su actionType", () => {
    expect(canonicalNodeType({ type: "action", data: { actionType: "httpRequest" } })).toBe("httpRequest");
    expect(canonicalNodeType({ type: "aiResponse" })).toBe("aiResponse");
    expect(canonicalNodeType({ type: "action", data: {} })).toBe("action");
  });
});

describe("node-outputs y el registro dicen lo mismo", () => {
  it("un nodo declara `outputs` en el registro si y solo si node-outputs lo conoce, y dan lo mismo", () => {
    const declared = listNodes().filter((n) => typeof n.outputs === "function").map((n) => n.type).sort();
    expect(declared).toEqual(nodeTypesWithOutputs().sort());
    const http = listNodes().find((n) => n.type === "httpRequest")!;
    const data = { method: "GET", url: "x", responseVariable: "crm" };
    expect((http.outputs as (d: unknown) => unknown)(data)).toEqual(nodeOutputs({ type: "httpRequest", data }));
  });
});
