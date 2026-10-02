import { describe, it, expect } from "vitest";
import { comunicacionTabHref, isTabActive, INBOX_HREF } from "./tab-href";

describe("comunicacionTabHref (I5: volver a Conversaciones conserva los filtros)", () => {
  it("desde Broadcasts, Conversaciones vuelve con los filtros recordados", () => {
    expect(
      comunicacionTabHref(INBOX_HREF, "/dashboard/broadcasts", "", "canal=instagram&tag=abc"),
    ).toBe("/dashboard/inbox?canal=instagram&tag=abc");
  });

  it("sin nada recordado, la ruta pelada", () => {
    expect(comunicacionTabHref(INBOX_HREF, "/dashboard/growth", "", null)).toBe("/dashboard/inbox");
    expect(comunicacionTabHref(INBOX_HREF, "/dashboard/growth", "", "")).toBe("/dashboard/inbox");
  });

  it("en la Bandeja, la query actual gana sobre la recordada", () => {
    expect(
      comunicacionTabHref(INBOX_HREF, "/dashboard/inbox", "estado=closed", "estado=open"),
    ).toBe("/dashboard/inbox?estado=closed");
  });

  it("tolera el signo de pregunta adelante", () => {
    expect(comunicacionTabHref(INBOX_HREF, "/dashboard/sequences", "", "?q=ana")).toBe(
      "/dashboard/inbox?q=ana",
    );
  });

  it("las otras pestañas no arrastran nada", () => {
    expect(
      comunicacionTabHref("/dashboard/broadcasts", "/dashboard/inbox", "q=ana", "q=ana"),
    ).toBe("/dashboard/broadcasts");
  });
});

describe("isTabActive", () => {
  it("marca por prefijo: el detalle de una secuencia deja marcada Sequences", () => {
    expect(isTabActive("/dashboard/sequences", "/dashboard/sequences/123")).toBe(true);
    expect(isTabActive("/dashboard/inbox", "/dashboard/sequences")).toBe(false);
  });
});
