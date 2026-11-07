import { describe, expect, it } from "vitest";
import { emptyDoc, type DesignElement } from "../doc/schema";
import { variableGroups, variableInfo } from "../variables/catalog";
import {
  addCustomVar,
  domToNodes,
  insertVariable,
  normalizeCustomKey,
  normalizeNodes,
  parseText,
  removeCustomVar,
  removeVarWarning,
  replaceVariable,
  serializeText,
  usedVariableRows,
  validateCustomVars,
  variableUsage,
  type MinimalNode,
  type TextNode,
} from "./variables";

const t = (text: string): TextNode => ({ kind: "text", text });
const v = (key: string): TextNode => ({ kind: "var", key });
const br: TextNode = { kind: "br" };

describe("texto con variables (F24)", () => {
  it("serializeText y parseText son ida y vuelta, con chips y saltos de línea", () => {
    const samples = [
      "Hola {{contact.first_name}}",
      "Se certifica que {{contact.display_name}} completó el curso.\nFecha: {{design.issued_on}}",
      "{{nombre_en_el_certificado}}",
      "{{a_b}}{{contact.email}}",
      "Sin variables",
      "",
      "Línea 1\n\nLínea 3\n",
    ];
    for (const sample of samples) expect(serializeText(parseText(sample)), JSON.stringify(sample)).toBe(sample);
  });

  it("parseText arma texto, chip y salto", () => {
    expect(parseText("Hola {{contact.first_name}}!\nChau")).toEqual([t("Hola "), v("contact.first_name"), t("!"), br, t("Chau")]);
    // Una variable mal escrita no es un chip: queda como texto.
    expect(parseText("{{Mal Escrita}}")).toEqual([t("{{Mal Escrita}}")]);
  });

  it("las llaves que escribe la persona no se vuelven una variable sin querer", () => {
    expect(serializeText([t("hola {{contact.email}} y {{x")])).toBe("hola {contact.email} y {x");
    expect(serializeText([t("a }} b")])).toBe("a } b");
  });

  it("normalizeNodes junta textos pegados y saca los vacíos", () => {
    expect(normalizeNodes([t("a"), t(""), t("b"), v("x"), t(""), t("c")])).toEqual([t("ab"), v("x"), t("c")]);
  });
});

describe("insertar una variable en el cursor (F24)", () => {
  it("en medio de un texto lo parte en dos", () => {
    const out = insertVariable([t("Hola mundo")], { index: 0, offset: 5 }, "contact.first_name");
    expect(out.nodes).toEqual([t("Hola "), v("contact.first_name"), t("mundo")]);
    expect(out.cursor).toEqual({ index: 2, offset: 0 });
    expect(serializeText(out.nodes)).toBe("Hola {{contact.first_name}}mundo");
  });

  it("si el cursor está dentro de otro chip, la deja DESPUÉS de él", () => {
    const nodes = [t("A "), v("contact.first_name"), t(" B")];
    const out = insertVariable(nodes, { index: 1, offset: 3 }, "contact.email");
    expect(out.nodes).toEqual([t("A "), v("contact.first_name"), v("contact.email"), t(" B")]);
    expect(out.cursor.index).toBe(3);
  });

  it("al principio, al final y sin cursor", () => {
    expect(insertVariable([t("x")], { index: 0, offset: 0 }, "a_b").nodes).toEqual([v("a_b"), t("x")]);
    expect(insertVariable([t("x")], { index: 0, offset: 99 }, "a_b").nodes).toEqual([t("x"), v("a_b")]);
    expect(insertVariable([t("x")], null, "a_b").nodes).toEqual([t("x"), v("a_b")]);
    expect(insertVariable([], null, "a_b").nodes).toEqual([v("a_b")]);
    expect(insertVariable([t("x")], { index: 9, offset: 0 }, "a_b").nodes).toEqual([t("x"), v("a_b")]);
  });

  it("junto a un salto de línea", () => {
    expect(insertVariable([t("a"), br, t("b")], { index: 1, offset: 0 }, "x_y").nodes).toEqual([t("a"), v("x_y"), br, t("b")]);
    expect(insertVariable([t("a"), br, t("b")], { index: 1, offset: 1 }, "x_y").nodes).toEqual([t("a"), br, v("x_y"), t("b")]);
  });

  it("tocar un chip: cambiar por otra o quitarla", () => {
    const nodes = [t("Hola "), v("contact.first_name"), t("!")];
    expect(replaceVariable(nodes, 1, "contact.display_name")).toEqual([t("Hola "), v("contact.display_name"), t("!")]);
    expect(replaceVariable(nodes, 1, null)).toEqual([t("Hola !")]);
    expect(replaceVariable(nodes, 0, null)).toEqual(nodes);
  });
});

describe("del campo editable a nodos (F24)", () => {
  const text = (value: string): MinimalNode => ({ nodeType: 3, nodeName: "#text", textContent: value, childNodes: [] });
  const el = (name: string, children: MinimalNode[] = [], dataset?: Record<string, string>): MinimalNode => ({ nodeType: 1, nodeName: name, textContent: null, dataset, childNodes: children });

  it("texto, chips con data-var y <br>", () => {
    const root = el("DIV", [text("Hola "), el("SPAN", [text("Nombre")], { var: "contact.first_name" }), text("!"), el("BR"), text("Chau")]);
    expect(domToNodes(root)).toEqual([t("Hola "), v("contact.first_name"), t("!"), br, t("Chau")]);
  });

  it("los <div> que crea Enter en algunos navegadores separan renglones", () => {
    const root = el("DIV", [text("uno"), el("DIV", [text("dos")]), el("DIV", [text("tres")])]);
    expect(serializeText(normalizeNodes(domToNodes(root)))).toBe("uno\ndos\ntres");
  });

  it("un chip con una clave rara se descarta (no entra al documento)", () => {
    const root = el("DIV", [el("SPAN", [text("x")], { var: "Mal Escrita" }), text("ok")]);
    expect(domToNodes(root)).toEqual([t("ok")]);
  });
});

describe("variables propias (F24)", () => {
  it("el nombre en español se vuelve una clave sin tildes en snake_case", () => {
    expect(normalizeCustomKey("Nombre en el certificado")).toBe("nombre_en_el_certificado");
    expect(normalizeCustomKey("  Año de Ingreso  ")).toBe("ano_de_ingreso");
  });

  it("agregar crea la clave, y rechaza vacíos y repetidos", () => {
    const first = addCustomVar([], "Nombre en el certificado", "Ana Pérez");
    expect(first).toMatchObject({ ok: true, key: "nombre_en_el_certificado" });
    if (!first.ok) throw new Error("no debería fallar");
    expect(first.list).toEqual([{ key: "nombre_en_el_certificado", label: "Nombre en el certificado", sample: "Ana Pérez", default: null }]);
    expect(addCustomVar(first.list, "nombre en el CERTIFICADO")).toMatchObject({ ok: false });
    expect(addCustomVar(first.list, "   ")).toMatchObject({ ok: false });
    expect(addCustomVar(first.list, "x".repeat(61))).toMatchObject({ ok: false });
  });

  it("no se puede llamar como una variable del sistema (ni como su grupo)", () => {
    expect(addCustomVar([], "Contact")).toMatchObject({ ok: false });
    expect(addCustomVar([], "Workspace")).toMatchObject({ ok: false });
    expect(validateCustomVars([{ key: "contact", label: "Contacto", sample: "" }])).toMatchObject({ ok: false });
  });

  it("validateCustomVars revisa la forma de cada clave, que no se repita y los largos", () => {
    expect(validateCustomVars([{ key: "nombre_1", label: "Nombre", sample: "Ana" }])).toMatchObject({ ok: true });
    expect(validateCustomVars([{ key: "Nombre", label: "Nombre", sample: "" }])).toMatchObject({ ok: false });
    expect(validateCustomVars([{ key: "a", label: "A", sample: "" }])).toMatchObject({ ok: false });
    expect(validateCustomVars([{ key: "con.punto", label: "A", sample: "" }])).toMatchObject({ ok: false });
    expect(validateCustomVars([{ key: "con espacio", label: "A", sample: "" }])).toMatchObject({ ok: false });
    expect(validateCustomVars([{ key: "ab", label: "A", sample: "" }, { key: "ab", label: "B", sample: "" }])).toMatchObject({ ok: false });
    expect(validateCustomVars([{ key: "ab", label: "", sample: "" }])).toMatchObject({ ok: false });
    expect(validateCustomVars([{ key: "ab", label: "A", sample: "x".repeat(201) }])).toMatchObject({ ok: false });
    expect(validateCustomVars("no es una lista")).toMatchObject({ ok: false });
    expect(validateCustomVars(Array.from({ length: 31 }, (_, i) => ({ key: `clave_${i}`, label: `V ${i}`, sample: "" })))).toMatchObject({ ok: false });
    expect(validateCustomVars([null])).toMatchObject({ ok: false });
  });

  it("ninguna clave propia choca con una del sistema", () => {
    const system = variableGroups({ verify: true }).filter((g) => g.key !== "propias").flatMap((g) => g.vars.map((x) => x.key));
    for (const key of system) expect(validateCustomVars([{ key: key.replace(/\./g, "_"), label: "X", sample: "" }]).ok, key).toBe(true);
    // Las claves del sistema llevan punto: una clave propia (sin punto) nunca puede ser igual.
    expect(system.every((k) => k.includes("."))).toBe(true);
  });

  it("borrar avisa si la variable está en uso", () => {
    const doc = emptyDoc("carta_h");
    const el = (id: string, text: string): DesignElement => ({ id, type: "text", x: 50, y: 50, w: 40, text, font: { family: "Inter", weight: 400 }, size: 30, align: "left", color: "#111111" });
    doc.pages[0].elements = [el("el_aaaaaa", "{{nombre_en_el_certificado}} y {{nombre_en_el_certificado}}"), el("el_bbbbbb", "{{contact.email}}")];
    expect(variableUsage(doc, "nombre_en_el_certificado")).toBe(2);
    expect(variableUsage(doc, "otra")).toBe(0);
    expect(removeVarWarning("Nombre en el certificado", 2)).toContain("2 veces");
    expect(removeVarWarning("Nombre", 1)).toContain("1 vez");
    expect(removeVarWarning("Nombre", 0)).toBeNull();
    expect(removeCustomVar([{ key: "ab", label: "A", sample: "", default: null }], "ab")).toEqual([]);
  });

  it("las usadas en la plantilla salen con su grupo y su valor de ejemplo", () => {
    const doc = emptyDoc("carta_h");
    doc.pages[0].elements = [{ id: "el_aaaaaa", type: "text", x: 50, y: 50, w: 40, text: "{{contact.display_name}} {{nombre_en_el_certificado}} {{rara}}", font: { family: "Inter", weight: 400 }, size: 30, align: "left", color: "#111111" }];
    const custom = [{ key: "nombre_en_el_certificado", label: "Nombre en el certificado", sample: "Ana M. Pérez", default: null }];
    expect(usedVariableRows(doc, custom)).toEqual([
      { key: "contact.display_name", label: "Nombre completo", group: "Contacto", sample: "Ana Pérez", known: true },
      { key: "nombre_en_el_certificado", label: "Nombre en el certificado", group: "Propias", sample: "Ana M. Pérez", known: true },
      { key: "rara", label: "rara", group: "Desconocida", sample: "", known: false },
    ]);
  });

  it("el menú solo ofrece design.code y design.doc_type en plantillas con verificación", () => {
    const keys = (verify: boolean) => variableGroups({ verify }).flatMap((g) => g.vars.map((x) => x.key));
    expect(keys(false)).not.toContain("design.code");
    expect(keys(false)).not.toContain("design.doc_type");
    expect(keys(true)).toContain("design.code");
    expect(variableInfo("design.code").known).toBe(true);
  });
});
