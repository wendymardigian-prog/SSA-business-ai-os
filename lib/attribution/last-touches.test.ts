import { describe, expect, it } from "vitest";
import { attributionColumnDefs, LAST_CLICK_COLUMN_KEY } from "./columns";
import { groupLastTouches, lastClickLine, NO_LAST_TOUCH_NAMES, toTouchView, type LastTouchRow } from "./last-touches";

function row(over: Partial<LastTouchRow> = {}): LastTouchRow {
  return {
    booking_id: "b1",
    touch_rank: 1,
    touch_id: "t1",
    occurred_at: "2026-11-09T20:00:00Z",
    source: "instagram",
    medium: "dm",
    campaign: null,
    content_label: null,
    term: null,
    origin: "dm",
    channel: "organic",
    social_post_id: null,
    content_post_id: null,
    ad_id: null,
    adset_id: null,
    campaign_id: null,
    meta_campaign_id: null,
    meta_adset_id: null,
    meta_ad_id: null,
    meta_match_status: "none",
    entry_url: null,
    ...over,
  };
}

describe("toTouchView", () => {
  it("un mensaje directo es organico y se nombra por de donde vino", () => {
    const view = toTouchView(row(), NO_LAST_TOUCH_NAMES);
    expect(view.channel).toBe("organic");
    expect(view.kind).toBe("other");
    expect(view.title).toContain("Instagram");
    expect(view.originLabel).toBe("Mensaje directo");
  });

  it("un anuncio de Meta se nombra por el anuncio y lleva su miniatura", () => {
    const view = toTouchView(
      row({ channel: "paid", origin: "booking", source: "facebook", meta_ad_id: "123", meta_match_status: "matched" }),
      { pieces: {}, ads: { "123": "N3 · Usar no paga" }, adThumbnails: { "123": "https://x/y.png" } },
    );
    expect(view.kind).toBe("ad");
    expect(view.channel).toBe("paid");
    expect(view.title).toBe("N3 · Usar no paga");
    expect(view.thumbnailUrl).toBe("https://x/y.png");
    expect(view.adId).toBe("123");
  });

  it("una pieza organica se nombra por su titulo", () => {
    const view = toTouchView(row({ content_post_id: "p1", origin: "link_click" }), { pieces: { p1: "Reel: 3 errores" }, ads: {}, adThumbnails: {} });
    expect(view.kind).toBe("piece");
    expect(view.title).toBe("Reel: 3 errores");
    expect(view.pieceId).toBe("p1");
  });

  it("sin miniatura (sin permiso para ver anuncios) no inventa una", () => {
    const view = toTouchView(row({ meta_ad_id: "9", channel: "paid" }), NO_LAST_TOUCH_NAMES);
    expect(view.thumbnailUrl).toBeNull();
  });

  it("un toque viejo sin canal guardado lo calcula", () => {
    const view = toTouchView(row({ channel: null, ad_id: "55" }), NO_LAST_TOUCH_NAMES);
    expect(view.channel).toBe("paid");
  });
});

describe("groupLastTouches", () => {
  it("agrupa por reunion, deja primero el mas reciente y recorta a tres", () => {
    const rows = [
      row({ booking_id: "b2", touch_id: "x", touch_rank: 1 }),
      row({ touch_id: "c", touch_rank: 3 }),
      row({ touch_id: "a", touch_rank: 1 }),
      row({ touch_id: "b", touch_rank: 2 }),
      row({ touch_id: "d", touch_rank: 4 }),
    ];
    const grouped = groupLastTouches(rows, NO_LAST_TOUCH_NAMES);
    expect(grouped.b1.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(grouped.b2.map((t) => t.id)).toEqual(["x"]);
  });

  it("sin filas no hay nada", () => {
    expect(groupLastTouches([], NO_LAST_TOUCH_NAMES)).toEqual({});
  });
});

describe("lastClickLine", () => {
  it("es vacia sin toques y usa el titulo del primero", () => {
    expect(lastClickLine(undefined)).toBe("");
    expect(lastClickLine([])).toBe("");
    const [view] = [toTouchView(row({ content_post_id: "p1" }), { pieces: { p1: "Reel" }, ads: {}, adThumbnails: {} })];
    expect(lastClickLine([view])).toBe("Reel");
  });
});

describe("la columna «Último click»", () => {
  it("solo existe cuando se pide (la tabla de respuestas de formularios no la lleva)", () => {
    expect(attributionColumnDefs(new Set()).some((d) => d.key === LAST_CLICK_COLUMN_KEY)).toBe(false);
    const defs = attributionColumnDefs(new Set([LAST_CLICK_COLUMN_KEY]), { lastClick: true });
    const def = defs.find((d) => d.key === LAST_CLICK_COLUMN_KEY);
    expect(def).toBeDefined();
    expect(def?.defaultVisible).toBe(true);
    expect(defs[0].key).toBe(LAST_CLICK_COLUMN_KEY);
    expect(def?.value({ attribution: {}, metaNames: { campaign: null, adset: null, ad: null } })).toBe("");
  });
});
