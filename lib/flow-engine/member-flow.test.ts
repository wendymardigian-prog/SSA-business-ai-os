import { describe, it, expect } from "vitest";
import "./registry";
import { flowSubject, memberFlowProblems } from "./member-flow";

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
