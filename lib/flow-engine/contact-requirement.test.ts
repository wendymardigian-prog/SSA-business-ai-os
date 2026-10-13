import { beforeAll, describe, expect, it } from "vitest";
import { nodeNeedsContact, pathsMissingContact, type GraphEdge, type GraphNode } from "./contact-requirement";
import { flowSubject, memberFlowProblems, webhookFlowProblems } from "./member-flow";

beforeAll(async () => {
  await import("./registry");
});

const trigger = (triggerType = "webhook_received"): GraphNode => ({ id: "t", type: "trigger", data: { triggerType } });
const upsert: GraphNode = { id: "u", type: "upsert_contact", data: {} };
const whatsapp: GraphNode = { id: "m", type: "sendMessage", data: { label: "Enviar WhatsApp", messages: [] } };
const http: GraphNode = { id: "h", type: "action", data: { actionType: "httpRequest" } };
const delay: GraphNode = { id: "d", type: "delay", data: { duration: 1, unit: "minutes" } };
const edge = (source: string, target: string, sourceHandle?: string): GraphEdge => ({ source, target, ...(sourceHandle ? { sourceHandle } : {}) });
const names = (nodes: GraphNode[], edges: GraphEdge[]) => pathsMissingContact(nodes, edges).map((m) => m.nodeId);

describe("pathsMissingContact: el plano (F10)", () => {
  it("HTTP → Esperar → HTTP sin paso de contacto es válido", () => {
    const http2 = { ...http, id: "h2" };
    expect(names([trigger(), http, delay, http2], [edge("t", "h"), edge("h", "d"), edge("d", "h2")])).toEqual([]);
  });

  it("«Enviar WhatsApp» antes del paso de contacto se marca", () => {
    expect(names([trigger(), whatsapp, upsert], [edge("t", "m"), edge("m", "u")])).toEqual(["m"]);
  });

  it("después de «Crear o actualizar contacto» por «Listo» se permite", () => {
    expect(names([trigger(), upsert, whatsapp], [edge("t", "u"), edge("u", "m", "ok")])).toEqual([]);
  });

  it("el mismo paso colgado de «No se pudo» se marca", () => {
    expect(names([trigger(), upsert, whatsapp], [edge("t", "u"), edge("u", "m", "fail")])).toEqual(["m"]);
  });

  it("un paso al que se llega por DOS caminos, uno sin contacto, se marca", () => {
    const branch: GraphNode = { id: "b", type: "branch", data: { paths: [{ id: "p_a", label: "A", logic: "and", conditions: [{ field: "webhook.payload.x", operator: "is", value: "1", valueType: "text" }] }] } };
    const nodes = [trigger(), branch, upsert, whatsapp];
    const edges = [edge("t", "b"), edge("b", "u", "p_a"), edge("u", "m", "ok"), edge("b", "m", "else")];
    expect(names(nodes, edges)).toEqual(["m"]);
  });

  it("si los DOS caminos pasan por el paso de contacto, se permite", () => {
    const branch: GraphNode = { id: "b", type: "branch", data: { paths: [{ id: "p_a", label: "A", logic: "and", conditions: [{ field: "webhook.payload.x", operator: "is", value: "1", valueType: "text" }] }] } };
    const upsert2: GraphNode = { id: "u2", type: "upsert_contact", data: {} };
    const nodes = [trigger(), branch, upsert, upsert2, whatsapp];
    const edges = [edge("t", "b"), edge("b", "u", "p_a"), edge("b", "u2", "else"), edge("u", "m", "ok"), edge("u2", "m", "ok")];
    expect(names(nodes, edges)).toEqual([]);
  });

  it("una espera después del paso de contacto no pierde el contacto", () => {
    expect(names([trigger(), upsert, delay, whatsapp], [edge("t", "u"), edge("u", "d", "ok"), edge("d", "m")])).toEqual([]);
  });

  it("un ciclo no cuelga ni da falsos positivos", () => {
    const nodes = [trigger(), upsert, delay, whatsapp];
    const edges = [edge("t", "u"), edge("u", "d", "ok"), edge("d", "m"), edge("m", "d")];
    expect(names(nodes, edges)).toEqual([]);
    expect(names([trigger(), delay, whatsapp], [edge("t", "d"), edge("d", "m"), edge("m", "d")])).toEqual(["m"]);
  });

  it("los pasos que no se alcanzan desde el disparador no se miran", () => {
    expect(names([trigger(), whatsapp], [])).toEqual([]);
  });

  it("sin disparador no hay nada que validar", () => {
    expect(names([whatsapp], [])).toEqual([]);
  });
});

describe("nodeNeedsContact: más allá de needsContact", () => {
  it("una condición sobre webhook.* no necesita contacto; una sobre contact.tags sí", () => {
    const free: GraphNode = { id: "b", type: "branch", data: { paths: [{ id: "p_a", label: "A", logic: "and", conditions: [{ field: "webhook.payload.plan", operator: "is", value: "pro", valueType: "text" }] }] } };
    const needs: GraphNode = { id: "b", type: "branch", data: { paths: [{ id: "p_a", label: "A", logic: "and", conditions: [{ field: "contact.tags", operator: "includes_any", values: ["vip"], valueType: "multi_select" }] }] } };
    expect(nodeNeedsContact(free)).toBe(false);
    expect(nodeNeedsContact(needs)).toBe(true);
  });

  it("un condition viejo (sin tipo) necesita contacto", () => {
    expect(nodeNeedsContact({ id: "c", type: "condition", data: { conditions: [] } })).toBe(true);
  });

  it("send_email: al contacto (o sin `to`) lo necesita; a una dirección fija o al equipo, no", () => {
    const mail = (to?: string): GraphNode => ({ id: "e", type: "action", data: { actionType: "send_email", ...(to ? { to } : {}) } });
    expect(nodeNeedsContact(mail())).toBe(true);
    expect(nodeNeedsContact(mail("contact"))).toBe(true);
    expect(nodeNeedsContact(mail("fixed"))).toBe(false);
    expect(nodeNeedsContact(mail("users"))).toBe(false);
  });

  it("goToFlow solo sirve sin contacto si el otro flujo tampoco lo necesita", () => {
    const go: GraphNode = { id: "g", type: "action", data: { actionType: "goToFlow", flowId: "f-2" } };
    expect(nodeNeedsContact(go, () => "webhook")).toBe(false);
    expect(nodeNeedsContact(go, () => "member")).toBe(false);
    expect(nodeNeedsContact(go, () => "contact")).toBe(true);
    expect(nodeNeedsContact(go)).toBe(true);
  });

  it("el paso de contacto, el disparador, los HTTP y las esperas no lo necesitan", () => {
    for (const n of [upsert, trigger(), http, delay]) expect(nodeNeedsContact(n)).toBe(false);
  });
});

describe("el sujeto del flujo y la validación de publicar", () => {
  it("un disparador de webhook es de sujeto webhook; los demás, no", () => {
    expect(flowSubject([trigger()])).toBe("webhook");
    expect(flowSubject([trigger("keyword")])).toBe("contact");
    expect(flowSubject([trigger("eod_submitted")])).toBe("member");
  });

  it("un flujo de webhook con «Enviar WhatsApp» antes del contacto da el mensaje para quien edita", () => {
    const problems = webhookFlowProblems([trigger(), whatsapp, upsert], [edge("t", "m"), edge("m", "u")]);
    expect(problems).toEqual(["«Enviar WhatsApp» necesita un contacto. Poné antes «Crear o actualizar contacto» y conectá este paso a su salida «Listo»."]);
  });

  it("un flujo que NO es de webhook no exige el paso de contacto (no-regresión)", () => {
    expect(webhookFlowProblems([trigger("keyword"), whatsapp], [edge("t", "m")])).toEqual([]);
    expect(webhookFlowProblems([trigger("eod_submitted"), whatsapp], [edge("t", "m")])).toEqual([]);
  });

  it("la validación de EOD sigue rechazando lo mismo: cualquier paso con contacto", () => {
    expect(memberFlowProblems([trigger("eod_submitted"), whatsapp])).toHaveLength(1);
    expect(memberFlowProblems([trigger("webhook_received"), whatsapp])).toEqual([]);
  });
});
