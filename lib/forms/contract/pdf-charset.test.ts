import { describe, expect, it } from "vitest";
import { toWinAnsi, unsupportedPdfChars } from "./pdf-charset";

describe("unsupportedPdfChars", () => {
  it("el español y los símbolos de Windows-1252 se pueden escribir", () => {
    expect(unsupportedPdfChars("áéíóú ñ ü ¿? ¡! 5 € “hola” — fin\nlínea")).toEqual([]);
  });

  it("los emojis y otros alfabetos no, y cada uno aparece una vez", () => {
    expect(unsupportedPdfChars("Hola 😀 y 😀 y 👍🏽 日")).toEqual(["😀", "👍🏽", "日"]);
  });

  it("es la misma regla que usa el PDF: lo que avisa es lo que sale como ?", () => {
    const text = "Firmá ✍️ acá";
    expect(unsupportedPdfChars(text).length > 0).toBe(toWinAnsi(text).includes("?"));
  });
});
