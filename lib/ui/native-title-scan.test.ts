import { describe, expect, it } from "vitest";
import { findNativeTitles } from "./native-title-scan";

describe("findNativeTitles", () => {
  it("encuentra el title de un elemento y de un Link", () => {
    const src = `<span title="Hola">x</span>\n<Link href="/a" title={label}>a</Link>`;
    expect(findNativeTitles(src)).toEqual([
      { line: 1, tag: "span" },
      { line: 2, tag: "Link" },
    ]);
  });

  it("no cuenta las props de componentes propios, iframe ni <title>", () => {
    expect(findNativeTitles(`<Section title="Datos"><iframe title="Vista" /><svg><title>x</title></svg></Section>`)).toEqual([]);
  });

  it("una flecha adentro de la etiqueta no la cierra", () => {
    expect(findNativeTitles(`<button onClick={() => go()} title="Abrir">x</button>`)).toEqual([{ line: 1, tag: "button" }]);
  });

  it("un title= adentro de una expresion (un objeto) no cuenta", () => {
    expect(findNativeTitles(`<Card {...{ title: "x" }} />\nconst a = { title: "x" };`)).toEqual([]);
  });
});
