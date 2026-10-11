import { describe, it, expect } from "vitest";
import { normalizeContractText } from "./contract-text";
import { contractTextSha256, hashContractText } from "./contract-hash";

describe("normalizeContractText", () => {
  it("lleva \\r\\n y \\r a \\n", () => {
    expect(normalizeContractText("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("quita espacios y tabs al final de cada línea, no al principio", () => {
    expect(normalizeContractText("  a  \n\tb\t \nc")).toBe("  a\n\tb\nc");
  });

  it("normaliza a NFC (la ñ compuesta y descompuesta quedan iguales)", () => {
    const decomposed = "mañana";
    expect(normalizeContractText(decomposed)).toBe("mañana");
  });
});

describe("hashContractText", () => {
  it("la huella es la de sha256 sobre el texto normalizado y guardado", () => {
    const { text, sha256 } = hashContractText("Hola\r\nmundo  ");
    expect(text).toBe("Hola\nmundo");
    expect(sha256).toBe(contractTextSha256("Hola\nmundo"));
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("valor conocido de sha256", () => {
    expect(contractTextSha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("dos textos distintos tienen huellas distintas", () => {
    expect(hashContractText("a").sha256).not.toBe(hashContractText("b").sha256);
  });
});
