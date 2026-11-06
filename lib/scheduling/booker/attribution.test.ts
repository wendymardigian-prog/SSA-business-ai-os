import { describe, expect, it } from "vitest";
import { bookingUtmPayload, bookingAttribution, fillFromRequestCookies, type BookingAttributionInput } from "./attribution";
import { encodeAttr } from "@/lib/attribution/embed-attr";
import { encodeCookieValue } from "@/lib/attribution/browser";

const base = (over: Partial<BookingAttributionInput> = {}): BookingAttributionInput => ({
  params: new URLSearchParams(),
  isEmbed: false,
  referrer: "",
  href: "https://app.test/calendario/ana/llamada",
  cookieHeader: "",
  storedCookie: null,
  hostPageUrl: null,
  attrParam: null,
  ...over,
});

const stored = (last: Record<string, unknown>, first?: Record<string, unknown>) =>
  JSON.stringify({ v: 1, last: { ts: Date.now(), ...last }, ...(first ? { first: { ts: Date.now(), ...first } } : {}) });

describe("bookingAttribution (Extra L, F16)", () => {
  it("la URL con ad_id, adset_id, campaign_id y utm_id llega completa", () => {
    const a = bookingAttribution(base({ params: new URLSearchParams("ad_id=1&adset_id=2&campaign_id=3&utm_id=4&utm_source=fb") }));
    expect(a).toMatchObject({ ad_id: "1", adset_id: "2", campaign_id: "3", utm_id: "4", utm_source: "fb" });
  });

  it("sin nada en la URL y con la cookie ssa_attr: usa el último toque guardado (utm_campaign=x)", () => {
    const a = bookingAttribution(base({ storedCookie: stored({ utm_campaign: "x", landing_page: "https://landing.test/oferta" }) }));
    expect(a.utm_campaign).toBe("x");
    expect(a.landing_page).toBe("https://landing.test/oferta");
  });

  it("si la URL trae un toque nuevo, GANA la URL sobre la cookie", () => {
    const a = bookingAttribution(base({ params: new URLSearchParams("utm_campaign=nueva"), storedCookie: stored({ utm_campaign: "vieja" }) }));
    expect(a.utm_campaign).toBe("nueva");
  });

  it("la primera visita guardada viaja aparte en first_visit", () => {
    const a = bookingAttribution(base({ storedCookie: stored({ utm_campaign: "ultima" }, { utm_campaign: "primera" }) }));
    expect(a.utm_campaign).toBe("ultima");
    expect(a.first_visit).toMatchObject({ utm_campaign: "primera" });
  });

  it("las cookies de anuncios (_fbp, _fbc) se suman siempre", () => {
    const a = bookingAttribution(base({ cookieHeader: "_fbp=fb.1.2.3; _fbc=fb.1.2.4", storedCookie: stored({ utm_source: "fb" }) }));
    expect(a).toMatchObject({ fbp: "fb.1.2.3", fbc: "fb.1.2.4", utm_source: "fb" });
  });

  it("en un embed usa lo que mandó la web anfitriona (attr), no la cookie del iframe", () => {
    const attr = encodeAttr({ utm_source: "meta", ad_id: "77", fbp: "fb.9", first_visit: { ts: 1, utm_campaign: "oct" } })!;
    const a = bookingAttribution(base({ isEmbed: true, attrParam: attr, storedCookie: stored({ utm_source: "otra" }), hostPageUrl: "https://cliente.com/landing" }));
    expect(a).toMatchObject({ utm_source: "meta", ad_id: "77", fbp: "fb.9" });
    expect(a.first_visit).toMatchObject({ utm_campaign: "oct" });
  });

  it("en un embed sin attr ni parámetros no inventa nada de atribución", () => {
    const a = bookingAttribution(base({ isEmbed: true, hostPageUrl: "https://cliente.com/landing" }));
    for (const key of ["utm_source", "ad_id", "first_visit"]) expect(a).not.toHaveProperty(key);
  });

  it("un attr roto o una cookie rota no lanzan", () => {
    expect(() => bookingAttribution(base({ isEmbed: true, attrParam: "%%%no-es-base64" }))).not.toThrow();
    expect(() => bookingAttribution(base({ storedCookie: "{roto" }))).not.toThrow();
    expect(bookingAttribution(base({ isEmbed: true, attrParam: "%%%" }))).toBeTruthy();
  });

  it("encodeCookieValue existe para el navegador (la cookie viaja en base64url)", () => {
    expect(typeof encodeCookieValue({ v: 1 })).toBe("string");
  });
});

describe("fillFromRequestCookies", () => {
  it("completa fbp, fbc y ga_client_id desde las cookies del pedido si no vinieron", () => {
    const out = fillFromRequestCookies({ utm_source: "fb" }, "_fbp=fb.1.2.3; _fbc=fb.1.2.4; _ga=GA1.2.111.222");
    expect(out).toMatchObject({ utm_source: "fb", fbp: "fb.1.2.3", fbc: "fb.1.2.4", ga_client_id: "111.222" });
  });

  it("no pisa lo que el navegador ya mandó", () => {
    expect(fillFromRequestCookies({ fbp: "del-navegador" }, "_fbp=de-la-cookie").fbp).toBe("del-navegador");
  });

  it("sin cookies, no cambia nada", () => {
    expect(fillFromRequestCookies({ a: "1" }, null)).toEqual({ a: "1" });
    expect(fillFromRequestCookies({ a: "1" }, "")).toEqual({ a: "1" });
  });
});

describe("el embed de la Agenda con un anuncio (00299)", () => {
  const attr = encodeAttr({ referrer_url: "https://l.facebook.com/", utm_source: "meta", ad_id: "123" });

  it("guarda el referrer real, no la página que contiene la agenda", () => {
    const out = bookingAttribution({
      params: { utm_source: "meta", ad_id: "123" },
      isEmbed: true,
      referrer: "",
      href: "https://app.test/calendario/ana/llamada?embed=1",
      cookieHeader: "",
      storedCookie: null,
      hostPageUrl: "https://web.test/landing",
      attrParam: attr,
    });
    expect(out.referrer_url).toBe("https://l.facebook.com/");
    expect(out.ad_id).toBe("123");
    expect(out.page_url).toBe("https://web.test/landing");
  });
});

describe("bookingUtmPayload", () => {
  it("suma la página de llegada y la del envío, saneadas, a lo que ya dejó pickUtm", () => {
    const out = bookingUtmPayload({ utm_source: "meta" }, { page_url: "https://web.test/a?token=x" }, "https://web.test/a?utm_source=meta&token=x");
    expect(out).toEqual({ utm_source: "meta", landing_page: "https://web.test/a?utm_source=meta", page_url: "https://web.test/a" });
  });

  it("sin páginas, lo mismo que entró", () => {
    expect(bookingUtmPayload({ utm_source: "meta" }, {}, undefined)).toEqual({ utm_source: "meta" });
    expect(bookingUtmPayload({}, { page_url: "javascript:alert(1)" }, "no es una url")).toEqual({});
  });
});
