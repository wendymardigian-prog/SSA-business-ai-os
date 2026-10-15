import { describe, expect, it } from "vitest";
import { saleAttributionView, touchReferences, type ViewAd, type ViewPiece, type ViewPublication, type ViewSale, type ViewTouch } from "./attribution-view";

const touch = (over: Partial<ViewTouch> = {}): ViewTouch => ({
  id: "t1",
  occurred_at: "2026-10-03T15:00:00Z",
  channel: null,
  source: null,
  medium: null,
  campaign: null,
  content_label: null,
  content_post_id: null,
  social_post_id: null,
  ad_id: null,
  adset_id: null,
  campaign_id: null,
  ...over,
});
const sale = (over: Partial<ViewSale> = {}): ViewSale => ({ attribution_type: "manual", attribution: null, attribution_touch_id: "t1", ...over });

const LEO = { id: "u1", name: "Leo Pérez" };

describe("saleAttributionView: orgánico con pieza", () => {
  const piece: ViewPiece = { id: "p1", title: "Reel: 3 errores al cobrar", assignee: LEO };
  const publication: ViewPublication = { id: "s1", platform: "instagram", assignee: null };

  it("título de la pieza con link al drawer, la red y su responsable", () => {
    const view = saleAttributionView(sale(), touch({ channel: "organic", source: "instagram", medium: "organic_social", content_post_id: "p1", social_post_id: "s1" }), piece, publication, null);
    expect(view).toMatchObject({
      channel: "organic",
      channelLabel: "Orgánico",
      unidentified: false,
      summary: "Reel: 3 errores al cobrar · Instagram",
      piece: { title: "Reel: 3 errores al cobrar", network: "Instagram", responsible: LEO },
    });
    expect(view.piece?.href).toContain("piece=p1");
    expect(view.ad).toBeNull();
  });

  it("sin pieza identificada lo dice y no inventa un link", () => {
    const view = saleAttributionView(sale(), touch({ channel: "organic", source: "tiktok", medium: "organic_social" }), null, null, null);
    expect(view.summary).toBe("Pieza sin identificar · TikTok");
    expect(view.piece).toMatchObject({ title: null, href: null, responsible: null });
  });

  it("una publicación sin pieza usa su propio responsable", () => {
    const view = saleAttributionView(sale(), touch({ channel: "organic", source: "instagram", social_post_id: "s1" }), null, { id: "s1", platform: "instagram", assignee: LEO }, null);
    expect(view.piece?.responsible).toEqual(LEO);
  });

  it("el código de la pieza no se muestra como título", () => {
    const view = saleAttributionView(sale(), touch({ channel: "organic", source: "instagram", content_label: "cabc23" }), null, null, null);
    expect(view.piece?.title).toBeNull();
  });
});

describe("saleAttributionView: pauta", () => {
  const ad: ViewAd = { adId: "33", adAccountId: "act_9", campaignName: "Octubre", adsetName: "Lookalike", adName: "Video 1", thumbnailUrl: "https://x.test/t.png" };
  const t = touch({ channel: "paid", source: "facebook", medium: "paid_social", meta_ad_id: "33", meta_adset_id: "22", meta_campaign_id: "11" });

  it("campaña › conjunto › anuncio con la miniatura", () => {
    const view = saleAttributionView(sale(), t, null, null, ad);
    expect(view).toMatchObject({ channel: "paid", channelLabel: "Pauta", summary: "Video 1" });
    expect(view.ad).toMatchObject({ path: ["Octubre", "Lookalike", "Video 1"], thumbnailUrl: "https://x.test/t.png", href: null });
  });

  it("el link al detalle del anuncio solo con dashboards.ads.view", () => {
    expect(saleAttributionView(sale(), t, null, null, ad, { canViewAds: false }).ad?.href).toBeNull();
    expect(saleAttributionView(sale(), t, null, null, ad, { canViewAds: true }).ad?.href).toBe("/dashboard/dashboards/ads/ads/33?cuenta=act_9");
  });

  it("sin catálogo (o sin permiso para verlo) se muestran los ids, sin inventar nombres", () => {
    const view = saleAttributionView(sale(), t, null, null, null);
    expect(view.ad?.path).toEqual(["Campaña 11", "Conjunto 22", "Anuncio 33"]);
  });

  it("solo la red: «sin anuncio identificado»", () => {
    const view = saleAttributionView(sale(), touch({ channel: "paid", source: "instagram", medium: "paid_social" }), null, null, null);
    expect(view.ad?.path).toEqual([]);
    expect(view.note).toBe("Instagram, sin anuncio identificado");
  });
});

describe("saleAttributionView: referido", () => {
  it("quién lo recomendó, con link si es un contacto", () => {
    const t = touch({ channel: "referral", source: "referral", medium: "referral_person", raw: { referrer_contact_id: "0f0f0f0f-0000-4000-8000-000000000001" } });
    const view = saleAttributionView(sale(), t, null, null, null, { referrer: { type: "contact", id: "c9", name: "Ana Gómez" } });
    expect(view).toMatchObject({ channel: "referral", channelLabel: "Referido", summary: "Referido por Ana Gómez", referrer: { name: "Ana Gómez", href: "/dashboard/contacts/c9", kind: "contact" } });
  });

  it("una persona del equipo no lleva a ninguna ficha de contacto", () => {
    const view = saleAttributionView(sale(), touch({ channel: "referral", medium: "referral_person" }), null, null, null, { referrer: { type: "member", id: "u1", name: "Leo" } });
    expect(view.referrer).toMatchObject({ name: "Leo", href: null, kind: "member" });
  });

  it("si no se puede saber quién, lo dice sin inventar", () => {
    const view = saleAttributionView(sale(), touch({ channel: "referral", medium: "referral_person" }), null, null, null);
    expect(view.summary).toBe("Referido");
    expect(view.referrer).toBeNull();
  });
});

describe("saleAttributionView: directo y sin atribución", () => {
  it("un mensaje directo es «Sin origen identificado»", () => {
    const view = saleAttributionView(sale(), touch({ channel: "direct", source: "whatsapp", medium: "dm" }), null, null, null);
    expect(view).toMatchObject({ channel: "direct", channelLabel: "Directo", unidentified: true, summary: "Sin origen identificado", note: "WhatsApp · mensaje directo" });
  });

  it("un evento cargado a mano conserva su nombre", () => {
    const view = saleAttributionView(sale(), touch({ channel: "direct", source: "manual", medium: "event", campaign: "Expo 2026" }), null, null, null);
    expect(view.unidentified).toBe(true);
    expect(view.note).toBe("Evento o llamada en frío: Expo 2026");
  });

  it("una venta sin toque ni copia no tiene ningún canal", () => {
    const view = saleAttributionView({ attribution_type: "none", attribution: null, attribution_touch_id: null }, null, null, null, null);
    expect(view).toMatchObject({ channel: null, channelLabel: "Sin origen", unidentified: true, summary: "Sin origen identificado" });
  });

  it("una venta vieja sin toque usa su copia congelada para el canal", () => {
    const view = saleAttributionView({ attribution_type: "last_touch", attribution: { source: "instagram", medium: "paid_social", ad_id: "5" }, attribution_touch_id: null }, null, null, null, null);
    expect(view.channel).toBe("paid");
    expect(view.ad?.path).toEqual(["Anuncio 5"]);
  });

  it("un toque sin canal guardado lo calcula", () => {
    expect(saleAttributionView(sale(), touch({ source: "instagram", medium: "organic_social" }), null, null, null).channel).toBe("organic");
  });
});

describe("touchReferences", () => {
  it("lee los ids del toque y del raw (solo UUID válidos)", () => {
    const refs = touchReferences(touch({ content_post_id: "p1", social_post_id: "s1", meta_ad_id: "33", raw: { referrer_user_id: "0f0f0f0f-0000-4000-8000-000000000002", referrer_contact_id: "no-uuid" } }));
    expect(refs).toMatchObject({ pieceId: "p1", publicationId: "s1", adId: "33", referrerUserId: "0f0f0f0f-0000-4000-8000-000000000002", referrerContactId: null });
  });
});
