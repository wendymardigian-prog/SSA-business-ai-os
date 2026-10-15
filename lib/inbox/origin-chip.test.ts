import { describe, expect, it } from "vitest";
import { originChipViews, originRefsFor, shortTitle, formatWord, type OriginLookup } from "./origin-chip";
import { pieceHref } from "@/lib/contacts/attribution-view";
import { adDetailHref } from "@/lib/meta/content-ad-summary";

const lookup = (over: Partial<OriginLookup> = {}): OriginLookup => ({
  pieces: new Map([["p1", { title: "3 errores que cometes al cobrar y que te cuestan clientes", format: "Reel" }]]),
  socialPosts: new Map([
    ["s1", { contentPostId: "p1", caption: "caption", mediaType: "reel" }],
    ["s2", { contentPostId: null, caption: "Una publicación externa muy interesante sobre ventas", mediaType: "carousel" }],
  ]),
  ads: new Map([["ad1", { adAccountId: "act_9", name: "Video testimonio (catálogo)" }]]),
  ...over,
});

const inbound = (id: string, origin_context: unknown) => ({ id, direction: "inbound" as const, origin_context });
const outbound = (id: string) => ({ id, direction: "outbound" as const, origin_context: null });

describe("chip «Vino de…» (F44)", () => {
  it("una pieza: 'Vino de: Reel «titulo…»' con link al drawer de la pieza", () => {
    const views = originChipViews([inbound("m1", { content: { content_post_id: "p1", via: "automation_reply" } })], lookup(), { canSeeAds: false });
    expect(views.m1.text).toBe("Vino de: Reel «3 errores que cometes al cobrar y que…»");
    expect(views.m1.text.length).toBeLessThan(70);
    expect(views.m1.href).toBe(pieceHref("p1"));
  });

  it("por la publicacion: usa la pieza de la publicacion; sin pieza, el texto y el tipo", () => {
    const withPiece = originChipViews([inbound("m1", { content: { social_post_id: "s1" } })], lookup(), { canSeeAds: false });
    expect(withPiece.m1.href).toBe(pieceHref("p1"));
    const external = originChipViews([inbound("m2", { content: { social_post_id: "s2" } })], lookup(), { canSeeAds: false });
    expect(external.m2.text).toBe("Vino de: Carrusel «Una publicación externa muy…»");
    expect(external.m2.href).toBeNull();
  });

  it("una pieza que ya no existe: sin link y con el titulo que guardo el mensaje", () => {
    const views = originChipViews(
      [inbound("m1", { content: { content_post_id: "borrada", title: "Mi reel viejo" } })],
      lookup({ pieces: new Map() }),
      { canSeeAds: false },
    );
    expect(views.m1.text).toBe("Vino de: Publicación «Mi reel viejo»");
    expect(views.m1.href).toBeNull();
  });

  it("anuncio: el link al detalle SOLO con dashboards.ads.view", () => {
    const ctx = { ad: { ad_id: "ad1", title: "Video testimonio", platform: "instagram" } };
    const sin = originChipViews([inbound("m1", ctx)], lookup(), { canSeeAds: false });
    expect(sin.m1).toMatchObject({ text: "Anuncio «Video testimonio»", href: null });
    const con = originChipViews([inbound("m1", ctx)], lookup(), { canSeeAds: true });
    expect(con.m1.href).toBe(adDetailHref("ad1", "act_9"));
  });

  it("anuncio sin titulo en el mensaje: el nombre del catalogo solo si puede ver anuncios", () => {
    const ctx = { ad: { ad_id: "ad1", platform: "instagram" } };
    expect(originChipViews([inbound("m1", ctx)], lookup(), { canSeeAds: false }).m1.text).toBe("Anuncio");
    expect(originChipViews([inbound("m1", ctx)], lookup(), { canSeeAds: true }).m1.text).toBe("Anuncio «Video testimonio (catálogo)»");
  });

  it("anuncio que no esta en el catalogo: chip sin link", () => {
    const views = originChipViews([inbound("m1", { ad: { ad_id: "otro", title: "X", platform: "instagram" } })], lookup(), { canSeeAds: true });
    expect(views.m1.href).toBeNull();
  });

  it("historias: respuesta y mencion", () => {
    const views = originChipViews(
      [inbound("m1", { story_reply: { story_id: "st1" } }), outbound("o1"), inbound("m2", { story_mention: true })],
      lookup(),
      { canSeeAds: false },
    );
    expect(views.m1).toMatchObject({ kind: "story", text: "Respuesta a tu historia", href: null });
    expect(views.m2).toMatchObject({ kind: "mention", text: "Te mencionó en una historia" });
  });

  it("una historia nuestra linkea a su pieza", () => {
    const views = originChipViews([inbound("m1", { story_reply: { story_id: "st1", content_post_id: "p1" } })], lookup(), { canSeeAds: false });
    expect(views.m1.href).toBe(pieceHref("p1"));
  });

  it("no se repite en mensajes seguidos con el mismo origen y un mensaje sin origen no lleva chip", () => {
    const ctx = { content: { content_post_id: "p1" } };
    const views = originChipViews(
      [inbound("m1", ctx), outbound("o1"), inbound("m2", ctx), inbound("m3", ctx), inbound("m4", null), inbound("m5", ctx)],
      lookup(),
      { canSeeAds: false },
    );
    expect(Object.keys(views)).toEqual(["m1", "m5"]);
  });

  it("los mensajes salientes nunca llevan chip", () => {
    const views = originChipViews([{ id: "o1", direction: "outbound", origin_context: { content: { content_post_id: "p1" } } }], lookup(), { canSeeAds: true });
    expect(views).toEqual({});
  });

  it("un contexto roto no lanza", () => {
    const views = originChipViews([inbound("m1", 42), inbound("m2", { ad: "x" }), inbound("m3", { content: { content_post_id: 7 } })], lookup(), { canSeeAds: true });
    expect(views.m1).toBeUndefined();
  });
});

describe("originRefsFor", () => {
  it("pide solo lo que usan los chips que se van a dibujar", () => {
    const ctx = { content: { content_post_id: "p1", social_post_id: "s1" } };
    const refs = originRefsFor([
      inbound("m1", ctx),
      inbound("m2", ctx), // mismo origen seguido: no lleva chip
      inbound("m3", { ad: { ad_id: "ad1", platform: "instagram" } }),
      inbound("m4", null),
    ]);
    expect(refs).toEqual({ contentPostIds: ["p1"], socialPostIds: ["s1"], adIds: ["ad1"] });
  });

  it("sin origen no hay nada que buscar", () => {
    expect(originRefsFor([inbound("m1", null), outbound("o1")])).toEqual({ contentPostIds: [], socialPostIds: [], adIds: [] });
  });
});

describe("helpers", () => {
  it("shortTitle corta sin partir palabras y no toca lo corto", () => {
    expect(shortTitle("Hola")).toBe("Hola");
    expect(shortTitle("  ")).toBeNull();
    expect(shortTitle(null)).toBeNull();
    expect(shortTitle("a".repeat(100))!.length).toBe(40);
  });
  it("formatWord: el formato de la pieza gana al tipo de la publicacion", () => {
    expect(formatWord("reel", "carousel")).toBe("Reel");
    expect(formatWord(null, "carousel")).toBe("Carrusel");
    expect(formatWord(null, null)).toBeNull();
  });
});
