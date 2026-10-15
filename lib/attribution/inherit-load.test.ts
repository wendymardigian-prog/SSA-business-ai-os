import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { loadInheritedContent } from "./inherit-load";

const NOW = new Date("2026-10-10T12:00:00Z");
const msg = (id: string, createdAt: string, direction: string, origin_context: unknown) => ({ id, conversation_id: "conv-1", direction, created_at: createdAt, origin_context });
const content = { content: { content_post_id: "cp-A", social_post_id: "sp-A", via: "flow", flow_id: "f1", title: "Reel A" } };
const args = (days = 7) => ({ conversationId: "conv-1", inboundOriginContext: null, now: NOW, days });

describe("loadInheritedContent", () => {
  it("un DM de automatización de hace 2 días con la pieza A: se hereda", async () => {
    const db = memoryDb({ messages: [msg("m-out", "2026-10-08T12:00:00Z", "outbound", content)] });
    expect(await loadInheritedContent(db.client, args())).toMatchObject({ content_post_id: "cp-A", social_post_id: "sp-A", via: "automation_reply", outbound_message_id: "m-out", title: "Reel A" });
  });
  it("de hace 8 días con 7: no hereda", async () => {
    const db = memoryDb({ messages: [msg("m-out", "2026-10-02T11:00:00Z", "outbound", content)] });
    expect(await loadInheritedContent(db.client, args())).toBeNull();
  });
  it("toma el ÚLTIMO saliente con pieza, ignorando los que no tienen", async () => {
    const db = memoryDb({ messages: [
      msg("m-old", "2026-10-06T12:00:00Z", "outbound", { content: { content_post_id: "cp-OLD", via: "flow" } }),
      msg("m-new", "2026-10-09T12:00:00Z", "outbound", content),
      msg("m-plain", "2026-10-09T13:00:00Z", "outbound", null),
      msg("m-in", "2026-10-09T14:00:00Z", "inbound", null),
    ] });
    expect((await loadInheritedContent(db.client, args()))?.outbound_message_id).toBe("m-new");
  });
  it("si el entrante trae un anuncio, gana el anuncio", async () => {
    const db = memoryDb({ messages: [msg("m-out", "2026-10-08T12:00:00Z", "outbound", content)] });
    expect(await loadInheritedContent(db.client, { ...args(), inboundOriginContext: { ad: { platform: "instagram", ad_id: "1" } } })).toBeNull();
  });
  it("sin mensajes, o con la base caída, devuelve null", async () => {
    expect(await loadInheritedContent(memoryDb({ messages: [] }).client, args())).toBeNull();
    expect(await loadInheritedContent({ from: () => { throw new Error("x"); } } as never, args())).toBeNull();
  });
});
