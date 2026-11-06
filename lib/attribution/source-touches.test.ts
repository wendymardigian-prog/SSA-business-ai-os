import { describe, expect, it } from "vitest";
import { metaLinkFromAttribution, metaLinkFromTouch, metaLinkLine, type MatchTouchRow } from "./meta-link";
import { bookingTouchKey, formTouchKey, pickBookingTouch } from "./source-touches";

const touch = (over: Partial<MatchTouchRow> & { id: string }): MatchTouchRow => ({
  contact_id: "c",
  occurred_at: "2026-11-01T10:00:00Z",
  dedupe_key: null,
  meta_campaign_id: null,
  meta_adset_id: null,
  meta_ad_id: null,
  meta_match_status: "none",
  meta_match_method: null,
  meta_match_reason: null,
  ...over,
});
const NAMES = { campaigns: { c1: "Clase" }, adsets: { s1: "N6" }, ads: { a1: "N6 · 12 veces" } };

describe("las claves", () => {
  it("son las que usan el formulario y create_booking", () => {
    expect(formTouchKey("x")).toBe("form:x");
    expect(bookingTouchKey("x")).toBe("booking:x");
  });
});

describe("pickBookingTouch", () => {
  const linked = touch({ id: "previo", occurred_at: "2026-11-01T10:00:00Z", meta_campaign_id: "c1", meta_match_status: "matched" });
  const at = "2026-11-02T10:00:00Z";

  it("con vínculo propio, ese", () => {
    const own = touch({ id: "propio", meta_ad_id: "a1", meta_match_status: "matched" });
    expect(pickBookingTouch(own, [linked], at)).toEqual({ touch: own, ownTouchId: "propio", inherited: false });
  });

  it("sin toque propio (a mano o por el agente), el último anterior con vínculo", () => {
    expect(pickBookingTouch(null, [linked], at)).toEqual({ touch: linked, ownTouchId: null, inherited: true });
  });

  it("con un toque propio sin vínculo, el anterior, y recuerda el propio para poder vincularlo", () => {
    const own = touch({ id: "propio" });
    expect(pickBookingTouch(own, [linked], at)).toEqual({ touch: linked, ownTouchId: "propio", inherited: true });
  });

  it("no toma un toque posterior a la reunión", () => {
    const later = touch({ id: "despues", occurred_at: "2026-11-03T10:00:00Z", meta_campaign_id: "c1" });
    expect(pickBookingTouch(null, [later], at)).toEqual({ touch: null, ownTouchId: null, inherited: false });
  });

  it("un toque propio ignorado por una persona no busca otro", () => {
    const own = touch({ id: "propio", meta_match_status: "ignored" });
    expect(pickBookingTouch(own, [linked], at)).toEqual({ touch: own, ownTouchId: "propio", inherited: false });
  });

  it("sin nada, nada", () => {
    expect(pickBookingTouch(null, [], at)).toEqual({ touch: null, ownTouchId: null, inherited: false });
  });
});

describe("metaLinkFromTouch", () => {
  it("dice los nombres, el estado y cómo se vinculó", () => {
    const link = metaLinkFromTouch(touch({ id: "t", meta_campaign_id: "c1", meta_adset_id: "s1", meta_ad_id: "a1", meta_match_status: "matched", meta_match_method: "adset_single_ad" }), NAMES);
    expect(link).toMatchObject({ touchId: "t", statusLabel: "Vinculado", inherited: false, names: { campaign: "Clase", adset: "N6", ad: "N6 · 12 veces" } });
    expect(link.method).toContain("un solo anuncio");
    expect(metaLinkLine(link)).toBe("Clase › N6 › N6 · 12 veces");
  });

  it("sin permiso para ver el catálogo, los ids", () => {
    const link = metaLinkFromTouch(touch({ id: "t", meta_campaign_id: "c1", meta_match_status: "matched" }), { campaigns: {}, adsets: {}, ads: {} });
    expect(metaLinkLine(link)).toBe("Campaña c1");
  });

  it("uno heredado no actúa sobre el toque anterior: su objetivo es el propio", () => {
    const link = metaLinkFromTouch(touch({ id: "previo", meta_campaign_id: "c1", meta_match_status: "matched" }), NAMES, { inherited: true, ownTouchId: null });
    expect(link).toMatchObject({ touchId: null, inherited: true });
  });

  it("dice por qué no se pudo", () => {
    const link = metaLinkFromTouch(touch({ id: "t", meta_match_status: "unmatched", meta_match_reason: "name_without_id" }), NAMES);
    expect(link.statusLabel).toBe("Sin vincular");
    expect(link.reasons[0]).toContain("sin ningún id");
  });

  it("distingue lo que ignoró el sistema por ser orgánico de lo que ignoró una persona", () => {
    expect(metaLinkFromTouch(touch({ id: "t", meta_match_status: "ignored", meta_match_reason: "organic_content" }), NAMES).autoIgnored).toBe(true);
    expect(metaLinkFromTouch(touch({ id: "t", meta_match_status: "ignored" }), NAMES).autoIgnored).toBe(false);
  });
});

describe("metaLinkFromAttribution (una respuesta sin contacto)", () => {
  it("muestra los nombres de los ids de la URL y no tiene nada que cambiar", () => {
    const link = metaLinkFromAttribution({ utm_id: "120248421362650108" }, { campaigns: { "120248421362650108": "Clase" }, adsets: {}, ads: {} });
    expect(link).toMatchObject({ touchId: null, status: "none", statusLabel: "", names: { campaign: "Clase" } });
  });
});

describe("metaLinkLine", () => {
  it("sin vínculo queda vacía", () => {
    expect(metaLinkLine(null)).toBe("");
    expect(metaLinkLine(metaLinkFromTouch(touch({ id: "t" }), NAMES))).toBe("");
  });
});
