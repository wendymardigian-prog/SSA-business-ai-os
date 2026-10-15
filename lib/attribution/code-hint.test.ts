import { describe, expect, it } from "vitest";
import { attributionCodeHint } from "./code-hint";

describe("attributionCodeHint", () => {
  it("arma el parámetro con el código", () => {
    expect(attributionCodeHint("c8k2f")).toEqual({ code: "c8k2f", param: "?utm_content=c8k2f" });
  });

  it("limpia espacios y codifica lo que no es seguro en una URL", () => {
    expect(attributionCodeHint("  c8k2f ")?.code).toBe("c8k2f");
    expect(attributionCodeHint("a b&c")?.param).toBe("?utm_content=a%20b%26c");
  });

  it("sin código no hay nada que mostrar", () => {
    expect(attributionCodeHint(null)).toBeNull();
    expect(attributionCodeHint(undefined)).toBeNull();
    expect(attributionCodeHint("   ")).toBeNull();
  });
});
