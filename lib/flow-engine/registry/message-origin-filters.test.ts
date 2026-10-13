/**
 * Los dos filtros nuevos del disparador de palabra clave (Extra L, F19): «Solo si vino de un anuncio» y
 * «Solo menciones en historias», y las variables `{{message_origin.*}}` que deja el motor.
 */
import { describe, expect, it } from "vitest";
import { getTrigger } from "./index";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { executeFlow } from "../engine";
import type { IncomingMessage } from "../types";

const keyword = getTrigger("keyword")!;
const match = (config: Record<string, unknown>, message: Partial<IncomingMessage> = {}) =>
  keyword.matches!({
    trigger: { id: "t", flow_id: "f", channel_id: null, type: "keyword", config, priority: 0, is_active: true },
    config: { keywords: [{ value: "info", matchType: "contains" }], ...config },
    message: { text: "info", ...message },
    text: "info",
    isFirstMessage: false,
  } as never);

describe("filtros del disparador de palabra clave (F19)", () => {
  it("«Solo si vino de un anuncio»: corre con un mensaje de anuncio y no con uno común", () => {
    expect(match({ fromAdOnly: true }, { fromAd: true, adId: "123" })).toBe(true);
    expect(match({ fromAdOnly: true }, {})).toBe(false);
  });

  it("«Solo menciones en historias»: corre con una mención y no con un DM común", () => {
    expect(match({ storyMentionOnly: true }, { isStoryMention: true })).toBe(true);
    expect(match({ storyMentionOnly: true }, {})).toBe(false);
  });

  it("sin los filtros, el comportamiento de siempre (no-regresión)", () => {
    expect(match({}, {})).toBe(true);
    expect(match({}, { fromAd: true })).toBe(true);
    expect(match({ storyReply: true }, { isStoryReply: true })).toBe(true);
    expect(match({ storyReply: true }, {})).toBe(false);
  });

  it("los filtros se suman con la palabra clave: la palabra tiene que coincidir igual", () => {
    expect(match({ fromAdOnly: true, keywords: [{ value: "otra", matchType: "exact" }] }, { fromAd: true })).toBe(false);
  });
});

describe("{{message_origin.*}} en el motor", () => {
  it("el motor siembra el anuncio y la mención aparte de {{message}}", async () => {
    await import("../registry");
    const db = memoryDb({
      flows: [{ id: "f", workspace_id: "ws", status: "published", nodes: [{ id: "t", type: "trigger", data: { triggerType: "keyword" } }], edges: [] }],
      channels: [],
      flow_sessions: [],
      analytics_events: [],
    });
    const context = {
      triggerId: "tr", flowId: "f", channelId: "", contactId: "c-1", conversationId: "", workspaceId: "ws",
      incomingMessage: { text: "info", fromAd: true, adId: "123", adTitle: "Clase gratis", isStoryMention: false } as IncomingMessage,
      variables: {} as Record<string, unknown>,
    };
    await executeFlow(db.client, context);
    expect(context.variables.message).toBe("info");
    expect(context.variables.message_origin).toEqual({ ad_id: "123", ad_title: "Clase gratis", is_story_mention: "false" });
  });

  it("un mensaje sin origen no agrega la variable", async () => {
    const db = memoryDb({ flows: [{ id: "f", workspace_id: "ws", status: "published", nodes: [{ id: "t", type: "trigger", data: {} }], edges: [] }], channels: [], flow_sessions: [], analytics_events: [] });
    const context = { triggerId: "tr", flowId: "f", channelId: "", contactId: "c-1", conversationId: "", workspaceId: "ws", incomingMessage: { text: "hola" } as IncomingMessage, variables: {} as Record<string, unknown> };
    await executeFlow(db.client, context);
    expect(context.variables.message_origin).toBeUndefined();
  });
});
