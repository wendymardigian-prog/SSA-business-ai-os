import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const sendPrivateReply = vi.fn(async (_args: unknown): Promise<unknown> => ({}));
vi.mock("@/lib/zernio-client", () => ({ createZernioClient: () => ({ comments: { sendPrivateReplyToComment: (a: unknown) => sendPrivateReply(a) } }) }));
vi.mock("@/lib/integrations/zernio-key", () => ({ getZernioApiKey: async () => "zk-test" }));

import { privateReplyNode } from "./comment-reply";
import { sendablePrivateReplyButtons } from "../private-reply";
import { getNode } from "../registry";
import { triggerProblems, PRIVATE_REPLY_NEEDS_COMMENT_PROBLEM } from "../publish-rules";

const LINK = "https://example.com/clase";

async function run(data: Record<string, unknown>, late_conversation_id: string | null = null) {
  const db = memoryDb({
    channels: [{ id: "ch-1", platform: "instagram", late_account_id: "acc-1" }],
    conversations: [{ id: "conv-1", late_conversation_id }],
    messages: [],
  });
  await privateReplyNode.execute({
    supabase: db.client,
    node: { id: "n-1", type: "action", data: {} } as never,
    data: data as never,
    context: {
      triggerId: "tr-1",
      flowId: "flow-1",
      channelId: "ch-1",
      contactId: "c-1",
      conversationId: "conv-1",
      workspaceId: "ws-1",
      incomingMessage: {},
      variables: { comment_id: "cm-1", post_id: "po-1", commenter_name: "Ana" },
    } as never,
    sessionId: "s-1",
    runtime: { executeFlow: async () => {} },
  });
  return db;
}

beforeEach(() => {
  sendPrivateReply.mockReset();
  sendPrivateReply.mockResolvedValue({});
});

describe("Responder por privado", () => {
  it("manda el texto y el botón con link", async () => {
    await run({ text: "Hola {{commenter_name}}", buttons: [{ type: "url", title: "Registrarme", url: LINK }] });
    expect(sendPrivateReply).toHaveBeenCalledWith({
      path: { postId: "po-1", commentId: "cm-1" },
      body: { accountId: "acc-1", message: "Hola Ana", buttons: [{ type: "url", title: "Registrarme", url: LINK }] },
    });
  });

  it("sin botones, el pedido es el de siempre", async () => {
    await run({ text: "Hola" });
    expect(sendPrivateReply).toHaveBeenCalledWith({ path: { postId: "po-1", commentId: "cm-1" }, body: { accountId: "acc-1", message: "Hola" } });
  });

  it("sale como respuesta al comentario aunque la persona ya tenga un chat", async () => {
    await run({ text: "Hola" }, "lc-1");
    expect(sendPrivateReply).toHaveBeenCalledTimes(1);
  });

  it("si falla, guarda el texto y el motivo por separado", async () => {
    sendPrivateReply.mockRejectedValue(Object.assign(new Error("not_thread_owner"), { code: "not_thread_owner" }));
    const db = await run({ text: "Hola" });
    const [row] = db.rows("messages") as Array<{ text: string; status: string; send_error: string }>;
    expect(row.text).toBe("Hola");
    expect(row.status).toBe("failed");
    expect(row.send_error).toContain("otra app");
  });

  it("el editor lo guarda como acción y el motor lo encuentra", () => {
    expect(getNode({ type: "action", data: { actionType: "privateReply" } } as never)?.type).toBe("privateReply");
  });
});

describe("sendablePrivateReplyButtons", () => {
  it("descarta lo que Zernio rechazaría y corta en tres", () => {
    const ok = { type: "url", title: "Ok", url: LINK };
    expect(
      sendablePrivateReplyButtons([
        { title: "", url: LINK },
        { title: "Sin link", url: "" },
        { title: "Variable", url: "{{link}}" },
        { title: "Otro protocolo", url: "javascript:alert(1)" },
        { title: "Un título demasiado largo para Meta", url: LINK },
        ok,
        ok,
        ok,
        ok,
      ]),
    ).toEqual([ok, ok, ok]);
  });

  it("sin una lista, no hay botones", () => {
    expect(sendablePrivateReplyButtons(undefined)).toEqual([]);
  });
});

describe("publicar", () => {
  const step = { id: "p", type: "action", data: { actionType: "privateReply" } };
  const edges = [{ source: "t" }];

  it("rechaza el paso si la automatización no arranca por un comentario", () => {
    const nodes = [{ id: "t", type: "trigger", data: { triggerType: "keyword", keywords: ["clase"] } }, step];
    expect(triggerProblems(nodes, edges)).toContain(PRIVATE_REPLY_NEEDS_COMMENT_PROBLEM);
  });

  it("lo acepta con el disparador de comentarios", () => {
    const nodes = [{ id: "t", type: "trigger", data: { triggerType: "comment_keyword", keywords: [{ value: "clase", matchType: "exact" }] } }, step];
    expect(triggerProblems(nodes, edges)).toEqual([]);
  });
});
