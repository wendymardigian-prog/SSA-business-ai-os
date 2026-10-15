import { describe, expect, it } from "vitest";
import { buildOriginContext, messageOriginVariables } from "./origin-context";

describe("buildOriginContext", () => {
  it("una mención en una historia (metadata.isStoryMention)", () => {
    expect(buildOriginContext({ platform: "instagram", isStoryMention: true })).toEqual({ story_mention: true });
  });

  it("una respuesta a una historia", () => {
    expect(buildOriginContext({ platform: "instagram", storyReply: { storyId: "s-1", storyUrl: "https://ig.com/s/1" } })).toEqual({ story_reply: { story_id: "s-1", story_url: "https://ig.com/s/1" } });
  });

  it("responder a una historia gana a la mención (son excluyentes)", () => {
    expect(buildOriginContext({ platform: "instagram", storyReply: { storyId: "s-1" }, isStoryMention: true })).toEqual({ story_reply: { story_id: "s-1" } });
  });

  it("un anuncio de Instagram: ad_id, título, publicación y plataforma (lista blanca)", () => {
    const ctx = buildOriginContext({
      platform: "instagram",
      zernioReferral: { ad_id: "123", ref: "promo", type: "OPEN_THREAD", ads_context_data: { ad_title: "Clase", post_id: "999", photo_url: "https://secreto", flow_id: "x" }, token: "no-debe-guardarse" },
    });
    expect(ctx).toEqual({ ad: { platform: "instagram", ad_id: "123", ref: "promo", title: "Clase", post_id: "999" } });
    expect(JSON.stringify(ctx)).not.toContain("secreto");
    expect(JSON.stringify(ctx)).not.toContain("no-debe-guardarse");
  });

  it("un clic a WhatsApp (externalAdReply de Baileys): ctwa_clid y plataforma", () => {
    const ctx = buildOriginContext({ platform: "whatsapp", baileysMessage: { extendedTextMessage: { contextInfo: { externalAdReply: { sourceType: "ad", sourceId: "ad-77", ctwaClid: "ctwa-9", title: "Reto", sourceUrl: "https://fb.me/x" } } } } });
    expect(ctx).toEqual({ ad: { platform: "whatsapp", ad_id: "ad-77", ctwa_clid: "ctwa-9", source_type: "ad", source_url: "https://fb.me/x", title: "Reto" } });
  });

  it("un mensaje común no tiene contexto (null)", () => {
    expect(buildOriginContext({ platform: "instagram" })).toBeNull();
    expect(buildOriginContext({ platform: "instagram", zernioReferral: { media_type: "image" } })).toBeNull();
    expect(buildOriginContext({ platform: "whatsapp", baileysMessage: { conversation: "hola" } })).toBeNull();
  });

  it("el mensaje citado", () => {
    expect(buildOriginContext({ platform: "whatsapp", quotedMessageId: "wamid.1" })).toEqual({ quoted_message_id: "wamid.1" });
  });

  it("nunca lanza con datos raros", () => {
    for (const bad of [null, undefined, 5, "x", [], { get a() { throw new Error("x"); } }]) {
      expect(() => buildOriginContext({ platform: "instagram", zernioReferral: bad, baileysMessage: bad, storyReply: bad as never })).not.toThrow();
    }
  });
});

describe("messageOriginVariables", () => {
  it("deja el anuncio, su título y la mención para {{message_origin.*}}", () => {
    expect(messageOriginVariables({ adId: "123", adTitle: "Clase" })).toEqual({ ad_id: "123", ad_title: "Clase", is_story_mention: "false" });
    expect(messageOriginVariables({ isStoryMention: true })).toEqual({ ad_id: "", ad_title: "", is_story_mention: "true" });
  });
  it("un mensaje sin origen no agrega variables", () => {
    expect(messageOriginVariables({})).toBeNull();
  });
});

describe("la pieza en el origen (Extra I, F33 y F35)", () => {
  it("una respuesta a una historia nuestra guarda la publicación y la pieza", () => {
    const out = buildOriginContext({ platform: "instagram", storyReply: { storyId: "s1", storyUrl: "https://x", socialPostId: "sp-1", contentPostId: "cp-1" } });
    expect(out?.story_reply).toEqual({ story_id: "s1", story_url: "https://x", social_post_id: "sp-1", content_post_id: "cp-1" });
  });

  it("`content` pasa por una lista blanca: lo que no es pieza o publicación se descarta", () => {
    const out = buildOriginContext({
      platform: "instagram",
      content: { social_post_id: "sp-1", content_post_id: "cp-1", via: "flow", flow_id: "f-1", title: "Reel", token: "secreto", extra: { a: 1 } },
    });
    expect(out?.content).toEqual({ social_post_id: "sp-1", content_post_id: "cp-1", via: "flow", flow_id: "f-1", title: "Reel" });
    expect(buildOriginContext({ platform: "instagram", content: { via: "flow" } })).toBeNull();
    expect(buildOriginContext({ platform: "instagram", content: "texto" })).toBeNull();
  });
});
