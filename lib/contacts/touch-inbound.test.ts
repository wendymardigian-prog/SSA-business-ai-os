/**
 * F85: el toque de un mensaje entrante.
 *
 * La decisión de qué mensaje es un toque es lo que evita llenar la ficha de
 * filas "Instagram · mensaje directo". Los datos de un anuncio se leen sin
 * confiar en ningún campo. Y nada de esto puede fallar: el mensaje ya está
 * guardado cuando se llama.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import {
  fromBaileysMessage,
  fromZernioReferral,
  inboundTouchReason,
  recordInboundTouch,
  type InboundTouchContext,
  type InboundTouchParams,
} from "./touch-inbound";

const AT = new Date("2026-10-05T12:00:00Z");
const daysAgo = (n: number) => new Date(AT.getTime() - n * 86_400_000);

const ctx = (over: Partial<InboundTouchContext> = {}): InboundTouchContext => ({
  platform: "instagram",
  contactExisted: true,
  isStoryReply: false,
  referral: null,
  previousInboundAt: null,
  messageAt: AT,
  ...over,
});

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

describe("qué mensaje es un toque (F85)", () => {
  it("el primer mensaje del contacto, sí", () => {
    expect(inboundTouchReason(ctx({ contactExisted: false }))).toBe("first_message");
  });

  it("un mensaje común de un contacto que escribe seguido, no", () => {
    expect(inboundTouchReason(ctx({ previousInboundAt: daysAgo(2) }))).toBeNull();
    expect(inboundTouchReason(ctx({ previousInboundAt: daysAgo(0.01) }))).toBeNull();
  });

  it("una respuesta a una historia, sí, aunque el contacto ya existiera", () => {
    expect(inboundTouchReason(ctx({ isStoryReply: true }))).toBe("story_reply");
  });

  it("un mensaje con datos de anuncio, sí", () => {
    const referral = { adId: "ad-1", ctwaClid: null, sourceType: "ad", sourceUrl: null, title: null, ref: null };

    expect(inboundTouchReason(ctx({ referral }))).toBe("ad");
  });

  it("el que vuelve después de 7 días o más, sí; de 6, no", () => {
    expect(inboundTouchReason(ctx({ previousInboundAt: daysAgo(7) }))).toBe("returned");
    expect(inboundTouchReason(ctx({ previousInboundAt: daysAgo(30) }))).toBe("returned");
    expect(inboundTouchReason(ctx({ previousInboundAt: daysAgo(6.9) }))).toBeNull();
  });

  it("un contacto existente sin mensaje anterior conocido, no: no se inventa una vuelta", () => {
    expect(inboundTouchReason(ctx({ previousInboundAt: null }))).toBeNull();
  });

  it("si coinciden varios motivos manda el anuncio, que explica mejor el origen", () => {
    const referral = { adId: "ad-1", ctwaClid: null, sourceType: null, sourceUrl: null, title: null, ref: null };

    expect(inboundTouchReason(ctx({ contactExisted: false, isStoryReply: true, referral }))).toBe("ad");
    expect(inboundTouchReason(ctx({ contactExisted: false, isStoryReply: true }))).toBe("story_reply");
  });
});

describe("el referral de Zernio (F85)", () => {
  it("lee un anuncio de Instagram: ad_id, ref y el título", () => {
    expect(
      fromZernioReferral({ ad_id: "ad-9", ref: "promo-octubre", source: "ADS", type: "OPEN_THREAD", ads_context_data: { ad_title: "Clase gratis" } }),
    ).toEqual({ adId: "ad-9", ctwaClid: null, sourceType: "OPEN_THREAD", sourceUrl: null, title: "Clase gratis", ref: "promo-octubre" });
  });

  it("lee un clic a WhatsApp: ctwa_clid y el id del anuncio en source_id", () => {
    const result = fromZernioReferral({ ctwa_clid: "ctwa-1", source_id: "ad-55", source_type: "ad", source_url: "https://fb.com/ads/55", headline: "Mentoría" });

    expect(result).toEqual({
      adId: "ad-55", ctwaClid: "ctwa-1", sourceType: "ad", sourceUrl: "https://fb.com/ads/55", title: "Mentoría", ref: null,
    });
  });

  it("un source_id que NO es de un anuncio no se toma como ad_id", () => {
    expect(fromZernioReferral({ source_id: "post-1", source_type: "post", source_url: "https://ig.com/p/1" })?.adId).toBeNull();
  });

  it("sin nada usable devuelve null: el mensaje se trata como uno común", () => {
    expect(fromZernioReferral(undefined)).toBeNull();
    expect(fromZernioReferral(null)).toBeNull();
    expect(fromZernioReferral("texto")).toBeNull();
    expect(fromZernioReferral({})).toBeNull();
    expect(fromZernioReferral({ media_type: "image", body: "hola" })).toBeNull();
  });
});

describe("el anuncio de un mensaje de WhatsApp (Baileys) (F85)", () => {
  const ad = { sourceType: "ad", sourceId: "ad-77", ctwaClid: "ctwa-9", title: "Reto de 5 días", sourceUrl: "https://fb.me/x" };

  it("lo encuentra en un mensaje de texto, en una imagen y en uno anidado", () => {
    const expected = { adId: "ad-77", ctwaClid: "ctwa-9", sourceType: "ad", sourceUrl: "https://fb.me/x", title: "Reto de 5 días", ref: null };

    expect(fromBaileysMessage({ extendedTextMessage: { text: "hola", contextInfo: { externalAdReply: ad } } })).toEqual(expected);
    expect(fromBaileysMessage({ imageMessage: { contextInfo: { externalAdReply: ad } } })).toEqual(expected);
    expect(fromBaileysMessage({ ephemeralMessage: { message: { extendedTextMessage: { contextInfo: { externalAdReply: ad } } } } })).toEqual(expected);
  });

  it("una vista previa de link común NO es un anuncio", () => {
    expect(fromBaileysMessage({ extendedTextMessage: { contextInfo: { externalAdReply: { title: "Un link", sourceUrl: "https://x.com" } } } })).toBeNull();
  });

  it("sin externalAdReply, o con un mensaje raro, devuelve null sin romper", () => {
    expect(fromBaileysMessage({ conversation: "hola" })).toBeNull();
    expect(fromBaileysMessage(undefined)).toBeNull();
    expect(fromBaileysMessage(null)).toBeNull();
    expect(fromBaileysMessage("texto")).toBeNull();
  });
});

describe("recordInboundTouch (F85)", () => {
  const calls: Array<Record<string, unknown>> = [];

  function world(messages: Array<Record<string, unknown>> = [], rpcResult: unknown = { inserted: true }) {
    calls.length = 0;
    const db = memoryDb(
      { messages },
      {
        rpc: {
          record_contact_touch: (args) => {
            calls.push(args);
            if (rpcResult === "throws") throw new Error("la base se cayo");
            return rpcResult;
          },
        },
      },
    );
    return db.client as never;
  }

  const params = (over: Partial<InboundTouchParams> = {}): InboundTouchParams => ({
    workspaceId: "ws-1",
    contactId: "c-1",
    conversationId: "conv-1",
    platform: "instagram",
    contactExisted: false,
    messageAt: AT,
    platformMessageId: "m-100",
    messageId: "msg-row-100",
    ...over,
  });

  const touchSent = () => calls[0]?.p_touch as Record<string, unknown> | undefined;
  const inbound = (id: string, at: Date) => ({ id, conversation_id: "conv-1", direction: "inbound", created_at: at.toISOString() });

  it("un contacto nuevo: registra un toque instagram / dm con la clave del mensaje", async () => {
    await recordInboundTouch(world(), params());

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ p_workspace_id: "ws-1", p_contact_id: "c-1" });
    expect(touchSent()).toMatchObject({ source: "instagram", medium: "dm", origin: "dm", dedupe_key: "msg:m-100" });
  });

  it("una respuesta a historia: medium story_reply y la historia queda en el raw", async () => {
    await recordInboundTouch(world(), params({ contactExisted: true, storyId: "story-5" }));

    expect(touchSent()).toMatchObject({ medium: "story_reply" });
    expect(JSON.stringify(touchSent()?.raw)).toContain("story-5");
  });

  it("un anuncio: paid_social con los ids, la pieza y el referral en el raw", async () => {
    const referral = { adId: "ad-9", ctwaClid: "ctwa-1", sourceType: "ad", sourceUrl: "https://fb.com/a", title: "Clase gratis", ref: null };

    await recordInboundTouch(world(), params({ platform: "whatsapp", referral }));

    expect(touchSent()).toMatchObject({
      source: "whatsapp", medium: "paid_social", ad_id: "ad-9", ctwa_clid: "ctwa-1", content: "Clase gratis",
    });
    expect(JSON.stringify(touchSent()?.raw)).toContain("ad-9");
  });

  it("email: medium email", async () => {
    await recordInboundTouch(world(), params({ platform: "email" }));

    expect(touchSent()).toMatchObject({ source: "email", medium: "email" });
  });

  it("un contacto que escribió ayer: no registra nada", async () => {
    await recordInboundTouch(world([inbound("m-1", daysAgo(1))]), params({ contactExisted: true }));

    expect(calls).toHaveLength(0);
  });

  it("un contacto que vuelve tras 10 días: registra el toque", async () => {
    await recordInboundTouch(world([inbound("m-1", daysAgo(10))]), params({ contactExisted: true }));

    expect(touchSent()).toMatchObject({ medium: "dm", dedupe_key: "msg:m-100" });
  });

  it("el mensaje anterior solo cuenta si es ENTRANTE y no es el mismo mensaje", async () => {
    const messages = [
      { id: "out-1", conversation_id: "conv-1", direction: "outbound", created_at: daysAgo(30).toISOString() },
      { id: "msg-row-100", conversation_id: "conv-1", direction: "inbound", created_at: AT.toISOString() },
      { id: "otra-conv", conversation_id: "conv-2", direction: "inbound", created_at: daysAgo(30).toISOString() },
    ];

    await recordInboundTouch(world(messages), params({ contactExisted: true }));

    expect(calls).toHaveLength(0);
  });

  it("un contacto existente sin historial guardado: no inventa una vuelta", async () => {
    await recordInboundTouch(world([]), params({ contactExisted: true }));

    expect(calls).toHaveLength(0);
  });

  it("sin id de mensaje de la plataforma arma una clave estable", async () => {
    await recordInboundTouch(world(), params({ platformMessageId: null }));

    expect(touchSent()?.dedupe_key).toBe(`msg:conv-1:${AT.toISOString()}`);
  });

  it("NUNCA lanza: si la base explota, el mensaje ya guardado sigue como estaba", async () => {
    await expect(recordInboundTouch(world([], "throws"), params())).resolves.toBeUndefined();
  });

  it("NUNCA lanza: si la base devuelve un error, tampoco", async () => {
    const db = memoryDb({ messages: [] });
    // Sin handler de rpc, el cliente de prueba devuelve un error.
    await expect(recordInboundTouch(db.client as never, params())).resolves.toBeUndefined();
  });
});
