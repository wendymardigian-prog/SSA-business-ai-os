/**
 * El nodo "Respuesta con IA" (FA6).
 *
 * Lo que importa: cuando generateAiReply devuelve `problem: "unreadable"`
 * (la compuerta de interpretabilidad), el nodo corta el flow SIN insertar el
 * mensaje rojo de fallo -- no es un error de configuracion, es lo mismo que
 * haria el agente de chat, y generateAiReply ya dejo needs_human=true. Con
 * cualquier otro problema (key invalida, proveedor caido) si se avisa en la
 * conversacion, como siempre.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const generateAiReply = vi.fn();
vi.mock("@/lib/ai/generate-reply", () => ({
  generateAiReply: (...a: unknown[]) => generateAiReply(...(a as [])),
}));

const sendChannelMessage = vi.fn(async () => ({ ok: true, platformMessageId: "pm-1" }));
const recordSend = vi.fn(async () => {});
vi.mock("../send", () => ({
  sendChannelMessage: (...a: unknown[]) => sendChannelMessage(...(a as [])),
  recordSend: (...a: unknown[]) => recordSend(...(a as [])),
}));

import { aiResponseNode } from "./ai-response";
import type { FlowExecutionContext } from "../types";

const context: FlowExecutionContext = {
  triggerId: "t-1",
  flowId: "flow-1",
  channelId: "ch-1",
  contactId: "c-1",
  conversationId: "cv-1",
  workspaceId: "ws-1",
  incomingMessage: {},
};

function world() {
  const memory = memoryDb({ messages: [], flow_sessions: [{ id: "sess-1", status: "running" }] });
  return memory;
}

beforeEach(() => {
  generateAiReply.mockReset();
  sendChannelMessage.mockClear();
  recordSend.mockClear();
});

describe("aiResponseNode: unreadable (FA6)", () => {
  it("corta el flow SIN mandar el mensaje rojo de fallo, y sin enviar nada", async () => {
    generateAiReply.mockResolvedValue({ ok: false, problem: "unreadable", message: "Llegó un video...", runId: "r-1" });
    const memory = world();

    await aiResponseNode.execute({
      supabase: memory.client,
      data: {} as never,
      context,
      sessionId: "sess-1",
      runtime: {} as never,
      node: { id: "n-1" } as never,
    });

    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(memory.rows("messages")).toHaveLength(0);
    expect(memory.rows("flow_sessions")[0].status).toBe("cancelled");
  });
});

describe("aiResponseNode: otros fallos (caracterizacion previa)", () => {
  it("con un problema de configuracion SI avisa en la conversacion", async () => {
    generateAiReply.mockResolvedValue({
      ok: false,
      problem: "no_provider",
      message: "No hay ningun proveedor de IA disponible.",
      runId: "r-1",
    });
    const memory = world();

    await aiResponseNode.execute({
      supabase: memory.client,
      data: {} as never,
      context,
      sessionId: "sess-1",
      runtime: {} as never,
      node: { id: "n-1" } as never,
    });

    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(memory.rows("messages")).toHaveLength(1);
    expect(memory.rows("messages")[0]).toMatchObject({
      text: "No hay ningun proveedor de IA disponible.",
      status: "failed",
    });
    expect(memory.rows("flow_sessions")[0].status).toBe("cancelled");
  });

  it("en el camino feliz manda el texto generado", async () => {
    generateAiReply.mockResolvedValue({ ok: true, text: "Hola, te cuento.", provider: "openai", modelId: "gpt-x", runId: "r-1" });
    const memory = world();

    await aiResponseNode.execute({
      supabase: memory.client,
      data: {} as never,
      context,
      sessionId: "sess-1",
      runtime: {} as never,
      node: { id: "n-1" } as never,
    });

    expect(sendChannelMessage).toHaveBeenCalledWith(memory.client, context, { text: "Hola, te cuento." });
    expect(recordSend).toHaveBeenCalled();
  });
});
