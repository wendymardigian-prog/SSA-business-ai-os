import { describe, it, expect } from "vitest";
import {
  attributionFromParams,
  gaClientId,
  hasTouchKeys,
  landingFromUrl,
  pageUrlFromUrl,
  parseCookieHeader,
} from "./collect";
import { safeReferrer } from "@/lib/scheduling/antispam";

describe("attributionFromParams", () => {
  it("devuelve lo que vino y nada inventado", () => {
    expect(attributionFromParams({ utm_source: "facebook", ad_id: "123", utm_campaign: "octubre" })).toEqual({
      utm_source: "facebook",
      ad_id: "123",
      utm_campaign: "octubre",
    });
  });

  it("arma fbc con el formato de Meta cuando hay fbclid y no hay cookie", () => {
    const out = attributionFromParams({ fbclid: "abc" }, { now: 1760000000000 });
    expect(out.fbclid).toBe("abc");
    expect(out.fbc).toBe("fb.1.1760000000000.abc");
  });

  it("respeta la cookie _fbc si existe", () => {
    const out = attributionFromParams({ fbclid: "abc" }, { cookies: { _fbc: "fb.1.1.zzz" }, now: 5 });
    expect(out.fbc).toBe("fb.1.1.zzz");
  });

  it("reconoce msclkid, gbraid y ScCid (este como sccid)", () => {
    const out = attributionFromParams(new URLSearchParams("msclkid=m1&gbraid=g1&ScCid=s1"));
    expect(out).toMatchObject({ msclkid: "m1", gbraid: "g1", sccid: "s1" });
  });

  it("toma fbp y el id de GA de las cookies, nunca de la URL", () => {
    const out = attributionFromParams(
      { fbp: "falso", ga_client_id: "falso", fbc: "falso" },
      { cookies: { _fbp: "fb.1.1.2", _ga: "GA1.1.111.222" } },
    );
    expect(out.fbp).toBe("fb.1.1.2");
    expect(out.ga_client_id).toBe("111.222");
    expect(out.fbc).toBeUndefined();
  });

  it("ignora claves ajenas y datos personales en la URL", () => {
    const out = attributionFromParams({ email: "ana@x.com", password: "x", token: "y", utm_medium: "cpc" });
    expect(out).toEqual({ utm_medium: "cpc" });
  });

  it("recorta cada valor a 200 caracteres y limpia caracteres de control", () => {
    const out = attributionFromParams({ utm_source: "a".repeat(300), utm_term: "x\u0000y" });
    expect(out.utm_source).toHaveLength(200);
    expect(out.utm_term).toBe("xy");
  });

  it("referrer, página de llegada y página del formulario", () => {
    const out = attributionFromParams(
      { utm_source: "meta" },
      {
        referrer: "https://www.google.com/search?q=secreto",
        landing: "https://sitio.test/promo?utm_source=meta&email=ana@x.com#h",
        pageUrl: "https://sitio.test/contacto?email=ana@x.com",
      },
    );
    expect(out.referrer_url).toBe(safeReferrer("https://www.google.com/search?q=secreto"));
    expect(out.landing_page).toBe("https://sitio.test/promo?utm_source=meta");
    expect(out.page_url).toBe("https://sitio.test/contacto");
  });

  it("un referrer que no es http(s) se descarta", () => {
    expect(attributionFromParams({}, { referrer: "javascript:alert(1)" })).toEqual({});
  });
});

describe("ayudas", () => {
  it("gaClientId toma los dos últimos números", () => {
    expect(gaClientId("GA1.2.1234567.7654321")).toBe("1234567.7654321");
    expect(gaClientId("raro")).toBeNull();
    expect(gaClientId(undefined)).toBeNull();
  });

  it("parseCookieHeader", () => {
    expect(parseCookieHeader("a=1; _fbp=fb.1.2.3; b=%C3%A1")).toEqual({ a: "1", _fbp: "fb.1.2.3", b: "á" });
    expect(parseCookieHeader(null)).toEqual({});
  });

  it("landingFromUrl y pageUrlFromUrl", () => {
    expect(landingFromUrl("no es url")).toBeNull();
    expect(pageUrlFromUrl("ftp://x.com/a")).toBeNull();
  });

  it("hasTouchKeys: las cookies no cuentan como toque nuevo", () => {
    expect(hasTouchKeys({ fbp: "x", fbc: "y" })).toBe(false);
    expect(hasTouchKeys({ gclid: "g" })).toBe(true);
    expect(hasTouchKeys(null)).toBe(false);
  });
});

import { sanitizeAttribution } from "./collect";

describe("sanitizeAttribution (lo que manda el navegador no se acepta tal cual)", () => {
  it("se queda solo con las claves de atribución", () => {
    const out = sanitizeAttribution({ utm_source: "meta", fbp: "fb.1.2.3", password: "x", email: "ana@x.com", admin: true });
    expect(out).toEqual({ utm_source: "meta", fbp: "fb.1.2.3" });
  });

  it("recorta valores largos y descarta tipos que no son texto", () => {
    const out = sanitizeAttribution({ utm_campaign: "x".repeat(500), utm_term: 123, utm_content: { a: 1 } });
    expect(out.utm_campaign).toHaveLength(200);
    expect(out.utm_term).toBeUndefined();
    expect(out.utm_content).toBeUndefined();
  });

  it("revalida las URLs: una que no es http(s) se descarta", () => {
    const out = sanitizeAttribution({
      referrer_url: "javascript:alert(1)",
      landing_page: "https://s.test/promo?utm_source=meta&email=a@x.com",
      page_url: "https://s.test/f?email=a@x.com",
    });
    expect(out.referrer_url).toBeUndefined();
    expect(out.landing_page).toBe("https://s.test/promo?utm_source=meta");
    expect(out.page_url).toBe("https://s.test/f");
  });

  it("first_visit pasa por la misma regla y conserva su ts", () => {
    const out = sanitizeAttribution({ first_visit: { gclid: "g1", password: "x", ts: 1000 } });
    expect(out.first_visit).toEqual({ gclid: "g1", ts: 1000 });
  });

  it("entradas que no son objeto dan vacío", () => {
    expect(sanitizeAttribution(null)).toEqual({});
    expect(sanitizeAttribution("x")).toEqual({});
    expect(sanitizeAttribution([1, 2])).toEqual({});
  });
});
