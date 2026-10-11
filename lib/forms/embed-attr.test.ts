import { describe, it, expect } from "vitest";
import { ATTR_MAX_BYTES, decodeAttr, encodeAttr } from "./embed-attr";

describe("attr del embed", () => {
  it("ida y vuelta, con acentos", () => {
    const value = { fbp: "fb.1.2.3", utm_campaign: "otoño ñandú", ts: 5 };
    const encoded = encodeAttr(value)!;
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeAttr(encoded)).toEqual(value);
  });

  it("más de 2 KB no se codifica", () => {
    expect(encodeAttr({ x: "a".repeat(ATTR_MAX_BYTES) })).toBeNull();
  });

  it("lo roto, lo que no es un objeto y lo enorme dan null y no lanzan", () => {
    expect(decodeAttr("%%%no es base64")).toBeNull();
    expect(decodeAttr(btoa("[1,2]").replace(/=+$/, ""))).toBeNull();
    expect(decodeAttr(btoa("texto suelto").replace(/=+$/, ""))).toBeNull();
    expect(decodeAttr("a".repeat(10_000))).toBeNull();
    expect(decodeAttr(null)).toBeNull();
    expect(decodeAttr("")).toBeNull();
  });
});
