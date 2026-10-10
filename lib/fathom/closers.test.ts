import { describe, expect, it } from "vitest";
import { buildCloserByEmail, cleanCloserEmails, closerEmails, normalizeFathomEmail, validateCloserEmails } from "./closers";

describe("buildCloserByEmail", () => {
  const members = [
    { userId: "u-jose", email: "jjiron@negocio.io", isCloser: true, closerEmails: [" Jose.Jiron.Fonseca@Gmail.com "] },
    { userId: "u-otro", email: "otro@negocio.io", isCloser: true, closerEmails: [] },
    { userId: "u-setter", email: "setter@negocio.io", isCloser: false, closerEmails: ["setter.personal@gmail.com"] },
  ];

  it("una grabacion con el correo alterno se asigna al closer correcto", () => {
    expect(buildCloserByEmail(members).get("jose.jiron.fonseca@gmail.com")).toBe("u-jose");
  });

  it("el correo de la cuenta sigue funcionando", () => {
    expect(buildCloserByEmail(members).get("jjiron@negocio.io")).toBe("u-jose");
  });

  it("NO incluye a quien no es closer, ni su correo principal ni los alternos", () => {
    const map = buildCloserByEmail(members);
    expect(map.has("setter@negocio.io")).toBe(false);
    expect(map.has("setter.personal@gmail.com")).toBe(false);
  });

  it("closerEmails lista todos los correos para pedirle a Fathom solo sus llamadas", () => {
    expect(closerEmails(buildCloserByEmail(members)).sort()).toEqual(["jjiron@negocio.io", "jose.jiron.fonseca@gmail.com", "otro@negocio.io"]);
  });
});

describe("normalizacion", () => {
  it("normaliza mayusculas y espacios", () => {
    expect(normalizeFathomEmail("  ANA.Personal@Gmail.com ")).toBe("ana.personal@gmail.com");
  });
  it("descarta lo que no es un correo", () => {
    expect(normalizeFathomEmail("nada")).toBeNull();
    expect(normalizeFathomEmail(3)).toBeNull();
    expect(cleanCloserEmails(["nada", 3, "a@b.com", "A@B.com"])).toEqual(["a@b.com"]);
  });
});

describe("validateCloserEmails", () => {
  const others = [
    { userId: "u-2", name: "Beto", email: "beto@negocio.io", closerEmails: ["beto.personal@gmail.com"] },
  ];

  it("acepta correos propios nuevos", () => {
    expect(validateCloserEmails("u-1", ["ana@gmail.com"], others)).toEqual({ ok: true, emails: ["ana@gmail.com"] });
  });

  it("rechaza un alterno que es el correo de la cuenta de otra persona, nombrandola", () => {
    const r = validateCloserEmails("u-1", ["beto@negocio.io"], others);
    expect(r).toEqual({ ok: false, error: "beto@negocio.io ya es un correo de Beto" });
  });

  it("rechaza un alterno que es alterno de otra persona", () => {
    const r = validateCloserEmails("u-1", ["Beto.Personal@gmail.com"], others);
    expect(r.ok).toBe(false);
  });

  it("no se choca con sus propios correos", () => {
    const self = [...others, { userId: "u-1", name: "Ana", email: "ana@negocio.io", closerEmails: ["ana@gmail.com"] }];
    expect(validateCloserEmails("u-1", ["ana@gmail.com"], self).ok).toBe(true);
  });

  it("acepta hasta 5 y rechaza 6", () => {
    const seis = ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com", "f@x.com"];
    expect(validateCloserEmails("u-1", seis.slice(0, 5), others).ok).toBe(true);
    expect(validateCloserEmails("u-1", seis, others).ok).toBe(false);
  });
});
