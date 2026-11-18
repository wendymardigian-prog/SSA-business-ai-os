import { describe, expect, it } from "vitest";
import { headText, tailText } from "./safe-slice";

const EMOJI = "😀"; // dos unidades UTF-16

/** Lo que rompía el pedido a la IA: una mitad de emoji suelta. */
function wellFormed(text: string): boolean {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);
}

describe("headText", () => {
  it("sin emoji en el borde da lo mismo que slice", () => {
    expect(headText("hola mundo", 4)).toBe("hola");
    expect(headText(`ab${EMOJI}cd`, 4)).toBe(`ab${EMOJI}`);
  });

  it("un texto que entra queda igual", () => {
    expect(headText("hola", 10)).toBe("hola");
    expect(headText("", 10)).toBe("");
  });

  it("con un emoji partido en el borde, lo deja afuera entero", () => {
    const text = `abc${EMOJI}def`;
    const cut = headText(text, 4); // slice dejaria "abc" + la primera mitad
    expect(cut).toBe("abc");
    expect(wellFormed(cut)).toBe(true);
    expect(wellFormed(text.slice(0, 4))).toBe(false);
  });

  it("el resultado se puede mandar como JSON", () => {
    const cut = headText(`x${EMOJI}`, 2);
    expect(JSON.parse(JSON.stringify({ t: cut })).t).toBe("x");
    expect(cut.isWellFormed()).toBe(true);
  });

  it("un tope de cero o negativo da vacío", () => {
    expect(headText("hola", 0)).toBe("");
  });
});

describe("tailText", () => {
  it("sin emoji en el borde da lo mismo que slice", () => {
    expect(tailText("hola mundo", 5)).toBe("mundo");
  });

  it("con un emoji partido en el borde, lo deja afuera entero", () => {
    const text = `abc${EMOJI}def`;
    const cut = tailText(text, 4); // slice dejaria la segunda mitad + "def"
    expect(cut).toBe("def");
    expect(cut.isWellFormed()).toBe(true);
    expect(text.slice(text.length - 4).isWellFormed()).toBe(false);
  });

  it("un texto que entra queda igual", () => {
    expect(tailText(`a${EMOJI}`, 10)).toBe(`a${EMOJI}`);
  });
});
