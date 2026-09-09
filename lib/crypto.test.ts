import { describe, it, expect } from "vitest";
import { constantTimeEquals } from "./crypto";

describe("constantTimeEquals", () => {
  it("reconoce dos strings iguales", () => {
    expect(constantTimeEquals("secreto", "secreto")).toBe(true);
  });

  it("rechaza dos del mismo largo que difieren", () => {
    expect(constantTimeEquals("secreto", "secretx")).toBe(false);
  });

  it("con largos distintos devuelve false en vez de lanzar", () => {
    // timingSafeEqual explota si los buffers no miden lo mismo. El chequeo de
    // largo no es una optimizacion: sin el, un token corto tumba el endpoint.
    expect(() => constantTimeEquals("corto", "mucho mas largo")).not.toThrow();
    expect(constantTimeEquals("corto", "mucho mas largo")).toBe(false);
  });

  it("el string vacio solo coincide con el vacio", () => {
    expect(constantTimeEquals("", "")).toBe(true);
    expect(constantTimeEquals("", "x")).toBe(false);
  });

  it("compara bytes, no caracteres: los acentos no confunden", () => {
    expect(constantTimeEquals("á", "á")).toBe(true);
    expect(constantTimeEquals("á", "a")).toBe(false);
  });
});
