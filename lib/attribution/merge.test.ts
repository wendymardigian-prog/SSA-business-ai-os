import { describe, it, expect } from "vitest";
import { effectiveAttribution, preferEmbeddedReferrer } from "./merge";
import type { StoredAttribution } from "./types";

const stored: StoredAttribution = {
  v: 1,
  first: { utm_source: "google", gclid: "g1", landing_page: "https://s.test/", ts: 1000 },
  last: { utm_campaign: "octubre", utm_source: "meta", landing_page: "https://s.test/promo", referrer_url: "https://l.facebook.com/", ts: 2000 },
};

describe("effectiveAttribution", () => {
  it("sin UTM en la URL usa el último toque persistido", () => {
    const out = effectiveAttribution({ page_url: "https://s.test/contacto" }, stored);
    expect(out.utm_campaign).toBe("octubre");
    expect(out.utm_source).toBe("meta");
    expect(out.landing_page).toBe("https://s.test/promo");
    expect(out.referrer_url).toBe("https://l.facebook.com/");
    expect(out.page_url).toBe("https://s.test/contacto");
  });

  it("con UTM en la URL gana la actual y first_visit queda intacto", () => {
    const out = effectiveAttribution({ utm_campaign: "noviembre", page_url: "https://s.test/f" }, stored);
    expect(out.utm_campaign).toBe("noviembre");
    expect(out.utm_source).toBeUndefined();
    expect(out.first_visit).toEqual(stored.first);
  });

  it("un toque nuevo no hereda claves del último (son toques distintos)", () => {
    const out = effectiveAttribution({ gclid: "g2" }, stored);
    expect(out.gclid).toBe("g2");
    expect(out.utm_campaign).toBeUndefined();
  });

  it("las cookies se suman siempre, aunque no haya toque nuevo", () => {
    const out = effectiveAttribution({ fbp: "fb.1.1.2" }, stored);
    expect(out.fbp).toBe("fb.1.1.2");
    expect(out.utm_campaign).toBe("octubre");
  });

  it("sin nada persistido ni en la URL devuelve solo lo actual", () => {
    expect(effectiveAttribution({ page_url: "https://s.test/f" }, null)).toEqual({ page_url: "https://s.test/f" });
    expect(effectiveAttribution(null, null)).toEqual({});
  });

  it("first_visit no lleva sello de tiempo borrado: se conserva tal cual", () => {
    expect(effectiveAttribution({}, stored).first_visit?.ts).toBe(1000);
  });
});

describe("effectiveAttribution sin visita guardada", () => {
  const page = "https://app.test/f/registro";

  it("un link sin UTM conserva de dónde vino y su página de llegada", () => {
    const out = effectiveAttribution({ referrer_url: "https://instagram.com/", landing_page: page, page_url: page }, null);
    expect(out.referrer_url).toBe("https://instagram.com/");
    expect(out.landing_page).toBe(page);
  });

  it("un referrer del mismo sitio no cuenta como de dónde vino", () => {
    const out = effectiveAttribution({ referrer_url: "https://app.test/otra", landing_page: page, page_url: page }, null);
    expect(out.referrer_url).toBeUndefined();
  });

  it("con una visita guardada no pisa lo guardado", () => {
    const out = effectiveAttribution({ referrer_url: "https://google.com/", landing_page: page, page_url: page }, stored);
    expect(out.referrer_url).toBe("https://l.facebook.com/");
    expect(out.landing_page).toBe("https://s.test/promo");
  });

  it("una visita guardada sin referrer no toma el de ahora: son visitas distintas", () => {
    const sinReferrer: StoredAttribution = { v: 1, last: { utm_source: "meta", ts: 2000 } };
    const out = effectiveAttribution({ referrer_url: "https://google.com/", page_url: page }, sinReferrer);
    expect(out.referrer_url).toBeUndefined();
  });
});

describe("preferEmbeddedReferrer", () => {
  const parent = "https://web.test/landing";

  it("en un embed gana el referrer real que mandó la página, no la página misma", () => {
    const out = preferEmbeddedReferrer({ utm_source: "meta", referrer_url: parent }, { referrer_url: "https://l.facebook.com/", utm_source: "meta" });
    expect(out.referrer_url).toBe("https://l.facebook.com/");
  });

  it("si la persona entró directo a la página, queda sin referrer", () => {
    const out = preferEmbeddedReferrer({ utm_source: "meta", referrer_url: parent, page_url: parent }, { utm_source: "meta" });
    expect(out.referrer_url).toBeUndefined();
    expect(out.page_url).toBe(parent);
  });

  it("sin datos del script no cambia nada", () => {
    expect(preferEmbeddedReferrer({ referrer_url: parent }, {}).referrer_url).toBe(parent);
    expect(preferEmbeddedReferrer({ referrer_url: parent }, null).referrer_url).toBe(parent);
  });
});
