import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attributionFromContact, attributionFromTouch, describeAttribution, latestTouch, manualAttribution, relativeDays, resolveSaleAttribution, type TouchRow } from "./attribution";

const touch = (over: Partial<TouchRow> & { id: string; occurred_at: string }): TouchRow => ({
  source: null, medium: null, campaign: null, content_label: null, term: null, ad_id: null, adset_id: null, campaign_id: null,
  fbclid: null, gclid: null, ttclid: null, li_fat_id: null, ctwa_clid: null, referrer_url: null, landing_page: null, raw: {}, ...over,
});

const google = touch({ id: "t1", occurred_at: "2026-10-01T15:00:00Z", source: "google" });
const instagram = touch({ id: "t2", occurred_at: "2026-10-07T15:00:00Z", source: "instagram", medium: "paid_social", campaign: "octubre", ad_id: "123" });

describe("resolveSaleAttribution", () => {
  it("last_touch toma el toque más reciente, con su touch_id", () => {
    const r = resolveSaleAttribution({ mode: "last_touch" }, { attribution: null }, [google, instagram]);
    expect(r).toMatchObject({ ok: true, attribution_touch_id: "t2", attribution_type: "last_touch" });
    expect(r.ok && r.attribution).toMatchObject({ source: "instagram", medium: "paid_social", campaign: "octubre", ad_id: "123", touch_id: "t2" });
  });

  it("elegir otro toque del historial → manual, con su touch_id", () => {
    const r = resolveSaleAttribution({ mode: "touch", touchId: "t1" }, { attribution: null }, [google, instagram]);
    expect(r).toMatchObject({ ok: true, attribution_touch_id: "t1", attribution_type: "manual" });
    expect(r.ok && r.attribution?.source).toBe("google");
  });

  it("un toque de otro contacto se rechaza (invalid_touch)", () => {
    const r = resolveSaleAttribution({ mode: "touch", touchId: "ajeno" }, { attribution: null }, [google]);
    expect(r).toMatchObject({ ok: false, code: "invalid_touch" });
  });

  it("sin toques ni atribución: none, null, sin bloquear", () => {
    expect(resolveSaleAttribution({ mode: "last_touch" }, { attribution: null }, [])).toEqual({
      ok: true, attribution: null, attribution_touch_id: null, attribution_type: "none",
    });
  });

  it("sin filas pero con contacts.attribution en la forma vieja, usa lo que devuelve readAttribution (nunca utm_*)", () => {
    const viejo = { first_click: { utm_source: "ig", utm_campaign: "vieja" } };
    const r = resolveSaleAttribution({ mode: "last_touch" }, { attribution: viejo }, []);
    expect(r).toMatchObject({ ok: true, attribution_touch_id: null, attribution_type: "last_touch" });
    expect(r.ok && r.attribution).toMatchObject({ source: "instagram", campaign: "vieja" });
    expect(r.ok && Object.keys(r.attribution!)).not.toContain("utm_source");
    expect(attributionFromContact({ attribution: viejo })).toMatchObject({ source: "instagram" });
  });

  it("manual válido guarda lo cargado y es de tipo manual", () => {
    const r = resolveSaleAttribution({ mode: "manual", manual: { source: "instagram", medium: "paid_social", campaign: " octubre " } }, { attribution: null }, []);
    expect(r).toMatchObject({ ok: true, attribution_type: "manual", attribution_touch_id: null });
    expect(r.ok && r.attribution).toEqual({ source: "instagram", medium: "paid_social", campaign: "octubre" });
  });

  it("manual inválido se rechaza", () => {
    expect(resolveSaleAttribution({ mode: "manual", manual: { source: "facebook" } }, { attribution: null }, [])).toMatchObject({ ok: false, code: "invalid_manual" });
  });
});

describe("manualAttribution", () => {
  it("la fuente tiene que ser de la taxonomía cerrada y recorta los libres", () => {
    expect(manualAttribution({ source: "facebook" })).toMatchObject({ ok: false });
    expect(manualAttribution({ source: "instagram", medium: "paid_social", campaign: " octubre " })).toEqual({
      ok: true, attribution: { source: "instagram", medium: "paid_social", campaign: "octubre" },
    });
  });
  it("un medio que no es de la lista se rechaza, y uno vacío se omite", () => {
    expect(manualAttribution({ source: "web", medium: "inventado" })).toMatchObject({ ok: false });
    expect(manualAttribution({ source: "web", medium: "" })).toEqual({ ok: true, attribution: { source: "web" } });
  });
  it("conserva el touch_id de origen si se editó a partir de un toque", () => {
    expect(manualAttribution({ source: "google", touch_id: "t1", campaign: "x" })).toMatchObject({ ok: true, attribution: { touch_id: "t1" } });
  });
});

describe("attributionFromTouch", () => {
  it("mapea content_label → content y omite los vacíos", () => {
    const a = attributionFromTouch(touch({ id: "t3", occurred_at: "2026-10-02T00:00:00Z", source: "instagram", content_label: "Reel de la mentoría", campaign: "  " }));
    expect(a).toEqual({ touch_id: "t3", occurred_at: "2026-10-02T00:00:00Z", source: "instagram", content: "Reel de la mentoría" });
  });

  it("conserva en extras solo las claves conocidas de raw", () => {
    const a = attributionFromTouch(touch({ id: "t4", occurred_at: "2026-10-02T00:00:00Z", raw: { msclkid: "m1", fbc: "fb.1.1.x", foo: "z", gbraid: "" } }));
    expect(a.extras).toEqual({ msclkid: "m1", fbc: "fb.1.1.x" });
  });

  it("sin extras no escribe la clave", () => {
    expect("extras" in attributionFromTouch(touch({ id: "t5", occurred_at: "2026-10-02T00:00:00Z", raw: {} }))).toBe(false);
  });
});

describe("latestTouch", () => {
  it("el más reciente; si empatan, el de mayor id", () => {
    expect(latestTouch([google, instagram])?.id).toBe("t2");
    const a = touch({ id: "a", occurred_at: "2026-10-01T00:00:00Z" });
    const b = touch({ id: "b", occurred_at: "2026-10-01T00:00:00Z" });
    expect(latestTouch([a, b])?.id).toBe("b");
    expect(latestTouch([])).toBeNull();
  });
});

describe("describeAttribution", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("none dice 'Sin atribución'", () => {
    expect(describeAttribution(null, new Date(), "UTC")).toBe("Sin atribución");
  });

  it("con el reloj fijado dice 'hace 3 días'", () => {
    vi.setSystemTime(new Date("2026-10-10T18:00:00Z"));
    const a = attributionFromTouch(instagram);
    const line = describeAttribution(a, new Date(), "America/Costa_Rica");
    expect(line).toBe("Instagram / anuncio / campaña octubre / anuncio 123 (hace 3 días)");
  });

  it("los días son de calendario en la zona del workspace", () => {
    // 01:00 UTC del 8/10 todavía es el 7/10 en Costa Rica (UTC-6).
    expect(relativeDays("2026-10-08T01:00:00Z", new Date("2026-10-08T12:00:00Z"), "America/Costa_Rica")).toBe("ayer");
    expect(relativeDays("2026-10-08T01:00:00Z", new Date("2026-10-08T12:00:00Z"), "UTC")).toBe("hoy");
    expect(relativeDays("2026-08-01T12:00:00Z", new Date("2026-10-08T12:00:00Z"), "UTC")).toBe("hace 2 meses");
  });
});
