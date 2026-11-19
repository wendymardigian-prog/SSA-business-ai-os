import { describe, expect, it } from "vitest";
import {
  blocksWithBlankLines,
  contractPasteText,
  editorDocToMarkdownWithBlankLines,
  markdownToEditorDocWithBlankLines,
  plainTextToEditorDoc,
} from "./blank-lines";
import { renderContractMarkdown } from "./markdown";
import type { DocNode } from "./editor-markdown";

const p = (text?: string): DocNode => (text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" });
const shape = (doc: DocNode) => (doc.content ?? []).map((n) => (n.content?.length ? "t" : "_"));

describe("renglones vacíos del contrato", () => {
  it("A, Enter, Enter, B y Shift+Enter C: se guarda, vuelve igual y se dibuja con un renglón en blanco", () => {
    const doc: DocNode = {
      type: "doc",
      content: [p("A"), p(), { type: "paragraph", content: [{ type: "text", text: "B" }, { type: "hardBreak" }, { type: "text", text: "C" }] }],
    };
    const saved = editorDocToMarkdownWithBlankLines(doc);
    expect(saved).toBe("A\n\n\n\nB\nC");
    expect(shape(markdownToEditorDocWithBlankLines(saved))).toEqual(["t", "_", "t"]);
    expect(blocksWithBlankLines(saved)).toEqual([
      { type: "paragraph", runs: [{ text: "A" }] },
      { type: "paragraph", runs: [] },
      { type: "paragraph", runs: [{ text: "B\nC" }] },
    ]);
  });

  it("un texto sin renglones vacíos se lee igual que siempre", () => {
    const text = "# Acuerdo\n\nEste contrato se firma con **buena fe**.\nSegunda línea.\n\n- uno\n- dos";
    expect(blocksWithBlankLines(text)).toEqual(renderContractMarkdown(text));
    expect(editorDocToMarkdownWithBlankLines(markdownToEditorDocWithBlankLines(text))).toBe(text);
  });

  it("los renglones vacíos del principio y del final se descartan", () => {
    expect(editorDocToMarkdownWithBlankLines({ type: "doc", content: [p(), p("a"), p(), p()] })).toBe("a");
    expect(blocksWithBlankLines("\n\n\n\na\n\n\n\n")).toEqual([{ type: "paragraph", runs: [{ text: "a" }] }]);
  });

  it("dos renglones vacíos seguidos se conservan", () => {
    const saved = editorDocToMarkdownWithBlankLines({ type: "doc", content: [p("a"), p(), p(), p("b")] });
    expect(saved).toBe("a\n\n\n\n\n\nb");
    expect(shape(markdownToEditorDocWithBlankLines(saved))).toEqual(["t", "_", "_", "t"]);
  });
});

describe("pegar en el contrato", () => {
  it("un texto plano conserva sus renglones vacíos y entra literal", () => {
    const doc = plainTextToEditorDoc("Cláusula 1\r\n\r\n1. no es una lista\n\n\n**tampoco negrita");
    expect(shape(doc)).toEqual(["t", "_", "t", "_", "_", "t"]);
    expect(doc.content?.[2].content?.[0].text).toBe("1. no es una lista");
  });

  it("un texto en Markdown se abre con su formato", () => {
    const doc = contractPasteText("## Título\n\nTexto con **negrita**")!;
    expect(doc.content?.[0].type).toBe("heading");
  });

  it("nada para pegar = lo de siempre", () => {
    expect(contractPasteText("   ")).toBeNull();
  });
});
