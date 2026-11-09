// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { portalSenderProblem, verifiedSenderDomains } from "./sender";

describe("verifiedSenderDomains", () => {
  it("deja solo los verificados, sin repetir", () => {
    expect(
      verifiedSenderDomains([
        { name: "Mail.Ejemplo.com", status: "verified" },
        { name: "otro.com", status: "pending" },
        { name: "mail.ejemplo.com", status: "verified" },
        { name: "a.com", status: "verified" },
      ]),
    ).toEqual(["a.com", "mail.ejemplo.com"]);
  });
});

describe("portalSenderProblem", () => {
  const verified = ["mail.ejemplo.com"];
  it("el remitente del negocio siempre se puede", () => {
    expect(portalSenderProblem(null, "x@otro.com", null)).toBeNull();
  });
  it("acepta un dominio verificado", () => {
    expect(portalSenderProblem("portal@mail.ejemplo.com", null, verified)).toBeNull();
  });
  it("rechaza un dominio que no está verificado", () => {
    expect(portalSenderProblem("portal@otro.com", null, verified)).toMatch(/no está verificado/);
  });
  it("rechaza lo de antes del @ inválido", () => {
    expect(portalSenderProblem("por tal@mail.ejemplo.com", null, verified)).toMatch(/antes del @/);
  });
  it("si Resend no contesta, solo deja lo que ya estaba guardado", () => {
    expect(portalSenderProblem("portal@mail.ejemplo.com", "portal@mail.ejemplo.com", null)).toBeNull();
    expect(portalSenderProblem("nuevo@mail.ejemplo.com", "portal@mail.ejemplo.com", null)).toMatch(/No pude comprobar/);
  });
});

import { variablesToChips } from "./invite-variables";

describe("variablesToChips", () => {
  it("pasa {nombre} y las variables escritas a fichas", () => {
    expect(variablesToChips("<p>Hola {nombre} de {{workspace.name}}</p>")).toBe(
      '<p>Hola <span data-variable="contact.first_name">{{contact.first_name}}</span> de <span data-variable="workspace.name">{{workspace.name}}</span></p>',
    );
  });
  it("no envuelve dos veces lo que ya es ficha", () => {
    const html = '<p><span data-variable="contact.name">{{contact.name}}</span></p>';
    expect(variablesToChips(html)).toBe(html);
  });
});
