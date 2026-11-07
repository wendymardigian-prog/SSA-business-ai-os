import { describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const generateAiReply = vi.fn(async () => ({ ok: true, text: "hola" }));
vi.mock("@/lib/ai/generate-reply", () => ({ generateAiReply: (...a: unknown[]) => generateAiReply(...(a as [])) }));
const deliverAsset = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/response-assets/deliver", () => ({ deliverAsset: (...a: unknown[]) => deliverAsset(...(a as [])) }));
vi.mock("./send", () => ({ sendChannelMessage: vi.fn(async () => ({ ok: true })), recordSend: vi.fn(async () => {}) }));

import { DO_NOT_CONTACT_SKIP_REASON, DO_NOT_CONTACT_UNKNOWN_REASON, doNotContactSkipReason, isBookingTriggered } from "./do-not-contact";
import { sendAssetNode } from "./nodes/send-asset";
import { aiResponseNode } from "./nodes/ai-response";

const ctx = (variables: Record<string, unknown> = {}) => ({
  triggerId: "tr-1", flowId: "flow-1", channelId: "ch-1", contactId: "c-1", conversationId: "conv-1", workspaceId: "ws-1", incomingMessage: {}, variables,
});

describe("no contactar en los pasos que mandan por un canal", () => {
  it("la regla de la agenda es la misma que la de Enviar email", () => {
    expect(isBookingTriggered({ variables: { trigger_scope: "booking" } })).toBe(true);
    expect(isBookingTriggered({ variables: {} })).toBe(false);
  });

  it("marcado: no manda; de la agenda: manda; sin contacto: no hay nada que mirar", async () => {
    const db = memoryDb({ contacts: [{ id: "c-1", do_not_contact: true }] });
    await expect(doNotContactSkipReason(db.client, ctx())).resolves.toBe(DO_NOT_CONTACT_SKIP_REASON);
    await expect(doNotContactSkipReason(db.client, ctx({ trigger_scope: "booking" }))).resolves.toBeNull();
    await expect(doNotContactSkipReason(db.client, { ...ctx(), contactId: null })).resolves.toBeNull();
  });

  it("si la base no contesta, no manda", async () => {
    const failing = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "timeout" } }) }) }) }),
    };
    await expect(doNotContactSkipReason(failing as never, ctx())).resolves.toBe(DO_NOT_CONTACT_UNKNOWN_REASON);
  });

  it("Enviar recurso se saltea y no entrega nada", async () => {
    const db = memoryDb({ contacts: [{ id: "c-1", do_not_contact: true }], analytics_events: [] });
    const notes: unknown[] = [];
    await sendAssetNode.execute({
      supabase: db.client,
      node: { id: "n-1", type: "sendAsset", data: {} } as never,
      data: { assetId: "a-1" },
      context: { ...ctx(), noteStep: (n: unknown) => notes.push(n) } as never,
      sessionId: "s-1",
      runtime: { executeFlow: async () => {} },
    });
    expect(deliverAsset).not.toHaveBeenCalled();
    expect(notes).toEqual([{ status: "skipped", reason: DO_NOT_CONTACT_SKIP_REASON }]);
  });

  it("Respuesta con IA que se manda: ni se genera (no se gasta IA); solo guardarla en la variable sigue igual", async () => {
    const db = memoryDb({ contacts: [{ id: "c-1", do_not_contact: true }], analytics_events: [] });
    const run = (sendDirectly: boolean) =>
      aiResponseNode.execute({
        supabase: db.client,
        node: { id: "n-1", type: "aiResponse", data: {} } as never,
        data: { sendDirectly } as never,
        context: ctx() as never,
        sessionId: "s-1",
        runtime: { executeFlow: async () => {} },
      });
    await run(true);
    expect(generateAiReply).not.toHaveBeenCalled();
    await run(false);
    expect(generateAiReply).toHaveBeenCalledTimes(1);
  });
});
