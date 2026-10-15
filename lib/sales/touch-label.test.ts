import { describe, expect, it } from "vitest";
import { channelOfTouch, shortDayMonth, touchTitle } from "./touch-label";

const base = { occurred_at: "2026-10-03T15:00:00Z" };

describe("touchTitle", () => {
  it("prefiere el título de la pieza, después lo que dice el toque, el anuncio y la campaña", () => {
    expect(touchTitle({ ...base, content_post_id: "p1", content_label: "x" }, { pieces: { p1: "Reel A" }, ads: {} })).toBe("Reel A");
    expect(touchTitle({ ...base, content_label: "Reel B" })).toBe("Reel B");
    expect(touchTitle({ ...base, meta_ad_id: "9", ad_id: "8" }, { pieces: {}, ads: { 9: "Anuncio nueve" } })).toBe("Anuncio nueve");
    expect(touchTitle({ ...base, campaign: "Octubre" })).toBe("Octubre");
  });

  it("un código de pieza no se muestra como si fuera un título", () => {
    expect(touchTitle({ ...base, content_label: "cabc23", source: "instagram", medium: "dm_link" })).toBe("Instagram · link de un mensaje");
  });

  it("sin nada dice 'Sin datos'", () => {
    expect(touchTitle({ ...base })).toBe("Sin datos");
  });
});

describe("channelOfTouch", () => {
  it("usa el canal guardado; si falta, lo calcula", () => {
    expect(channelOfTouch({ channel: "referral" })).toBe("referral");
    expect(channelOfTouch({ channel: null, medium: "paid_social" })).toBe("paid");
    expect(channelOfTouch({ medium: "event" })).toBe("direct");
  });
});

describe("shortDayMonth", () => {
  it("día/mes en la zona del negocio", () => {
    expect(shortDayMonth("2026-10-03T15:00:00Z", "America/Argentina/Buenos_Aires")).toBe("3/10");
    expect(shortDayMonth("2026-10-04T01:00:00Z", "America/Argentina/Buenos_Aires")).toBe("3/10");
  });
});
