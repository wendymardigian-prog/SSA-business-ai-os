import { describe, expect, it } from "vitest";
import { portalDenied } from "./denied";

describe("portalDenied", () => {
  it("deja pasar los códigos propios del módulo con su texto", () => {
    expect(portalDenied({ code: "PO403", message: "Esta clase todavía no está abierta" })).toEqual({ ok: false, code: "PO403", message: "Esta clase todavía no está abierta" });
  });
  it("un error de Postgres sale sin código ni detalle", () => {
    const out = portalDenied({ code: "22P02", message: "invalid input syntax for type uuid" });
    expect(out.code).toBeNull();
    expect(out.message).not.toContain("uuid");
  });
});
