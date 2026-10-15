import { describe, expect, it } from "vitest";
import { hasOwnOrigin, inheritContent, inheritDedupeKey, readContentOrigin } from "./inherit";

const NOW = new Date("2026-10-15T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const PIECE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const POST_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const outbound = (createdAt: string, content: unknown = { social_post_id: POST_A, content_post_id: PIECE_A, via: "flow", flow_id: "f-1" }) => ({
  id: "out-1",
  created_at: createdAt,
  origin_context: content === null ? null : { content },
});

describe("inheritContent", () => {
  it("un DM de automatizacion de hace 2 dias: el entrante hereda la pieza", () => {
    expect(inheritContent(outbound(daysAgo(2)), { origin_context: null }, NOW, 7)).toEqual({
      content_post_id: PIECE_A,
      social_post_id: POST_A,
      via: "automation_reply",
      outbound_message_id: "out-1",
    });
  });

  it("hace 8 dias con 7: no hereda; justo en el borde (7 dias) si", () => {
    expect(inheritContent(outbound(daysAgo(8)), { origin_context: null }, NOW, 7)).toBeNull();
    expect(inheritContent(outbound(daysAgo(7)), { origin_context: null }, NOW, 7)).not.toBeNull();
    expect(inheritContent(outbound(new Date(NOW.getTime() - 7 * 86_400_000 - 1).toISOString()), { origin_context: null }, NOW, 7)).toBeNull();
  });

  it("respeta el numero de dias configurado", () => {
    expect(inheritContent(outbound(daysAgo(8)), { origin_context: null }, NOW, 30)).not.toBeNull();
    expect(inheritContent(outbound(daysAgo(2)), { origin_context: null }, NOW, 1)).toBeNull();
  });

  it("si el entrante trae un anuncio, gana el anuncio: no hereda", () => {
    const inbound = { origin_context: { ad: { platform: "instagram", ad_id: "123" } } };
    expect(inheritContent(outbound(daysAgo(1)), inbound, NOW, 7)).toBeNull();
  });

  it("si el entrante responde a una historia o la menciona: no hereda", () => {
    expect(inheritContent(outbound(daysAgo(1)), { origin_context: { story_reply: { story_id: "s-1" } } }, NOW, 7)).toBeNull();
    expect(inheritContent(outbound(daysAgo(1)), { origin_context: { story_mention: true } }, NOW, 7)).toBeNull();
  });

  it("un entrante que ya trae una pieza no se vuelve a heredar", () => {
    const inbound = { origin_context: { content: { content_post_id: "otra", via: "automation_reply" } } };
    expect(inheritContent(outbound(daysAgo(1)), inbound, NOW, 7)).toBeNull();
  });

  it("un mensaje citado solo NO es un origen propio", () => {
    expect(inheritContent(outbound(daysAgo(1)), { origin_context: { quoted_message_id: "wamid.1" } }, NOW, 7)).not.toBeNull();
  });

  it("sin saliente, o con un saliente sin pieza: null", () => {
    expect(inheritContent(null, { origin_context: null }, NOW, 7)).toBeNull();
    expect(inheritContent(undefined, { origin_context: null }, NOW, 7)).toBeNull();
    expect(inheritContent(outbound(daysAgo(1), null), { origin_context: null }, NOW, 7)).toBeNull();
    expect(inheritContent(outbound(daysAgo(1), {}), { origin_context: null }, NOW, 7)).toBeNull();
    expect(inheritContent(outbound(daysAgo(1), { via: "flow" }), { origin_context: null }, NOW, 7)).toBeNull();
  });

  it("alcanza con una sola de las dos: solo la publicacion, o solo la pieza", () => {
    expect(inheritContent(outbound(daysAgo(1), { social_post_id: POST_A }), { origin_context: null }, NOW, 7)).toMatchObject({ social_post_id: POST_A, content_post_id: null });
    expect(inheritContent(outbound(daysAgo(1), { content_post_id: PIECE_A }), { origin_context: null }, NOW, 7)).toMatchObject({ social_post_id: null, content_post_id: PIECE_A });
  });

  it("nunca lanza con datos rotos", () => {
    expect(inheritContent({ id: "x", created_at: "no-es-fecha", origin_context: { content: { content_post_id: PIECE_A } } }, { origin_context: null }, NOW, 7)).toBeNull();
    expect(inheritContent(outbound(daysAgo(1)), { origin_context: "texto" }, NOW, 7)).not.toBeNull();
    expect(inheritContent(outbound(daysAgo(1)), { origin_context: null }, new Date("x"), 7)).toBeNull();
    for (const days of [0, -1, NaN, Infinity]) {
      expect(inheritContent(outbound(daysAgo(1)), { origin_context: null }, NOW, days), String(days)).toBeNull();
    }
    expect(inheritContent({ id: "", created_at: daysAgo(1), origin_context: { content: { content_post_id: PIECE_A } } }, { origin_context: null }, NOW, 7)).toBeNull();
  });

  it("acepta una fecha como Date", () => {
    expect(inheritContent({ id: "o", created_at: new Date(NOW.getTime() - 3600_000), origin_context: { content: { content_post_id: PIECE_A } } }, { origin_context: null }, NOW, 7)).not.toBeNull();
  });
});

describe("hasOwnOrigin / readContentOrigin", () => {
  it("reconoce cada origen propio", () => {
    expect(hasOwnOrigin({ ad: { platform: "instagram" } })).toBe(true);
    expect(hasOwnOrigin({ story_reply: { story_id: "s" } })).toBe(true);
    expect(hasOwnOrigin({ story_mention: true })).toBe(true);
    expect(hasOwnOrigin({ content: { content_post_id: "c" } })).toBe(true);
    expect(hasOwnOrigin({ quoted_message_id: "q" })).toBe(false);
    expect(hasOwnOrigin(null)).toBe(false);
    expect(hasOwnOrigin("x")).toBe(false);
  });

  it("lee el content con sus campos recortados", () => {
    expect(readContentOrigin({ content: { social_post_id: " s ", content_post_id: " c ", via: "flow", flow_id: "f" } })).toEqual({
      social_post_id: "s",
      content_post_id: "c",
      via: "flow",
      flow_id: "f",
      outbound_message_id: null,
    });
    expect(readContentOrigin({ content: {} })).toBeNull();
    expect(readContentOrigin({})).toBeNull();
    expect(readContentOrigin(null)).toBeNull();
  });
});

describe("inheritDedupeKey", () => {
  it("una clave por mensaje de automatizacion", () => {
    expect(inheritDedupeKey("m-123")).toBe("content-reply:m-123");
  });
});
