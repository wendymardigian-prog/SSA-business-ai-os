import { describe, expect, it } from "vitest";
import { cleanRecorderEmails, normalizeFathomEmail, recorderEmailsFor, teamEmailsOf, validateRecorderEmails } from "./recorder-emails";

const ana = { userId: "u-ana", email: "ana@negocio.io", extraEmails: [" Ana.Personal@Gmail.com "] };
const beto = { userId: "u-beto", email: "beto@negocio.io", extraEmails: ["beto.personal@gmail.com"] };

describe("recorderEmailsFor", () => {
  it("junta el correo de la cuenta, el de Fathom y los que cargo la persona, sin repetir", () => {
    expect(recorderEmailsFor(ana, "ana@fathom.com")).toEqual(["ana@negocio.io", "ana@fathom.com", "ana.personal@gmail.com"]);
    expect(recorderEmailsFor(ana, "ana@negocio.io")).toEqual(["ana@negocio.io", "ana.personal@gmail.com"]);
  });

  it("la etiqueta de la conexion puede no ser un correo: se ignora", () => {
    expect(recorderEmailsFor(ana, "Cuenta de Fathom")).toEqual(["ana@negocio.io", "ana.personal@gmail.com"]);
    expect(recorderEmailsFor(ana, null)).toEqual(["ana@negocio.io", "ana.personal@gmail.com"]);
  });

  it("sin ningun correo devuelve una lista vacia", () => {
    expect(recorderEmailsFor({ userId: "u", email: null, extraEmails: [] })).toEqual([]);
  });
});

describe("teamEmailsOf", () => {
  it("son todos los correos de todo el equipo", () => {
    expect(teamEmailsOf([ana, beto]).sort()).toEqual(["ana.personal@gmail.com", "ana@negocio.io", "beto.personal@gmail.com", "beto@negocio.io"]);
  });
});

describe("normalizacion", () => {
  it("normaliza mayusculas y espacios", () => {
    expect(normalizeFathomEmail("  ANA.Personal@Gmail.com ")).toBe("ana.personal@gmail.com");
  });
  it("descarta lo que no es un correo", () => {
    expect(normalizeFathomEmail("nada")).toBeNull();
    expect(normalizeFathomEmail(3)).toBeNull();
    expect(cleanRecorderEmails(["nada", 3, "a@b.com", "A@B.com"])).toEqual(["a@b.com"]);
  });
});

describe("validateRecorderEmails", () => {
  it("acepta correos propios nuevos", () => {
    expect(validateRecorderEmails("u-ana", ["ana.otro@gmail.com"], [ana, beto])).toEqual({ ok: true, emails: ["ana.otro@gmail.com"] });
  });

  it("rechaza el correo de la cuenta de otra persona, sin decir de quien es", () => {
    const r = validateRecorderEmails("u-ana", ["beto@negocio.io"], [ana, beto]);
    expect(r).toEqual({ ok: false, error: "beto@negocio.io ya es de otra persona del equipo" });
  });

  it("rechaza un correo que cargo otra persona", () => {
    expect(validateRecorderEmails("u-ana", ["Beto.Personal@gmail.com"], [ana, beto]).ok).toBe(false);
  });

  it("no se choca con sus propios correos", () => {
    expect(validateRecorderEmails("u-ana", ["ana.personal@gmail.com"], [ana, beto]).ok).toBe(true);
  });

  it("acepta hasta 5 y rechaza 6", () => {
    const seis = ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com", "f@x.com"];
    expect(validateRecorderEmails("u-ana", seis.slice(0, 5), [ana, beto]).ok).toBe(true);
    expect(validateRecorderEmails("u-ana", seis, [ana, beto]).ok).toBe(false);
  });
});
