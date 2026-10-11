import { describe, it, expect } from "vitest";
import { effectiveAttribution } from "./merge";
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
