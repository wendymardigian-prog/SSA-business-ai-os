import { describe, expect, it } from "vitest";
import { inboxLayoutClasses } from "./layout";

describe("inboxLayoutClasses", () => {
  it("sin panel: ni panel ni botón", () => {
    const c = inboxLayoutClasses("open", false);
    expect(c.panel).toBe("md:hidden");
    expect(c.contactButton).toBe("hidden");
    expect(c.list).toBe("");
  });

  it("auto: el panel aparece solo cuando entran las tres columnas, y el botón al revés", () => {
    const c = inboxLayoutClasses("auto", true);
    expect(c.panel).toContain("md:hidden");
    expect(c.panel).toContain("@min-[64rem]/inbox:flex");
    expect(c.contactButton).toContain("@min-[64rem]/inbox:hidden");
    expect(c.list).toBe("");
  });

  it("abierto a pedido: se esconde la lista cuando no hay lugar, nunca el hilo", () => {
    const c = inboxLayoutClasses("open", true);
    expect(c.list).toBe("@max-[64rem]/inbox:hidden");
    expect(c.panel).toContain("md:flex");
    expect(c.panel).toContain("@max-[44rem]/inbox:absolute");
    expect(c.contactButton).toBe("flex md:hidden");
  });

  it("cerrado: el botón siempre a la vista", () => {
    const c = inboxLayoutClasses("closed", true);
    expect(c.panel).toBe("md:hidden");
    expect(c.contactButton).toBe("flex");
  });
});
