import { describe, expect, it } from "vitest";
import { messageOrigin, originChipsFor, type ChipMessage } from "./origin-view";

const PIECE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PIECE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const POST_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("messageOrigin", () => {
  it("un anuncio", () => {
    expect(messageOrigin({ ad: { platform: "instagram", ad_id: "123", title: "Video testimonio" } })).toEqual({
      kind: "ad",
      contentPostId: null,
      socialPostId: null,
      adId: "123",
      label: "Anuncio «Video testimonio»",
    });
    expect(messageOrigin({ ad: { platform: "whatsapp" } })).toMatchObject({ kind: "ad", adId: null, label: "Anuncio" });
  });

  it("una pieza de contenido (herencia de una automatizacion, F35)", () => {
    expect(messageOrigin({ content: { social_post_id: POST_A, content_post_id: PIECE_A, via: "automation_reply", outbound_message_id: "m-1" } })).toEqual({
      kind: "content",
      contentPostId: PIECE_A,
      socialPostId: POST_A,
      adId: null,
      label: "Contenido",
    });
  });

  it("una pieza con titulo en el contexto lo suma al texto", () => {
    expect(messageOrigin({ content: { content_post_id: PIECE_A, title: "Reel: 3 errores" } }).label).toBe("Contenido «Reel: 3 errores»");
  });

  it("una respuesta a una historia, con o sin la pieza resuelta (F33)", () => {
    expect(messageOrigin({ story_reply: { story_id: "s-1" } })).toEqual({ kind: "story", contentPostId: null, socialPostId: null, adId: null, label: "Respuesta a tu historia" });
    expect(messageOrigin({ story_reply: { story_id: "s-1", social_post_id: POST_A, content_post_id: PIECE_A } })).toMatchObject({ kind: "story", contentPostId: PIECE_A, socialPostId: POST_A });
  });

  it("una mencion en una historia", () => {
    expect(messageOrigin({ story_mention: true })).toEqual({ kind: "mention", contentPostId: null, socialPostId: null, adId: null, label: "Te mencionó en una historia" });
  });

  it("sin origen: kind null", () => {
    for (const ctx of [null, undefined, {}, { quoted_message_id: "q" }, [], "texto", 5, { content: {} }, { story_mention: false }]) {
      expect(messageOrigin(ctx), JSON.stringify(ctx)).toEqual({ kind: null, contentPostId: null, socialPostId: null, adId: null, label: "" });
    }
  });

  it("el anuncio gana a la pieza, y la historia a la mencion y la pieza", () => {
    expect(messageOrigin({ ad: { platform: "instagram", ad_id: "1" }, content: { content_post_id: PIECE_A } }).kind).toBe("ad");
    expect(messageOrigin({ story_reply: { story_id: "s" }, content: { content_post_id: PIECE_A } }).kind).toBe("story");
    expect(messageOrigin({ story_mention: true, content: { content_post_id: PIECE_A } }).kind).toBe("mention");
  });

  it("nunca lanza con datos rotos", () => {
    expect(messageOrigin({ ad: "x" })).toMatchObject({ kind: null });
    expect(messageOrigin({ story_reply: 5, content: 7 })).toMatchObject({ kind: null });
    expect(messageOrigin({ ad: { ad_id: 123, title: {} } })).toMatchObject({ kind: "ad", adId: null, label: "Anuncio" });
  });
});

const inbound = (id: string, originContext: unknown = null): ChipMessage => ({ id, direction: "inbound", origin_context: originContext });
const outbound = (id: string, originContext: unknown = null): ChipMessage => ({ id, direction: "outbound", origin_context: originContext });
const fromPiece = (piece: string) => ({ content: { content_post_id: piece, via: "automation_reply" } });

describe("originChipsFor", () => {
  it("tres mensajes de la misma pieza y uno de otra: dos chips", () => {
    const chips = originChipsFor([inbound("1", fromPiece(PIECE_A)), inbound("2", fromPiece(PIECE_A)), inbound("3", fromPiece(PIECE_A)), inbound("4", fromPiece(PIECE_B))]);
    expect(chips.map((c) => c.messageId)).toEqual(["1", "4"]);
    expect(chips[0].origin.contentPostId).toBe(PIECE_A);
    expect(chips[1].origin.contentPostId).toBe(PIECE_B);
  });

  it("los salientes no llevan chip ni cortan el tramo", () => {
    const chips = originChipsFor([
      inbound("1", fromPiece(PIECE_A)),
      outbound("2", { content: { content_post_id: PIECE_A, via: "flow" } }),
      inbound("3", fromPiece(PIECE_A)),
    ]);
    expect(chips.map((c) => c.messageId)).toEqual(["1"]);
  });

  it("un entrante sin origen corta el tramo: la vuelta lleva su propio chip", () => {
    const chips = originChipsFor([inbound("1", fromPiece(PIECE_A)), inbound("2"), inbound("3", fromPiece(PIECE_A))]);
    expect(chips.map((c) => c.messageId)).toEqual(["1", "3"]);
  });

  it("mensajes sin origen no generan chips", () => {
    expect(originChipsFor([inbound("1"), outbound("2"), inbound("3", {})])).toEqual([]);
    expect(originChipsFor([])).toEqual([]);
  });

  it("distingue tipos y anuncios distintos", () => {
    const chips = originChipsFor([
      inbound("1", { ad: { platform: "instagram", ad_id: "1", title: "A" } }),
      inbound("2", { ad: { platform: "instagram", ad_id: "1", title: "A" } }),
      inbound("3", { ad: { platform: "instagram", ad_id: "2", title: "B" } }),
      inbound("4", { story_reply: { story_id: "s" } }),
      inbound("5", { story_reply: { story_id: "s2" } }),
      inbound("6", { story_mention: true }),
    ]);
    expect(chips.map((c) => [c.messageId, c.origin.kind])).toEqual([
      ["1", "ad"],
      ["3", "ad"],
      ["4", "story"],
      ["6", "mention"],
    ]);
  });

  it("nunca lanza con mensajes raros", () => {
    expect(() => originChipsFor([{ id: "1", direction: "inbound", origin_context: { ad: 5 } }, null as unknown as ChipMessage])).not.toThrow();
  });
});
