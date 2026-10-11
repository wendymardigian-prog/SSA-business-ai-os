import { describe, it, expect } from "vitest";
import { parseStored, recordVisit, serializeStored, MAX_STORED_BYTES, MAX_AGE_MS, STORE_KEY } from "./store";
import type { StoredAttribution } from "./types";

const T1 = Date.UTC(2026, 9, 1);
const T2 = T1 + 3600_000;
const T3 = T2 + 3600_000;

describe("recordVisit", () => {
  it("una visita con UTM es el primer y el último toque", () => {
    const out = recordVisit({ v: 1 }, { utm_campaign: "octubre" }, T1);
    expect(out.first).toMatchObject({ utm_campaign: "octubre", ts: T1 });
    expect(out.last).toMatchObject({ utm_campaign: "octubre", ts: T1 });
  });

  it("una visita con otro dato de anuncio deja la primera y cambia la última (son toques distintos)", () => {
    const first = recordVisit({ v: 1 }, { utm_campaign: "octubre" }, T1);
    const out = recordVisit(first, { gclid: "g1" }, T2);
    expect(out.first).toMatchObject({ utm_campaign: "octubre" });
    expect(out.last).toMatchObject({ gclid: "g1", ts: T2 });
    expect(out.last).not.toHaveProperty("utm_campaign");
  });

  it("una visita sin nada de anuncio devuelve lo mismo (el mismo objeto)", () => {
    const stored = recordVisit({ v: 1 }, { utm_source: "meta" }, T1);
    expect(recordVisit(stored, {}, T3)).toBe(stored);
    expect(recordVisit(stored, { fbp: "fb.1.2.3", page_url: "https://x.com/" }, T3)).toBe(stored);
  });

  it("guarda la página de llegada y el referrer, y NO las cookies ni la página del formulario", () => {
    const out = recordVisit({ v: 1 }, { utm_source: "meta", landing_page: "https://x.com/?utm_source=meta", referrer_url: "https://google.com/", fbp: "fb.1", page_url: "https://x.com/f" }, T1);
    expect(out.last).toMatchObject({ landing_page: "https://x.com/?utm_source=meta", referrer_url: "https://google.com/" });
    expect(out.last).not.toHaveProperty("fbp");
    expect(out.last).not.toHaveProperty("page_url");
  });

  it("la primera nunca se pisa, aunque lleguen muchos toques", () => {
    let stored: StoredAttribution = { v: 1 };
    for (let i = 0; i < 5; i++) stored = recordVisit(stored, { utm_campaign: `c${i}` }, T1 + i);
    expect(stored.first).toMatchObject({ utm_campaign: "c0" });
    expect(stored.last).toMatchObject({ utm_campaign: "c4" });
  });

  it("sin lo guardado (null) funciona igual", () => {
    expect(recordVisit(null, { fbclid: "f1" }, T1).first).toMatchObject({ fbclid: "f1" });
  });
});

describe("parseStored", () => {
  const good = () => serializeStored(recordVisit({ v: 1 }, { utm_source: "meta", utm_campaign: "octubre" }, T1));

  it("lee lo que se guardó", () => {
    const out = parseStored(good(), T2);
    expect(out.v).toBe(1);
    expect(out.last).toMatchObject({ utm_campaign: "octubre" });
  });

  it("JSON roto, otra versión, vacío o nulo dan vacío", () => {
    expect(parseStored("{no es json", T1)).toEqual({ v: 1 });
    expect(parseStored(JSON.stringify({ v: 2, last: { utm_source: "x", ts: T1 } }), T1)).toEqual({ v: 1 });
    expect(parseStored("", T1)).toEqual({ v: 1 });
    expect(parseStored(null, T1)).toEqual({ v: 1 });
    expect(parseStored("[]", T1)).toEqual({ v: 1 });
    expect(parseStored("null", T1)).toEqual({ v: 1 });
  });

  it("más de 3,5 KB da vacío", () => {
    const big = JSON.stringify({ v: 1, last: { utm_source: "x".repeat(200), utm_medium: "m", ts: T1 }, pad: "x".repeat(10_000) });
    expect(big.length).toBeGreaterThan(MAX_STORED_BYTES);
    expect(parseStored(big, T1)).toEqual({ v: 1 });
  });

  it("descarta una clave que no es de atribución (password) y las que no son texto", () => {
    const raw = JSON.stringify({ v: 1, last: { utm_source: "meta", password: "secreto", gclid: 5, ts: T1 } });
    const out = parseStored(raw, T1);
    expect(out.last).toEqual({ utm_source: "meta", ts: T1 });
  });

  it("una visita de hace 91 días se descarta; de hace 89, no", () => {
    const old = JSON.stringify({ v: 1, last: { utm_source: "meta", ts: T1 } });
    expect(parseStored(old, T1 + 91 * 86_400_000)).toEqual({ v: 1 });
    expect(parseStored(old, T1 + 89 * 86_400_000).last).toBeDefined();
    expect(MAX_AGE_MS).toBe(90 * 86_400_000);
  });

  it("si vence la primera pero no la última, se conserva la última", () => {
    const raw = JSON.stringify({ v: 1, first: { utm_source: "viejo", ts: T1 }, last: { utm_source: "nuevo", ts: T1 + 80 * 86_400_000 } });
    const out = parseStored(raw, T1 + 100 * 86_400_000);
    expect(out.first).toBeUndefined();
    expect(out.last).toMatchObject({ utm_source: "nuevo" });
  });

  it("una visita sin sello de tiempo o sin ninguna clave de toque se descarta", () => {
    expect(parseStored(JSON.stringify({ v: 1, last: { utm_source: "x" } }), T1)).toEqual({ v: 1 });
    expect(parseStored(JSON.stringify({ v: 1, last: { landing_page: "https://x.com", ts: T1 } }), T1)).toEqual({ v: 1 });
  });

  it("una fecha del futuro lejano no vale", () => {
    expect(parseStored(JSON.stringify({ v: 1, last: { utm_source: "x", ts: T1 + 10 * 86_400_000 } }), T1)).toEqual({ v: 1 });
  });

  it("recorta los valores a 200 caracteres y saca los caracteres de control", () => {
    const raw = JSON.stringify({ v: 1, last: { utm_campaign: `a\u0000${"b".repeat(300)}`, ts: T1 } });
    const out = parseStored(raw, T1);
    expect(String(out.last?.utm_campaign)).toHaveLength(200);
    expect(String(out.last?.utm_campaign)).not.toContain("\u0000");
  });
});

describe("serializeStored", () => {
  it("siempre entra en 3,5 KB, aunque las visitas traigan valores enormes", () => {
    const huge: StoredAttribution = {
      v: 1,
      first: { utm_source: "s".repeat(500), utm_medium: "m".repeat(500), utm_campaign: "c".repeat(500), landing_page: "l".repeat(500), referrer_url: "r".repeat(500), gclid: "g".repeat(500), fbclid: "f".repeat(500), msclkid: "m".repeat(500), ts: T1 },
      last: { utm_source: "s".repeat(500), utm_campaign: "c".repeat(500), landing_page: "l".repeat(500), referrer_url: "r".repeat(500), gclid: "g".repeat(500), fbclid: "f".repeat(500), ts: T2 },
    };
    const text = serializeStored(huge);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(MAX_STORED_BYTES);
    expect(parseStored(text, T2).last).toBeDefined();
  });

  it("ida y vuelta de algo normal no pierde nada", () => {
    const stored = recordVisit(recordVisit({ v: 1 }, { utm_campaign: "octubre", landing_page: "https://x.com/?utm_campaign=octubre" }, T1), { gclid: "g1" }, T2);
    expect(parseStored(serializeStored(stored), T3)).toEqual(stored);
  });

  it("el nombre de la cookie y de la clave de localStorage es ssa_attr", () => {
    expect(STORE_KEY).toBe("ssa_attr");
  });
});
