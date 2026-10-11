import { describe, it, expect } from "vitest";
import { renderContractMarkdown, parseInline, plainText } from "./markdown";

describe("renderContractMarkdown", () => {
  it("un título, un párrafo con negrita y el <script> como texto, sin interpretarlo", () => {
    const blocks = renderContractMarkdown("# Título\n**hola** <script>x</script>");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: "heading", level: 1, runs: [{ text: "Título" }] });
    expect(blocks[1]).toEqual({ type: "paragraph", runs: [{ text: "hola", bold: true }, { text: " <script>x</script>" }] });
  });

  it("## es un título de segundo nivel y los más profundos también", () => {
    const blocks = renderContractMarkdown("## Cláusula\n\n### Subcláusula");
    expect(blocks.map((b) => (b.type === "heading" ? b.level : 0))).toEqual([2, 2]);
  });

  it("listas con viñetas y numeradas, cada una en su bloque", () => {
    const blocks = renderContractMarkdown("- uno\n- dos\n\n1. primero\n2. segundo");
    expect(blocks).toEqual([
      { type: "list", ordered: false, items: [[{ text: "uno" }], [{ text: "dos" }]] },
      { type: "list", ordered: true, items: [[{ text: "primero" }], [{ text: "segundo" }]] },
    ]);
  });

  it("pasar de viñetas a numeradas sin línea en blanco parte la lista", () => {
    const blocks = renderContractMarkdown("- a\n1. b");
    expect(blocks.map((b) => (b.type === "list" ? b.ordered : null))).toEqual([false, true]);
  });

  it("los párrafos se separan por línea en blanco y conservan los saltos simples", () => {
    const blocks = renderContractMarkdown("Línea uno\nLínea dos\n\nOtro párrafo");
    expect(blocks).toHaveLength(2);
    expect(plainText((blocks[0] as { runs: { text: string }[] }).runs)).toBe("Línea uno\nLínea dos");
  });

  it("los saltos de línea de Windows (\\r\\n) se tratan igual", () => {
    expect(renderContractMarkdown("# A\r\n\r\nB")).toEqual(renderContractMarkdown("# A\n\nB"));
  });

  it("links e imágenes no se interpretan: quedan como texto", () => {
    const [p] = renderContractMarkdown("[click](http://x.com) ![img](http://x.com/a.png)");
    expect(plainText((p as { runs: { text: string }[] }).runs)).toBe("[click](http://x.com) ![img](http://x.com/a.png)");
  });

  it("HTML suelto queda como texto, nunca como marcado", () => {
    const [p] = renderContractMarkdown('<img src=x onerror="alert(1)"> <b>hola</b>');
    expect(p.type).toBe("paragraph");
    expect(plainText((p as { runs: { text: string }[] }).runs)).toBe('<img src=x onerror="alert(1)"> <b>hola</b>');
  });

  it("un texto vacío da cero bloques", () => {
    expect(renderContractMarkdown("")).toEqual([]);
    expect(renderContractMarkdown("\n\n  \n")).toEqual([]);
  });

  it("# sin espacio no es un título (es parte de un párrafo)", () => {
    expect(renderContractMarkdown("#hashtag")[0].type).toBe("paragraph");
  });
});

describe("parseInline", () => {
  it("negrita y cursiva, juntas y por separado", () => {
    expect(parseInline("a **b** c *d* e _f_")).toEqual([
      { text: "a " },
      { text: "b", bold: true },
      { text: " c " },
      { text: "d", italic: true },
      { text: " e " },
      { text: "f", italic: true },
    ]);
  });
  it("lo que no cierra queda literal", () => {
    expect(parseInline("5 * 3 y **sin cerrar")).toEqual([{ text: "5 * 3 y **sin cerrar" }]);
    expect(parseInline("snake_case_name")).toEqual([{ text: "snake_case_name" }]);
  });
  it("sin marcas devuelve un solo tramo", () => {
    expect(parseInline("hola")).toEqual([{ text: "hola" }]);
    expect(parseInline("")).toEqual([]);
  });
});
