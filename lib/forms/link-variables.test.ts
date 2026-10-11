import { describe, it, expect } from "vitest";
import { hasFormLinkVariables, slugFromToken, formLinkSlugs, replaceFormLinks, linkIdsFromVariables } from "./link-variables";

describe("hasFormLinkVariables", () => {
  it("reconoce el token, con o sin espacios, y no confunde otras variables", () => {
    expect(hasFormLinkVariables("Respondé acá: {{form_link.como_vas}}")).toBe(true);
    expect(hasFormLinkVariables("{{ form_link.como_vas }}")).toBe(true);
    expect(hasFormLinkVariables("{{contact.display_name}} {{form.url}}")).toBe(false);
    expect(hasFormLinkVariables("sin nada")).toBe(false);
  });
  it("se puede llamar dos veces seguidas con el mismo resultado", () => {
    expect(hasFormLinkVariables("{{form_link.a_b}}")).toBe(true);
    expect(hasFormLinkVariables("{{form_link.a_b}}")).toBe(true);
  });
});

describe("slugs", () => {
  it("el guion bajo del token es el guion del slug", () => {
    expect(slugFromToken("como_vas")).toBe("como-vas");
    expect(formLinkSlugs(["{{form_link.como_vas}} y {{form_link.como_vas}}", "{{form_link.otro}}"])).toEqual(["como-vas", "otro"]);
  });
});

describe("replaceFormLinks", () => {
  it("reemplaza los que tienen link y deja tal cual el que no", () => {
    const out = replaceFormLinks("A {{form_link.como_vas}} B {{form_link.no_existe}}", { "como-vas": "https://x/f/como-vas?c=tok" });
    expect(out).toBe("A https://x/f/como-vas?c=tok B {{form_link.no_existe}}");
  });
});

describe("linkIdsFromVariables", () => {
  const S = "11111111-1111-4111-8111-111111111111";
  it("toma service.id y sale.id solo si son UUID", () => {
    expect(linkIdsFromVariables({ service: { id: S }, sale: { id: "no-uuid" } })).toEqual({ serviceId: S, saleId: null });
    expect(linkIdsFromVariables(undefined)).toEqual({ serviceId: null, saleId: null });
    expect(linkIdsFromVariables({ service: "x" })).toEqual({ serviceId: null, saleId: null });
  });
});
