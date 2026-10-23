import { describe, expect, it } from "vitest";
import { MAX_CALL_MESSAGE, normalizeCallMessage } from "./settings";

describe("normalizeCallMessage", () => {
  it("limpia espacios y acepta vacío", () => {
    expect(normalizeCallMessage("  hola \r\n chau ")).toBe("hola \n chau");
    expect(normalizeCallMessage(undefined)).toBe("");
  });

  it("rechaza un mensaje demasiado largo", () => {
    expect(normalizeCallMessage("x".repeat(MAX_CALL_MESSAGE + 1))).toBeNull();
  });
});
