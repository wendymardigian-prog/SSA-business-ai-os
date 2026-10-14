import { describe, it, expect } from "vitest";
import { trackVisit, pageAttribution, currentVisit, referrerOfOtherSite, cookieEnv, encodeCookieValue, decodeCookieValue, buildCookie, storedFromEffective, type TrackEnv } from "./browser";
import { recordVisit } from "./store";

const NOW = Date.UTC(2026, 9, 11);

function memoryEnv(over: Partial<TrackEnv> = {}): TrackEnv & { saved: string[]; value: { current: string | null } } {
  const value = { current: null as string | null };
  const saved: string[] = [];
  return {
    href: "https://miweb.com/promo?utm_source=meta&utm_campaign=octubre",
    search: "?utm_source=meta&utm_campaign=octubre",
    hostname: "miweb.com",
    referrer: "https://google.com/",
    cookieHeader: "_fbp=fb.1.2.3; otra=1",
    readStored: () => value.current,
    writeStored: (text) => {
      value.current = text;
      saved.push(text);
    },
    now: NOW,
    saved,
    value,
    ...over,
  };
}

describe("trackVisit", () => {
  it("una visita con UTM se guarda como primer y último toque", () => {
    const env = memoryEnv();
    const out = trackVisit(env);
    expect(out.first).toMatchObject({ utm_source: "meta", utm_campaign: "octubre" });
    expect(env.saved).toHaveLength(1);
  });

  it("una visita sin nada de anuncio no escribe", () => {
    const env = memoryEnv({ href: "https://miweb.com/", search: "" });
    trackVisit(env);
    expect(env.saved).toHaveLength(0);
  });

  it("la segunda visita conserva la primera y cambia la última", () => {
    const env = memoryEnv();
    trackVisit(env);
    const later = { ...env, href: "https://miweb.com/otra?gclid=g1", search: "?gclid=g1", now: NOW + 3600_000 };
    const out = trackVisit(later);
    expect(out.first).toMatchObject({ utm_campaign: "octubre" });
    expect(out.last).toMatchObject({ gclid: "g1" });
  });

  it("si el almacenamiento tira error al leer o al escribir, NO lanza", () => {
    const boom = memoryEnv({
      readStored: () => {
        throw new Error("bloqueado");
      },
      writeStored: () => {
        throw new Error("bloqueado");
      },
    });
    expect(() => trackVisit(boom)).not.toThrow();
    expect(() => pageAttribution(boom)).not.toThrow();
    // Sin almacenamiento, la atribución de la URL actual sigue sirviendo.
    expect(pageAttribution(boom)).toMatchObject({ utm_source: "meta", utm_campaign: "octubre" });
  });

  it("un valor guardado roto no tumba nada", () => {
    const env = memoryEnv();
    env.value.current = "{roto";
    expect(() => trackVisit(env)).not.toThrow();
    expect(env.saved).toHaveLength(1);
  });
});

describe("currentVisit y el referrer", () => {
  it("el referrer del mismo dominio no cuenta; el de otro sí", () => {
    expect(referrerOfOtherSite("https://miweb.com/inicio", "miweb.com")).toBeNull();
    expect(referrerOfOtherSite("https://google.com/", "miweb.com")).toBe("https://google.com/");
    expect(referrerOfOtherSite("", "miweb.com")).toBeNull();
    expect(referrerOfOtherSite("no-es-url", "miweb.com")).toBeNull();
  });

  it("arma la atribución con las cookies de los anuncios y sin la query de la persona en page_url", () => {
    const visit = currentVisit(memoryEnv({ href: "https://miweb.com/promo?utm_source=meta&email=ana@x.com", search: "?utm_source=meta&email=ana@x.com" }));
    expect(visit).toMatchObject({ utm_source: "meta", fbp: "fb.1.2.3", referrer_url: "https://google.com/" });
    expect(visit.page_url).toBe("https://miweb.com/promo");
    // `page_url` y `landing_page` siguen filtradas: la query de la persona no entra en ninguna de las dos.
    expect(visit.page_url).not.toContain("ana@x.com");
    expect(visit.landing_page).not.toContain("ana@x.com");
    // Plano formularios-ui (D13, F17): la URL de entrada es un dato APARTE y conserva TODOS los parametros
    // (salvo los sensibles e internos), incluido el de la persona. Antes del plano este test pedia que el
    // JSON entero no la tuviera; ahora solo `entry_url` la guarda.
    expect(visit.entry_url).toBe("https://miweb.com/promo?utm_source=meta&email=ana@x.com");
    const { entry_url: _entry, ...rest } = visit;
    expect(JSON.stringify(rest)).not.toContain("ana@x.com");
  });
});

describe("pageAttribution", () => {
  it("sin toque nuevo en la URL, manda el último guardado", () => {
    const env = memoryEnv();
    trackVisit(env);
    const back = { ...env, href: "https://miweb.com/contacto", search: "", referrer: "https://miweb.com/promo" };
    const out = pageAttribution(back);
    expect(out).toMatchObject({ utm_source: "meta", utm_campaign: "octubre", page_url: "https://miweb.com/contacto" });
    expect(out.first_visit).toMatchObject({ utm_campaign: "octubre" });
  });
});

describe("la cookie ssa_attr", () => {
  it("ida y vuelta por base64url, sin comillas ni llaves en el valor", () => {
    const stored = recordVisit({ v: 1 }, { utm_source: "meta", utm_campaign: "octubre ñ" }, NOW);
    const value = encodeCookieValue(stored);
    expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCookieValue(value, NOW)).toEqual(stored);
  });

  it("un valor roto da vacío", () => {
    expect(decodeCookieValue("@@@", NOW)).toEqual({ v: 1 });
    expect(decodeCookieValue(null, NOW)).toEqual({ v: 1 });
  });

  it("el valor cabe en una cookie (< 4 KB) aunque las visitas traigan valores enormes", () => {
    const big = "x".repeat(200);
    const stored = { v: 1 as const, first: { utm_source: big, utm_campaign: big, gclid: big, fbclid: big, landing_page: big, referrer_url: big, ts: NOW }, last: { utm_source: big, utm_campaign: big, gclid: big, fbclid: big, landing_page: big, referrer_url: big, ts: NOW } };
    expect(`ssa_attr=${encodeCookieValue(stored)}`.length).toBeLessThan(4096);
  });

  it("buildCookie: SameSite=Lax, Path=/, 90 días y Secure solo en https", () => {
    expect(buildCookie("abc", { secure: true })).toBe("ssa_attr=abc; Max-Age=7776000; Path=/; SameSite=Lax; Secure");
    expect(buildCookie("abc", { secure: false })).toBe("ssa_attr=abc; Max-Age=7776000; Path=/; SameSite=Lax");
  });

  it("cookieEnv guarda y lee con un documento simulado", () => {
    const doc = { cookie: "_fbp=fb.1.2.3", referrer: "" };
    const writes: string[] = [];
    const fake = {
      get cookie() {
        return doc.cookie;
      },
      set cookie(value: string) {
        writes.push(value);
        doc.cookie = `${doc.cookie}; ${value.split(";")[0]}`;
      },
      referrer: "",
    };
    const loc = { href: "https://miweb.com/?utm_campaign=octubre", search: "?utm_campaign=octubre", hostname: "miweb.com", protocol: "https:" };
    trackVisit({ ...cookieEnv(fake, loc), now: NOW });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/^ssa_attr=[A-Za-z0-9_-]+; Max-Age=7776000; Path=\/; SameSite=Lax; Secure$/);
    // Al volver sin UTM, la cookie guardada se lee.
    const back = pageAttribution({ ...cookieEnv(fake, { ...loc, href: "https://miweb.com/", search: "" }), now: NOW });
    expect(back.utm_campaign).toBe("octubre");
  });

  it("si las cookies están bloqueadas (escribir lanza), no lanza", () => {
    const fake = {
      get cookie() {
        return "";
      },
      set cookie(_value: string) {
        throw new Error("bloqueadas");
      },
      referrer: "",
    };
    const loc = { href: "https://miweb.com/?utm_campaign=x", search: "?utm_campaign=x", hostname: "miweb.com", protocol: "https:" };
    expect(() => trackVisit({ ...cookieEnv(fake, loc), now: NOW })).not.toThrow();
  });
});

describe("storedFromEffective", () => {
  it("convierte la atribución efectiva del embed en lo que el iframe necesita", () => {
    const stored = storedFromEffective({ utm_campaign: "octubre", fbp: "fb.1", first_visit: { utm_source: "meta", ts: NOW - 1000 } }, NOW);
    expect(stored.last).toMatchObject({ utm_campaign: "octubre", fbp: "fb.1" });
    expect(stored.first).toMatchObject({ utm_source: "meta" });
    expect(storedFromEffective(null)).toEqual({ v: 1 });
  });
});
