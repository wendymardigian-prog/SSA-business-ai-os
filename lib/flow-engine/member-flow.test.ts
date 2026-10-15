import { describe, it, expect } from "vitest";
import "./registry";
import { flowSubject, isNoContactSubject, memberFlowProblems } from "./member-flow";
import { registerTrigger } from "./registry/registry";

// Un disparador de sistema de mentira (todavia no hay uno real): sin contacto ni persona (Tiron 2, D1).
registerTrigger({ type: "test_system_trigger", label: "Sistema (test)", scope: "event", priority: 45, subject: "system", sourceType: "system", eventTypes: ["test_system_event"] });

const trigger = (triggerType: string) => ({ id: "t", type: "trigger", data: { triggerType } });

describe("flujos sin contacto", () => {
  it("el sujeto lo dice el disparador", () => {
    expect(flowSubject([trigger("eod_submitted")])).toBe("member");
    expect(flowSubject([trigger("form_submitted")])).toBe("contact");
    expect(flowSubject([])).toBe("contact");
  });

  it("CUANDO un flujo de EOD tiene 'Enviar mensaje', se rechaza", () => {
    const problems = memberFlowProblems([trigger("eod_submitted"), { id: "m", type: "sendMessage", data: { messages: [{ text: "hola" }] } }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/necesita un contacto/);
  });

  it("email, esperar, condiciones, HTTP y el aviso sirven", () => {
    expect(
      memberFlowProblems([
        trigger("eod_submitted"),
        { id: "a", type: "action", data: { actionType: "send_email", to: "member" } },
        { id: "b", type: "delay", data: { duration: 1, unit: "hours" } },
        { id: "c", type: "branch", data: { paths: [] } },
        { id: "d", type: "action", data: { actionType: "notify_team" } },
        { id: "e", type: "action", data: { actionType: "httpRequest" } },
      ]),
    ).toEqual([]);
  });

  it("tags y campos del contacto no", () => {
    expect(memberFlowProblems([trigger("eod_submitted"), { id: "a", type: "action", data: { actionType: "addTag", tagName: "x" } }])).toHaveLength(1);
  });

  it("'Ir a otro flujo' solo a otro flujo sin contacto", () => {
    const nodes = [trigger("eod_submitted"), { id: "g", type: "action", data: { actionType: "goToFlow", flowId: "f-contacto" } }];
    expect(memberFlowProblems(nodes, (id) => (id === "f-contacto" ? "contact" : "member"))).toHaveLength(1);
    expect(memberFlowProblems(nodes, () => "member")).toEqual([]);
  });

  it("un flujo con contacto no se mira", () => {
    expect(memberFlowProblems([trigger("form_submitted"), { id: "m", type: "sendMessage", data: {} }])).toEqual([]);
  });
});

describe("flujos de sistema: sin contacto ni persona (Tirón 2, D1)", () => {
  it("el sujeto lo dice el disparador, y un flujo de sistema es de los que nunca tienen contacto", () => {
    expect(flowSubject([trigger("test_system_trigger")])).toBe("system");
    expect(isNoContactSubject("system")).toBe(true);
    expect(isNoContactSubject("member")).toBe(true);
    expect(isNoContactSubject("webhook")).toBe(false);
    expect(isNoContactSubject("contact")).toBe(false);
    expect(isNoContactSubject(undefined)).toBe(false);
  });

  it("un paso que necesita contacto se rechaza, y el mensaje habla del sistema (no de una persona del equipo)", () => {
    const problems = memberFlowProblems([trigger("test_system_trigger"), { id: "m", type: "sendMessage", data: {} }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/necesita un contacto/);
    expect(problems[0]).toContain("el sistema");
    expect(problems[0]).not.toContain("persona del equipo");
  });

  it("los pasos que sirven sin contacto valen", () => {
    expect(memberFlowProblems([trigger("test_system_trigger"), { id: "a", type: "delay", data: {} }, { id: "b", type: "action", data: { actionType: "notify_team" } }])).toEqual([]);
  });

  it("«Ir a otro flujo» desde un flujo de sistema puede ir a otro de sistema o de persona; a uno con contacto no", () => {
    const nodes = [trigger("test_system_trigger"), { id: "g", type: "action", data: { actionType: "goToFlow", flowId: "f-2" } }];
    expect(memberFlowProblems(nodes, () => "system")).toEqual([]);
    expect(memberFlowProblems(nodes, () => "member")).toEqual([]);
    expect(memberFlowProblems(nodes, () => "contact")).toHaveLength(1);
    expect(memberFlowProblems(nodes, () => "webhook")).toHaveLength(1);
  });

  it("el flujo de persona del equipo sigue diciendo lo mismo de siempre", () => {
    const problems = memberFlowProblems([trigger("eod_submitted"), { id: "m", type: "sendMessage", data: {} }]);
    expect(problems[0]).toBe("El paso «Enviar mensaje» necesita un contacto, y este flujo es sobre una persona del equipo.");
  });
});
