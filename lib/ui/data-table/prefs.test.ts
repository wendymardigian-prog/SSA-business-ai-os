import { describe, expect, it } from "vitest";
import {
  canonicalPrefs, clampWidth, columnWidth, emptyPrefs, isColumnVisible, isDefaultPrefs, menuSections, moveColumn, moveColumnTo, normalizePrefs,
  orderedKeys, parsePrefs, resetColumns, resetWidths, setColumnWidth, showAllColumns, togglePinned, toggleColumn, visibleColumns, type ColumnMeta,
} from "./prefs";

const METAS: ColumnMeta[] = [
  { key: "date", label: "Fecha", hideable: false },
  { key: "contact", label: "Contacto" },
  { key: "product", label: "Producto", defaultWidth: 220 },
  { key: "variant", label: "Variante" },
  { key: "origin", label: "Origen", defaultVisible: false, group: "Atribución" },
  { key: "actions", label: "", pinnable: false, resizable: false },
];

describe("preferencias de columnas", () => {
  it("sin nada guardado, todo es lo normal", () => {
    const prefs = emptyPrefs();
    expect(visibleColumns(METAS, prefs).map((c) => c.key)).toEqual(["date", "contact", "product", "variant", "actions"]);
    expect(isDefaultPrefs(prefs)).toBe(true);
  });

  it("prender y apagar se guarda como diferencia, y volver a lo normal no deja rastro", () => {
    let prefs = toggleColumn(METAS, emptyPrefs(), "origin");
    expect(prefs.shown).toEqual(["origin"]);
    prefs = toggleColumn(METAS, prefs, "origin");
    expect(isDefaultPrefs(prefs)).toBe(true);
    prefs = toggleColumn(METAS, prefs, "variant");
    expect(prefs.hidden).toEqual(["variant"]);
    expect(isColumnVisible(METAS[3], prefs)).toBe(false);
  });

  it("una columna no ocultable no se apaga", () => {
    expect(toggleColumn(METAS, emptyPrefs(), "date")).toEqual(emptyPrefs());
  });

  it("reordenar: sube, baja y arrastra; el orden del catálogo no se guarda", () => {
    let prefs = moveColumn(METAS, emptyPrefs(), "variant", -1);
    expect(orderedKeys(METAS, prefs).slice(0, 4)).toEqual(["date", "contact", "variant", "product"]);
    prefs = moveColumn(METAS, prefs, "variant", 1);
    expect(prefs.order).toEqual([]);
    prefs = moveColumnTo(METAS, emptyPrefs(), "variant", "contact");
    expect(orderedKeys(METAS, prefs).slice(0, 3)).toEqual(["date", "variant", "contact"]);
    expect(moveColumn(METAS, emptyPrefs(), "date", -1)).toEqual(emptyPrefs());
  });

  it("una columna que no estaba en el orden guardado va al final de lo elegido", () => {
    const prefs = { ...emptyPrefs(), order: ["variant", "date"] };
    expect(orderedKeys(METAS, prefs)).toEqual(["variant", "date", "contact", "product", "origin", "actions"]);
  });

  it("fijar respeta las columnas que no se pueden fijar", () => {
    let prefs = togglePinned(METAS, emptyPrefs(), "contact");
    prefs = togglePinned(METAS, prefs, "date");
    expect(prefs.pinned).toEqual(["contact", "date"]);
    expect(togglePinned(METAS, prefs, "actions").pinned).toEqual(["contact", "date"]);
    expect(togglePinned(METAS, prefs, "contact").pinned).toEqual(["date"]);
  });

  it("los anchos: se limitan, y uno igual al normal no deja rastro", () => {
    expect(clampWidth(10)).toBe(80);
    expect(clampWidth(5000)).toBe(640);
    expect(clampWidth(Number.NaN)).toBe(80);
    let prefs = setColumnWidth(METAS, emptyPrefs(), "product", 300);
    expect(columnWidth(METAS[2], prefs)).toBe(300);
    prefs = setColumnWidth(METAS, prefs, "product", 220);
    expect(prefs.widths).toEqual({});
    expect(setColumnWidth(METAS, emptyPrefs(), "actions", 300)).toEqual(emptyPrefs());
    expect(columnWidth(METAS[1], emptyPrefs())).toBe(160);
  });

  it("lo guardado se lee sin confiar: lo raro es «nada»", () => {
    expect(parsePrefs("no es json")).toEqual(emptyPrefs());
    expect(parsePrefs([1, 2])).toEqual(emptyPrefs());
    expect(parsePrefs({ order: ["a", 3, "a"], widths: { a: "x", b: 9999, c: 100 }, pinned: "z" })).toEqual({ order: ["a"], hidden: [], shown: [], pinned: [], widths: { b: 640, c: 100 } });
  });

  it("normalizar saca columnas que ya no existen y contradicciones", () => {
    const messy = { order: ["ghost", "variant"], hidden: ["ghost", "date", "origin"], shown: ["contact", "origin"], pinned: ["ghost", "actions", "contact"], widths: { ghost: 200, contact: 160, product: 300 } };
    expect(normalizePrefs(METAS, messy)).toEqual({ order: ["variant"], hidden: [], shown: ["origin"], pinned: ["contact"], widths: { product: 300 } });
  });

  it("mostrar todas y restablecer", () => {
    const all = showAllColumns(METAS, emptyPrefs());
    expect(visibleColumns(METAS, all).map((c) => c.key)).toContain("origin");
    const custom = setColumnWidth(METAS, toggleColumn(METAS, emptyPrefs(), "variant"), "contact", 300);
    expect(resetColumns(custom)).toEqual({ ...emptyPrefs(), widths: { contact: 300 } });
    expect(resetWidths(custom).widths).toEqual({});
  });

  it("la forma canónica no depende del orden de las claves", () => {
    const a = { ...emptyPrefs(), hidden: ["b", "a"], widths: { y: 100, x: 120 } };
    const b = { ...emptyPrefs(), hidden: ["a", "b"], widths: { x: 120, y: 100 } };
    expect(canonicalPrefs(a)).toBe(canonicalPrefs(b));
  });

  it("el menú agrupa y busca", () => {
    const sections = menuSections(METAS, emptyPrefs(), "");
    expect(sections.map((s) => s.group)).toEqual(["", "Atribución"]);
    expect(menuSections(METAS, emptyPrefs(), "orig").flatMap((s) => s.keys)).toEqual(["origin"]);
    expect(menuSections(METAS, emptyPrefs(), "zzz")).toEqual([]);
  });
});
