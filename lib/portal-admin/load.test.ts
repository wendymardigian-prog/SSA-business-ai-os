// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { portalUrl } from "./load";

describe("los links del portal", () => {
  it("salen de la dirección del portal, con https", () => {
    expect(portalUrl("portal.ejemplo.test", "/entrar/invitacion/abc")).toBe("https://portal.ejemplo.test/entrar/invitacion/abc");
    expect(portalUrl("portal.ejemplo.test", "vista-previa/x")).toBe("https://portal.ejemplo.test/vista-previa/x");
  });
});
