import { describe, it, expect } from "vitest";
import { checkOutputGuardrails, extractLinks, linkAllowed, normalizeLink } from "./output-guardrails";
import { guardrailsSchema } from "./schemas";

const G = guardrailsSchema.parse({});

describe("extractLinks / normalizeLink", () => {
  it("encuentra links con protocolo, www y dominios pelados", () => {
    expect(extractLinks("anda a https://sitio.com/a?x=1 ya")).toContain("https://sitio.com/a?x=1");
    expect(extractLinks("mira www.sitio.com")).toContain("www.sitio.com");
    expect(extractLinks("wa.me/5491100000000 dale")).toContain("wa.me/5491100000000");
  });
  it("no confunde 'Ok.Gracias' con un dominio", () => {
    expect(extractLinks("Ok.Gracias por escribir")).toHaveLength(0);
  });
  it("normaliza ignorando protocolo, www y parametros", () => {
    expect(normalizeLink("https://www.sitio.com/a?x=1#y")).toEqual({ host: "sitio.com", path: "/a" });
  });
});

describe("linkAllowed", () => {
  it("wa.me con otro numero no pasa", () => {
    expect(linkAllowed("wa.me/5491100000000", ["wa.me/5491100000000"])).toBe(true);
    expect(linkAllowed("wa.me/54911000000001", ["wa.me/5491100000000"])).toBe(false);
  });
  it("entrada con camino permite subcamino, no otro camino", () => {
    expect(linkAllowed("tusitio.com/academia/x", ["tusitio.com/academia"])).toBe(true);
    expect(linkAllowed("tusitio.com/otra", ["tusitio.com/academia"])).toBe(false);
  });
  it("entrada sin camino permite todo el host", () => {
    expect(linkAllowed("sitio.com/lo-que-sea", ["sitio.com"])).toBe(true);
  });
});

describe("checkOutputGuardrails: links", () => {
  const g = { ...G, linksPermitidos: ["wa.me/5491100000000", "tusitio.com/academia"] };
  it("link a otro dominio y wa.me con otro numero se bloquean", () => {
    const r = checkOutputGuardrails("escribime a https://otro.com y a wa.me/999999999", g);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.hits.filter((h) => h.rule === "link").length).toBe(2);
  });
  it("un link permitido pasa, con www y parametros", () => {
    expect(checkOutputGuardrails("mira https://www.tusitio.com/academia?ref=ig", g).ok).toBe(true);
  });
  it("lista vacia: no revisa links", () => {
    expect(checkOutputGuardrails("anda a https://otro.com", G).ok).toBe(true);
  });
  it("el link generado en el turno pasa como permitido implicito", () => {
    const r = checkOutputGuardrails("dale: https://wa.me/50611112222?text=hola", g, {
      allowedLinks: ["https://wa.me/50611112222?text=hola"],
    });
    expect(r.ok).toBe(true);
  });
});

describe("checkOutputGuardrails: palabras, escasez y cifras", () => {
  it("ScaleOS se bloquea (y scaleos tambien)", () => {
    expect(checkOutputGuardrails("Somos ScaleOS", G).ok).toBe(false);
    expect(checkOutputGuardrails("somos scaleos hoy", G).ok).toBe(false);
  });
  it("'quedan 3 cupos' se bloquea por escasez", () => {
    const r = checkOutputGuardrails("apurate que quedan 3 lugares", G);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.hits.some((h) => h.rule === "escasez")).toBe(true);
  });
  it("una cifra con $ se bloquea salvo que este en la lista", () => {
    expect(checkOutputGuardrails("sale $497", G).ok).toBe(false);
    const conLista = { ...G, cifras: { enabled: true, permitidas: ["497"] } };
    expect(checkOutputGuardrails("sale $497", conLista).ok).toBe(true);
  });
  it("junta todos los hallazgos, no solo el primero", () => {
    const g = { ...G, linksPermitidos: ["wa.me/5491100000000"] };
    const r = checkOutputGuardrails("ScaleOS te cobra $99 en https://otro.com", g);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const rules = new Set(r.hits.map((h) => h.rule));
      expect(rules.has("palabra_prohibida")).toBe(true);
      expect(rules.has("cifra")).toBe(true);
      expect(rules.has("link")).toBe(true);
    }
  });
});
