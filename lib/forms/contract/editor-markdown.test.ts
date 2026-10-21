import { describe, expect, it } from "vitest";
import { editorDocToMarkdown, markdownToEditorDoc, type DocNode } from "./editor-markdown";
import { renderContractMarkdown } from "./markdown";

const t = (text: string, ...marks: Array<string | { type: string; attrs: Record<string, unknown> }>): DocNode => ({
  type: "text",
  text,
  ...(marks.length ? { marks: marks.map((m) => (typeof m === "string" ? { type: m } : m)) } : {}),
});
const link = (href: string) => ({ type: "link", attrs: { href } });
const p = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const doc = (...content: DocNode[]): DocNode => ({ type: "doc", content });

/** Guardar, volver a abrir y volver a guardar da exactamente lo mismo. */
function stable(d: DocNode): string {
  const md = editorDocToMarkdown(d);
  expect(editorDocToMarkdown(markdownToEditorDoc(md))).toBe(md);
  return md;
}

describe("editorDocToMarkdown", () => {
  it("títulos 1, 2 y 3, párrafos y listas", () => {
    const md = stable(
      doc(
        { type: "heading", attrs: { level: 1 }, content: [t("Contrato")] },
        { type: "heading", attrs: { level: 2 }, content: [t("Partes")] },
        { type: "heading", attrs: { level: 3 }, content: [t("Detalle")] },
        p(t("Texto.")),
        { type: "bulletList", content: [{ type: "listItem", content: [p(t("uno"))] }, { type: "listItem", content: [p(t("dos"))] }] },
        { type: "orderedList", attrs: { start: 1 }, content: [{ type: "listItem", content: [p(t("primero"))] }, { type: "listItem", content: [p(t("segundo"))] }] },
      ),
    );
    expect(md).toBe("# Contrato\n\n## Partes\n\n### Detalle\n\nTexto.\n\n- uno\n- dos\n\n1. primero\n2. segundo");
  });

  it("negrita, cursiva, las dos juntas y links, sin que se mezclen", () => {
    const md = stable(
      doc(
        p(
          t("Hola "),
          t("negrita", "bold"),
          t(" y "),
          t("cursiva", "italic"),
          t(" y "),
          t("las", "bold", "italic"),
          t(" dos", "bold"),
          t(". Ver "),
          t("la web", link("https://a.com/x?y=(1)")),
          t("."),
        ),
      ),
    );
    expect(renderContractMarkdown(md)).toEqual([
      {
        type: "paragraph",
        runs: [
          { text: "Hola " },
          { text: "negrita", bold: true },
          { text: " y " },
          { text: "cursiva", italic: true },
          { text: " y " },
          { text: "las", bold: true, italic: true },
          { text: " dos", bold: true },
          { text: ". Ver " },
          { text: "la web", href: "https://a.com/x?y=%281%29" },
          { text: "." },
        ],
      },
    ]);
  });

  it("una cursiva pegada a una negrita y una cursiva en el medio de una palabra", () => {
    const md = stable(doc(p(t("a", "italic"), t("b", "bold", "italic"), t(" pal"), t("abra", "italic"), t("s"))));
    expect(renderContractMarkdown(md)).toEqual([
      {
        type: "paragraph",
        runs: [{ text: "a", italic: true }, { text: "b", bold: true, italic: true }, { text: " pal" }, { text: "abra", italic: true }, { text: "s" }],
      },
    ]);
  });

  it("los espacios del borde quedan fuera de la negrita", () => {
    expect(stable(doc(p(t("a"), t(" b ", "bold"), t("c"))))).toBe("a **b** c");
  });

  it("los caracteres que parecen formato vuelven como texto", () => {
    const text = "5 * 3 = 15, snake_case, [corchetes](https://no.es) y \\barra";
    const md = stable(doc(p(t(text)), p(t("# no es título")), p(t("- no es lista")), p(t("1. no es numerada"))));
    const blocks = renderContractMarkdown(md);
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph", "paragraph", "paragraph"]);
    expect(blocks.map((b) => (b.type === "paragraph" ? b.runs.map((r) => r.text).join("") : ""))).toEqual([
      text,
      "# no es título",
      "- no es lista",
      "1. no es numerada",
    ]);
    expect(blocks.every((b) => b.type !== "paragraph" || b.runs.every((r) => !r.href && !r.bold && !r.italic))).toBe(true);
  });

  it("un salto dentro de un párrafo se conserva; dentro de un título o un ítem pasa a espacio", () => {
    const md = stable(
      doc(
        p(t("uno"), { type: "hardBreak" }, t("dos")),
        { type: "heading", attrs: { level: 2 }, content: [t("a"), { type: "hardBreak" }, t("b")] },
        { type: "bulletList", content: [{ type: "listItem", content: [p(t("c"), { type: "hardBreak" }, t("d"))] }] },
      ),
    );
    expect(md).toBe("uno\ndos\n\n## a b\n\n- c d");
  });

  it("las listas adentro de listas se aplanan sin perder texto", () => {
    const md = editorDocToMarkdown(
      doc({
        type: "bulletList",
        content: [{ type: "listItem", content: [p(t("padre")), { type: "bulletList", content: [{ type: "listItem", content: [p(t("hijo"))] }] }] }],
      }),
    );
    expect(md).toBe("- padre\n- hijo");
  });

  it("las variables viajan tal cual, también con formato", () => {
    const md = stable(doc(p(t("Entre "), { type: "variable", attrs: { name: "respuesta.empresa" }, marks: [{ type: "bold" }] }, t(" y nosotros."))));
    expect(md).toBe("Entre **{{respuesta.empresa}}** y nosotros.");
  });

  it("los párrafos vacíos no dejan basura", () => {
    expect(editorDocToMarkdown(doc({ type: "paragraph" }, p(t("a")), { type: "paragraph" }))).toBe("a");
    expect(editorDocToMarkdown(doc({ type: "paragraph" }))).toBe("");
  });
});

describe("ida y vuelta con combinaciones al azar (semilla fija)", () => {
  // Un generador chico y determinístico: la prueba da siempre lo mismo.
  let seed = 42;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const pieces = ["ab", "c", " ", "x y", "*", "_", "**", "[", "]", "(", ")", "\\", "1. ", "# ", "- ", "{", "}", "á", "z_z", "!"];
  const hrefs = [null, null, null, "https://a.com", "mailto:ana@x.com"];

  /** Cada carácter con su formato; los espacios valen solo por el texto (pueden salir de una marca). */
  const flatten = (runs: Array<{ text: string; bold?: boolean; italic?: boolean; href?: string | null }>) =>
    runs.flatMap((r) => [...r.text].map((c) => (/\s/.test(c) ? c : `${c}|${r.bold ? "b" : ""}${r.italic ? "i" : ""}|${r.href ?? ""}`)));

  it("5000 párrafos: el texto y el formato de cada carácter se conservan", () => {
    for (let n = 0; n < 5000; n++) {
      const segs = Array.from({ length: 1 + rand(5) }, () => ({
        text: Array.from({ length: 1 + rand(3) }, () => pieces[rand(pieces.length)]).join(""),
        bold: rand(3) === 0,
        italic: rand(3) === 0,
        href: hrefs[rand(hrefs.length)],
      }));
      // Un link que solo tiene espacios no es un link (el editor tampoco lo deja): no se prueba.
      const cleaned = segs.map((s) => (s.href && !s.text.trim() ? { ...s, href: null } : s));
      const d = doc(
        p(
          ...cleaned.map((s) =>
            t(s.text, ...[...(s.bold ? ["bold"] : []), ...(s.italic ? ["italic"] : []), ...(s.href ? [link(s.href)] : [])]),
          ),
        ),
      );
      const md = editorDocToMarkdown(d);
      const blocks = renderContractMarkdown(md);
      const runs = blocks.flatMap((b) => (b.type === "paragraph" ? b.runs : []));
      const text = (rs: Array<{ text: string }>) => rs.map((r) => r.text).join("").trim();
      // Un párrafo que es solo espacios no se guarda.
      if (!text(cleaned)) continue;
      const formatted = (rs: Parameters<typeof flatten>[0]) => flatten(rs).filter((c) => !/^\s$/.test(c));
      expect({ md, text: text(runs), format: formatted(runs) }).toEqual({ md, text: text(cleaned), format: formatted(cleaned) });
    }
  });
});

describe("markdownToEditorDoc", () => {
  it("un texto vacío abre un párrafo vacío", () => {
    expect(markdownToEditorDoc("")).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  it("las variables se abren como fichas", () => {
    const d = markdownToEditorDoc("Hola {{contacto.nombre}}!");
    expect(d.content?.[0].content).toEqual([{ type: "text", text: "Hola " }, { type: "variable", attrs: { name: "contacto.nombre" } }, { type: "text", text: "!" }]);
  });

  it("un contrato escrito a mano antes del editor se abre y, al guardarlo sin cambios, se lee igual", () => {
    const legacy = "# Contrato\n\nEntre **las partes** y *nosotros*.\nSegunda línea.\n\n* item\n* otro\n\n1) uno\n2) dos\n\n### Cierre\n\n5 * 3 y snake_case_name";
    const saved = editorDocToMarkdown(markdownToEditorDoc(legacy));
    expect(renderContractMarkdown(saved)).toEqual(renderContractMarkdown(legacy));
  });
});
