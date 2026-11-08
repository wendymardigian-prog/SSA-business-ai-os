import { describe, expect, it } from "vitest";
import { detectDocType, textsProposalContent, verificationProposal } from "./proposals";

describe("ai/proposals: reconocer un certificado, una constancia o un diploma", () => {
  it("lo que dijo la IA manda", () => {
    expect(detectDocType("diploma", "algo cualquiera")).toBe("diploma");
    expect(detectDocType("constancia", "")).toBe("constancia");
    expect(detectDocType("certificado", "")).toBe("certificado");
  });

  it("si la IA dijo «ninguno» u «otro», no se propone nada aunque el pedido tenga la palabra", () => {
    expect(detectDocType("ninguno", "un certificado")).toBeNull();
    expect(detectDocType("otro", "un certificado")).toBeNull();
  });

  it("sin opinión de la IA, mira las palabras del pedido", () => {
    expect(detectDocType(undefined, "Armame un Certificado de finalización")).toBe("certificado");
    expect(detectDocType(null, "una constancia de asistencia")).toBe("constancia");
    expect(detectDocType(undefined, "diploma para egresados")).toBe("diploma");
    expect(detectDocType(undefined, "un carrusel sobre ventas")).toBeNull();
    expect(detectDocType(undefined, "certificadora de calidad")).toBeNull();
  });
});

describe("ai/proposals: la propuesta de prender la verificación (F47)", () => {
  const ok = { isTemplate: true, format: "carta_h" as const, alreadyVerifies: false, docType: "certificado" as const };

  it("en una plantilla impresa que todavía no verifica, con su texto y el tipo", () => {
    expect(verificationProposal(ok)).toEqual({
      kind: "enable_verification",
      status: "pending",
      payload: { doc_type: "certificado" },
      text: "Parece un certificado. ¿Prendo la verificación como Certificado? Así cada pieza emitida lleva su código y se puede comprobar con el link.",
    });
    expect(verificationProposal({ ...ok, docType: "constancia" })?.text).toMatch(/^Parece una constancia\./);
    expect(verificationProposal({ ...ok, docType: "diploma", format: "a4_v" })?.payload.doc_type).toBe("diploma");
  });

  it("nunca en un diseño suelto, en formatos de redes, presentación o web, ni si ya verifica", () => {
    expect(verificationProposal({ ...ok, isTemplate: false })).toBeNull();
    for (const format of ["sq", "v45", "story", "wide", "web"] as const) expect(verificationProposal({ ...ok, format })).toBeNull();
    expect(verificationProposal({ ...ok, alreadyVerifies: true })).toBeNull();
    expect(verificationProposal({ ...ok, docType: null })).toBeNull();
  });

  it("los cuatro formatos impresos la admiten", () => {
    for (const format of ["carta_v", "carta_h", "a4_v", "a4_h"] as const) expect(verificationProposal({ ...ok, format })).not.toBeNull();
  });
});

describe("ai/proposals: la propuesta de textos", () => {
  it("el mensaje termina con «¿Lo hago?» una sola vez", () => {
    expect(textsProposalContent("Puse el nombre y la fecha.")).toBe("Puse el nombre y la fecha.\n\n¿Lo hago?");
    expect(textsProposalContent("Puse el nombre. ¿Lo hago?")).toBe("Puse el nombre. ¿Lo hago?");
  });
});
