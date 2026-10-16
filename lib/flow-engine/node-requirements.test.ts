import { describe, expect, it } from "vitest";
import {
  ALL_CONNECTED,
  REQUIREMENT_INFO,
  blockedNodes,
  missingFor,
  needsText,
  requirementProblems,
  requirementsOfNode,
  requirementsOfType,
  type Capabilities,
} from "@/lib/flow-engine/node-requirements";

const none: Capabilities = { email: false, whatsapp_channel: false, ai: false, agent: false, channel: false };

const trigger = { id: "t", type: "trigger", data: {} };
const email = { id: "e", type: "action", data: { actionType: "send_email" } };
const wa = { id: "w", type: "action", data: { actionType: "send_whatsapp_number" } };
const msg = { id: "m", type: "sendMessage", data: {} };
const ai = { id: "a", type: "aiResponse", data: {} };
const tag = { id: "g", type: "action", data: { actionType: "addTag" } };
const delay = { id: "d", type: "delay", data: {} };

describe("que necesita cada accion", () => {
  it("las acciones con dependencias, y solo esas", () => {
    expect(requirementsOfType("send_email")).toEqual(["email"]);
    expect(requirementsOfType("send_whatsapp_number")).toEqual(["whatsapp_channel"]);
    expect(requirementsOfType("aiResponse")).toEqual(["ai"]);
    expect(requirementsOfType("pauseAgent")).toEqual(["agent"]);
    expect(requirementsOfType("resumeAgent")).toEqual(["agent"]);
    expect(requirementsOfType("sendMessage")).toEqual(["channel"]);
    expect(requirementsOfType("sendAsset")).toEqual(["channel"]);
    expect(requirementsOfType("addTag")).toEqual([]);
    expect(requirementsOfType("delay")).toEqual([]);
  });

  it("un nodo guardado como 'action' se resuelve por su actionType", () => {
    expect(requirementsOfNode(email)).toEqual(["email"]);
    expect(requirementsOfNode(tag)).toEqual([]);
    expect(requirementsOfNode(msg)).toEqual(["channel"]);
  });

  it("toda requirement tiene su texto y su destino", () => {
    for (const info of Object.values(REQUIREMENT_INFO)) {
      expect(info.label).not.toBe("");
      expect(info.href).toMatch(/^\/dashboard\//);
      expect(info.cta).not.toBe("");
    }
  });
});

describe("lo que falta", () => {
  it("missingFor y needsText", () => {
    expect(missingFor(["email", "ai"], { ...ALL_CONNECTED, email: false })).toEqual(["email"]);
    expect(missingFor(["email"], ALL_CONNECTED)).toEqual([]);
    expect(needsText(["email"])).toBe("Necesita: Email saliente (Resend)");
    expect(needsText([])).toBe("");
  });
});

describe("pasos bloqueados de un flujo", () => {
  const edges = [
    { source: "t", target: "e" },
    { source: "e", target: "w" },
    { source: "w", target: "g" },
  ];

  it("sin nada conectado, bloquea lo que se alcanza y tiene requisitos", () => {
    const blocked = blockedNodes([trigger, email, wa, tag], edges, none);
    expect(blocked.map((b) => b.nodeId)).toEqual(["e", "w"]);
    expect(blocked[0]).toMatchObject({ name: "Enviar email", missing: ["email"] });
  });

  it("conectar lo que falta lo habilita sin tocar el flujo", () => {
    const nodes = [trigger, email, wa, tag];
    expect(blockedNodes(nodes, edges, none)).toHaveLength(2);
    expect(blockedNodes(nodes, edges, { ...none, email: true })).toHaveLength(1);
    expect(blockedNodes(nodes, edges, ALL_CONNECTED)).toHaveLength(0);
  });

  it("un paso suelto (sin conexion al disparador) nunca corre: no frena la publicacion, pero se avisa con all", () => {
    const loose = { id: "x", type: "aiResponse", data: {} };
    expect(blockedNodes([trigger, email, loose], [{ source: "t", target: "e" }], { ...none, email: true })).toEqual([]);
    expect(blockedNodes([trigger, email, loose], [{ source: "t", target: "e" }], { ...none, email: true }, { all: true }).map((b) => b.nodeId)).toEqual(["x"]);
  });

  it("sin disparador no se alcanza nada", () => {
    expect(blockedNodes([email], [], none)).toEqual([]);
  });

  it("usa la etiqueta que le puso la persona", () => {
    const named = { ...email, data: { actionType: "send_email", label: "Aviso a ventas" } };
    expect(blockedNodes([trigger, named], [{ source: "t", target: "e" }], none)[0].name).toBe("Aviso a ventas");
  });

  it("un ciclo no cuelga el calculo", () => {
    const cyc = [{ source: "t", target: "e" }, { source: "e", target: "m" }, { source: "m", target: "e" }];
    expect(blockedNodes([trigger, email, msg], cyc, none).map((b) => b.nodeId)).toEqual(["e", "m"]);
  });

  it("los problemas de publicacion dicen que falta y a donde ir", () => {
    const problems = requirementProblems(blockedNodes([trigger, ai], [{ source: "t", target: "a" }], none));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/Respuesta con IA/);
    expect(problems[0]).toMatch(/Una IA conectada/);
    expect(problems[0]).toMatch(/Conectar una IA/);
  });

  it("una accion sin requisitos (esperar, tag) nunca se bloquea", () => {
    expect(blockedNodes([trigger, delay, tag], [{ source: "t", target: "d" }, { source: "d", target: "g" }], none)).toEqual([]);
  });
});
