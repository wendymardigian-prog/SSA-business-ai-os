/**
 * La URL de entrada de punta a punta en el codigo puro (plano formularios-ui, F17 y F18):
 * recolector, saneo del servidor, prioridad entre visita guardada y pagina, y el tope de la
 * visita guardada. Las claves y reglas que ya existian tienen sus propios tests (collect,
 * merge, store, browser) y siguen en verde sin cambios, salvo lo anotado en browser.test.ts.
 */

import { describe, expect, it } from "vitest";
import { attributionFromParams, sanitizeAttribution } from "./collect";
import { effectiveAttribution, preferEmbeddedEntryUrl } from "./merge";
import { MAX_STORED_BYTES, parseStored, recordVisit, serializeStored } from "./store";
import { buildCookie, decodeCookieValue, encodeCookieValue, storedFromEffective } from "./browser";
import { ATTRIBUTION_KEYS, TOUCH_KEYS, VISIT_META_KEYS } from "./keys";
import type { StoredAttribution } from "./types";

const NOW = Date.UTC(2026, 9, 13);
const META =
  "https://ejemplo.test/programa-x?utm_source=facebook&utm_medium=paid&utm_campaign=Programa+X&ad_id=120214558930140527&ad_name=Video+Noe&campaign_name=Programa+X&site_source_name=ig&ref=podcast&fbclid=Iw";

const params = (url: string) => new URL(url).searchParams;
const entryOf = (url: string) => attributionFromParams({}, { landing: url }).entry_url;

describe("attributionFromParams suma entry_url sin cambiar las demas claves", () => {
  it("la URL de entrada es la de llegada con TODOS los parametros; landing_page sigue filtrada", () => {
    const out = attributionFromParams(params(META), { landing: META, pageUrl: META, referrer: "https://l.facebook.com/" });
    expect(out.entry_url).toBe(META);
    // landing_page sigue con solo las claves de toque
    expect(out.landing_page).toContain("utm_source=facebook");
    expect(out.landing_page).not.toContain("ad_name");
    expect(out.landing_page).not.toContain("ref=podcast");
    expect(out.page_url).toBe("https://ejemplo.test/programa-x");
    expect(out.utm_source).toBe("facebook");
  });

  it("sin landing no hay entry_url, y las claves que ya existian no cambian", () => {
    const withoutLanding = attributionFromParams(params(META), {});
    expect(withoutLanding.entry_url).toBeUndefined();
    expect(Object.keys(withoutLanding).sort()).toEqual(["ad_id", "fbclid", "fbc", "utm_campaign", "utm_medium", "utm_source"].sort());
  });

  it("la lista de claves de atribucion y las de la visita NO cambiaron (plano formularios-ui, seccion 3)", () => {
    expect(ATTRIBUTION_KEYS).not.toContain("entry_url");
    expect(TOUCH_KEYS).not.toContain("entry_url");
    expect([...VISIT_META_KEYS]).toEqual(["referrer_url", "landing_page", "page_url"]);
  });
});

describe("sanitizeAttribution vuelve a sanear la URL de entrada (el servidor no confia en el navegador)", () => {
  it("saca lo sensible, lo interno y el fragmento, y conserva el resto", () => {
    const out = sanitizeAttribution({
      utm_source: "facebook",
      entry_url: "https://ejemplo.test/p?utm_source=facebook&token=SECRETO&ad_name=Video&embed=1&c=firma#frag",
    });
    expect(out.entry_url).toBe("https://ejemplo.test/p?utm_source=facebook&ad_name=Video");
    expect(JSON.stringify(out)).not.toContain("SECRETO");
  });

  it("no acepta una URL que no sea http(s)", () => {
    expect(sanitizeAttribution({ entry_url: "javascript:alert(1)" }).entry_url).toBeUndefined();
  });

  it("tambien la sanea dentro de first_visit", () => {
    const out = sanitizeAttribution({
      first_visit: { utm_source: "instagram", ts: 1, entry_url: "https://ejemplo.test/?utm_source=instagram&password=x" },
    });
    expect(out.first_visit?.entry_url).toBe("https://ejemplo.test/?utm_source=instagram");
  });

  it("una clave que no esta en las listas sigue descartandose", () => {
    expect(sanitizeAttribution({ utm_source: "x", ad_name: "algo" })).toEqual({ utm_source: "x" });
  });
});

describe("prioridad (F17): visita guardada, despues la pagina", () => {
  const stored: StoredAttribution = {
    v: 1,
    first: { ts: NOW - 3000, utm_source: "instagram", entry_url: "https://ejemplo.test/?utm_source=instagram&ref=bio" },
    last: { ts: NOW - 1000, utm_source: "facebook", entry_url: "https://ejemplo.test/oferta?utm_source=facebook&ad_name=Video" },
  };

  it("con toque nuevo en la URL gana la URL de esta visita", () => {
    const current = attributionFromParams(params(META), { landing: META });
    expect(effectiveAttribution(current, stored).entry_url).toBe(META);
  });

  it("sin toque nuevo gana la URL de llegada de la visita guardada, no la de la pagina del formulario", () => {
    const page = "https://ejemplo.test/aplicar?ref=otro";
    const current = attributionFromParams(params(page), { landing: page, pageUrl: page });
    const out = effectiveAttribution(current, stored);
    expect(out.entry_url).toBe("https://ejemplo.test/oferta?utm_source=facebook&ad_name=Video");
    expect(out.first_visit?.entry_url).toBe("https://ejemplo.test/?utm_source=instagram&ref=bio");
  });

  it("sin visita guardada vale la URL de la pagina donde esta el formulario (con su ?ref= propio)", () => {
    const page = "https://ejemplo.test/aplicar?ref=podcast";
    const current = attributionFromParams(params(page), { landing: page, pageUrl: page });
    expect(effectiveAttribution(current, { v: 1 }).entry_url).toBe(page);
    expect(effectiveAttribution(current, null).entry_url).toBe(page);
  });

  it("una visita guardada de antes (sin entry_url) cae a la pagina", () => {
    const old: StoredAttribution = { v: 1, last: { ts: NOW - 1000, utm_source: "facebook" } };
    const page = "https://ejemplo.test/aplicar";
    const current = attributionFromParams(params(page), { landing: page });
    expect(effectiveAttribution(current, old).entry_url).toBe(page);
  });

  it("en un embed gana la URL entera de la pagina madre (viaja en attr) sobre la cortada que llega como referrer", () => {
    // El iframe recibe la URL de la pagina madre cortada a 500 en `referrer`, pero la pagina madre manda la
    // entera dentro de `attr`: esa es la que se guarda.
    const full = `${META}&extra=${"x".repeat(900)}`;
    const fromEmbed = sanitizeAttribution({ utm_source: "facebook", entry_url: full });
    const cutParent = full.slice(0, 500);
    const current = attributionFromParams(params(cutParent), { landing: cutParent });
    const plain = effectiveAttribution(current, storedFromEffective(fromEmbed, NOW));
    // Sin el helper, un toque nuevo en la URL del iframe dejaria la cortada.
    expect(plain.entry_url).toBe(entryOf(cutParent));
    const out = preferEmbeddedEntryUrl(plain, fromEmbed);
    expect(out.entry_url).toBe(fromEmbed.entry_url);
    expect((out.entry_url ?? "").length).toBeGreaterThan(900);
  });

  it("sin attr (la pagina madre no manda nada) queda la que llego como referrer", () => {
    const page = "https://ejemplo.test/aplicar?ref=podcast";
    const current = attributionFromParams(params(page), { landing: page });
    expect(preferEmbeddedEntryUrl(current, sanitizeAttribution(null)).entry_url).toBe(page);
  });
});

describe("la visita guardada con la URL de entrada (F18)", () => {
  it("recordVisit la guarda en la primera y en la ultima visita", () => {
    const current = attributionFromParams(params(META), { landing: META });
    const stored = recordVisit(null, current, NOW);
    expect(stored.first?.entry_url).toBe(META);
    expect(stored.last?.entry_url).toBe(META);
  });

  it("parseStored vuelve a sanear la URL de lo guardado", () => {
    const raw = JSON.stringify({ v: 1, last: { ts: NOW, utm_source: "x", entry_url: "https://ejemplo.test/?a=1&token=SECRETO#f" } });
    const out = parseStored(raw, NOW);
    expect(out.last?.entry_url).toBe("https://ejemplo.test/?a=1");
  });

  it("con una URL enorme el texto guardado no pasa de 3500 bytes y conserva las UTM", () => {
    const huge = `https://ejemplo.test/p?utm_source=facebook&utm_campaign=octubre&relleno=${"z".repeat(1900)}`;
    const current = attributionFromParams(params(huge), { landing: huge, referrer: "https://l.facebook.com/" });
    const text = serializeStored(recordVisit(null, current, NOW));
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(MAX_STORED_BYTES);
    const back = parseStored(text, NOW);
    expect(back.last?.utm_source).toBe("facebook");
    expect(back.last?.utm_campaign).toBe("octubre");
  });

  it("orden de recorte: primero la URL de entrada de la primera visita, despues la de la ultima, y recien despues el referrer y la pagina de llegada", () => {
    const mk = (tag: string, size: number) => `https://ejemplo.test/${tag}?utm_source=${tag}&relleno=${"z".repeat(size)}`;
    const stored: StoredAttribution = {
      v: 1,
      first: { ts: NOW - 5, utm_source: "ig", landing_page: "https://ejemplo.test/a?utm_source=ig", referrer_url: "https://ig.test/", entry_url: mk("first", 700) },
      last: { ts: NOW - 1, utm_source: "fb", landing_page: "https://ejemplo.test/b?utm_source=fb", referrer_url: "https://fb.test/", entry_url: mk("last", 700) },
    };
    const sizeOf = (s: string) => new TextEncoder().encode(s).length;
    const full = serializeStored(stored, 100_000);
    const noFirst = serializeStored({ ...stored, first: { ...stored.first!, entry_url: "" } }, 100_000);
    // Con tope justo para todo, sale todo.
    expect(serializeStored(stored, sizeOf(full))).toBe(full);
    // Un poco menos: sin la URL de la primera visita, y la de la ultima, el referrer y las paginas siguen.
    const t1 = JSON.parse(serializeStored(stored, sizeOf(full) - 1));
    expect(t1.first.entry_url).toBeUndefined();
    expect(t1.last.entry_url).toBeDefined();
    expect(t1.first.referrer_url).toBeDefined();
    // Todavia menos: tampoco la de la ultima, pero el referrer y las paginas siguen.
    const t2 = JSON.parse(serializeStored(stored, sizeOf(noFirst) - 1));
    expect(t2.last.entry_url).toBeUndefined();
    expect(t2.last.referrer_url).toBeDefined();
    expect(t2.last.landing_page).toBeDefined();
    // Un tope muy chico: el referrer y la pagina de llegada se pierden recien despues, y las UTM no.
    const t3 = JSON.parse(serializeStored(stored, 160));
    expect(t3.last.utm_source).toBe("fb");
  });

  it("la cookie del sitio con una URL enorme no pasa de 4 KB y conserva las UTM", () => {
    const huge = `https://miweb.com/promo?utm_source=meta&utm_campaign=octubre&relleno=${"z".repeat(1900)}`;
    const current = attributionFromParams(params(huge), { landing: huge, referrer: "https://google.com/" });
    const stored = recordVisit(null, current, NOW);
    const value = encodeCookieValue(stored);
    expect(new TextEncoder().encode(buildCookie(value, { secure: true })).length).toBeLessThanOrEqual(4096);
    const back = decodeCookieValue(value, NOW);
    expect(back.last?.utm_source).toBe("meta");
    expect(back.last?.utm_campaign).toBe("octubre");
  });
});
