import { describe, expect, it } from "vitest";
import { insertAtCursor, insertableText, isInsertableKind } from "./insert";

describe("insertableText", () => {
  it("un texto inserta su contenido; un enlace, su direccion", () => {
    expect(insertableText({ kind: "text", content: "  Hola {{contact.display_name}} ", url: null })).toBe("Hola {{contact.display_name}}");
    expect(insertableText({ kind: "link", content: null, url: "https://cal.com/ana" })).toBe("https://cal.com/ana");
  });

  it("lo que no es texto no se inserta: audio, video, imagen y archivo", () => {
    for (const kind of ["audio", "video", "image", "file"]) {
      expect(insertableText({ kind, content: "x", url: "https://x.com" })).toBeNull();
      expect(isInsertableKind(kind)).toBe(false);
    }
    expect(isInsertableKind("text")).toBe(true);
    expect(isInsertableKind("link")).toBe(true);
  });

  it("un texto o un enlace vacio no inserta nada", () => {
    expect(insertableText({ kind: "text", content: "   ", url: null })).toBeNull();
    expect(insertableText({ kind: "link", content: null, url: null })).toBeNull();
  });
});

describe("insertAtCursor", () => {
  it("inserta donde esta el cursor y lo deja justo despues", () => {
    expect(insertAtCursor("Hola , gracias", 5, 5, "Ana")).toEqual({ value: "Hola Ana, gracias", caret: 8 });
  });

  it("reemplaza la seleccion", () => {
    expect(insertAtCursor("Hola XXX", 5, 8, "Ana")).toEqual({ value: "Hola Ana", caret: 8 });
  });

  it("sin cursor (un campo que nunca tuvo foco) inserta al final", () => {
    expect(insertAtCursor("Hola", null, null, " Ana")).toEqual({ value: "Hola Ana", caret: 8 });
    expect(insertAtCursor("Hola", undefined, 99, "!")).toEqual({ value: "Hola!", caret: 5 });
  });

  it("en un texto vacio, queda solo lo insertado", () => {
    expect(insertAtCursor("", 0, 0, "https://x.com")).toEqual({ value: "https://x.com", caret: 13 });
  });
});
