import { describe, expect, it } from "vitest";
import { flowSendsMessages, oncePerContactHint, SENDING_NODE_TYPES } from "./once-per-contact";

describe("flowSendsMessages", () => {
  it("un paso que manda mensaje, email o recurso cuenta", () => {
    expect(flowSendsMessages([{ type: "trigger" }, { type: "sendMessage" }])).toBe(true);
    expect(flowSendsMessages([{ type: "send_email" }])).toBe(true);
    expect(flowSendsMessages([{ type: "sendAsset" }])).toBe(true);
  });

  it("un paso de acción cuenta por su tipo real (data.actionType), no por el contenedor", () => {
    expect(flowSendsMessages([{ type: "action", data: { actionType: "sendMessage" } }])).toBe(true);
    expect(flowSendsMessages([{ type: "action", data: { actionType: "addTag" } }])).toBe(false);
  });

  it("un flujo que solo cuenta, espera o llama a una URL no manda nada", () => {
    expect(flowSendsMessages([{ type: "trigger" }, { type: "upsert_contact" }, { type: "delay" }, { type: "action", data: { actionType: "httpRequest" } }])).toBe(false);
    expect(flowSendsMessages([])).toBe(false);
  });

  it("la lista incluye el paso de WhatsApp a un número (D3)", () => {
    expect(SENDING_NODE_TYPES).toContain("send_whatsapp_number");
  });
});

describe("oncePerContactHint", () => {
  it("sugiere la opción solo si el flujo manda mensajes y está apagada", () => {
    expect(oncePerContactHint({ enabled: false, sendsMessages: true })).toContain("conviene encender");
    expect(oncePerContactHint({ enabled: true, sendsMessages: true })).toBeNull();
    expect(oncePerContactHint({ enabled: false, sendsMessages: false })).toBeNull();
  });
});
