import { describe, expect, it } from "vitest";
import {
  EMPTY_COLUMN_PREFS,
  columnMenuGroups,
  flatAttribution,
  originSummary,
  parseColumnPrefs,
  responseColumnDefs,
  serializeColumnPrefs,
  showAllColumns,
  toggleColumn,
  visibleColumns,
} from "./response-columns";

const answers = [{ key: "email", label: "Email", type: "email", removed: false }];
const defs = responseColumnDefs(answers);
const byKey = (key: string) => {
  const def = defs.find((d) => d.key === key);
  if (!def) throw new Error(`Sin columna ${key}`);
  return def;
};
const source = (attribution: Record<string, string>) => ({
  answers: { email: { label: "Email", type: "email", value: "ana@ejemplo.test" } },
  attribution,
  metaNames: { campaign: "Clase", adset: "N6", ad: null },
});

describe("responseColumnDefs", () => {
  it("las preguntas van primero y la atribución al final", () => {
    expect(defs[0].key).toBe("answer:email");
    expect(defs.slice(1).every((d) => d.group !== "answers")).toBe(true);
  });

  it("las claves no se repiten", () => {
    expect(new Set(defs.map((d) => d.key)).size).toBe(defs.length);
  });

  it("muestra de entrada los UTM, el anuncio, de dónde vino y la URL", () => {
    const keys = visibleColumns(defs, EMPTY_COLUMN_PREFS).map((d) => d.key);
    expect(keys).toEqual(
      expect.arrayContaining(["attr:utm_source", "attr:utm_medium", "attr:utm_campaign", "attr:utm_content", "attr:utm_term", "meta:campaign", "meta:adset", "meta:ad", "attr:ad_id", "attr:referrer_url", "entry_url"]),
    );
    expect(keys).not.toContain("attr:fbclid");
    expect(keys).not.toContain("attr:fbp");
  });

  it("cada columna lee su dato y lo que falta queda vacío", () => {
    const row = source({ utm_source: "meta" });
    expect(byKey("answer:email").value(row)).toBe("ana@ejemplo.test");
    expect(byKey("attr:utm_source").value(row)).toBe("meta");
    expect(byKey("attr:utm_term").value(row)).toBe("");
    expect(byKey("meta:adset").value(row)).toBe("N6");
    expect(byKey("meta:ad").value(row)).toBe("");
  });

  it("la URL de entrada cae en la página de llegada, sin parámetros sensibles", () => {
    expect(byKey("entry_url").value(source({ entry_url: "https://s.test/a?ref=x", landing_page: "https://s.test/b" }))).toBe("https://s.test/a?ref=x");
    expect(byKey("entry_url").value(source({ landing_page: "https://s.test/b?utm_source=meta&token=secreto" }))).toBe("https://s.test/b?utm_source=meta");
    expect(byKey("entry_url").value(source({}))).toBe("");
  });
});

describe("preferencias de columnas", () => {
  it("algo roto o vacío vuelve a las normales", () => {
    for (const raw of [null, undefined, "", "no es json", "[]", '{"v":2}', "null"]) {
      expect(parseColumnPrefs(raw)).toEqual(EMPTY_COLUMN_PREFS);
    }
    expect(parseColumnPrefs('{"v":1,"hidden":[1,"a"],"shown":"x"}')).toEqual({ hidden: ["a"], shown: [] });
  });

  it("guardar y volver a leer da lo mismo", () => {
    const prefs = { hidden: ["attr:utm_term"], shown: ["attr:fbclid"] };
    expect(parseColumnPrefs(serializeColumnPrefs(prefs))).toEqual(prefs);
  });

  it("ocultar y volver a mostrar deja todo como estaba", () => {
    const hidden = toggleColumn(EMPTY_COLUMN_PREFS, byKey("attr:utm_term"));
    expect(visibleColumns(defs, hidden).map((d) => d.key)).not.toContain("attr:utm_term");
    expect(toggleColumn(hidden, byKey("attr:utm_term"))).toEqual(EMPTY_COLUMN_PREFS);
  });

  it("prende una columna que normalmente está oculta", () => {
    const prefs = toggleColumn(EMPTY_COLUMN_PREFS, byKey("attr:fbclid"));
    expect(prefs.shown).toEqual(["attr:fbclid"]);
    expect(visibleColumns(defs, prefs).map((d) => d.key)).toContain("attr:fbclid");
  });

  it("una pregunta nueva del formulario aparece sola", () => {
    const prefs = toggleColumn(EMPTY_COLUMN_PREFS, byKey("answer:email"));
    const withNew = responseColumnDefs([...answers, { key: "telefono", label: "Teléfono", type: "phone", removed: false }]);
    const keys = visibleColumns(withNew, prefs).map((d) => d.key);
    expect(keys).toContain("answer:telefono");
    expect(keys).not.toContain("answer:email");
  });

  it("«País» va justo después de la pregunta de teléfono y sale de su prefijo", () => {
    const withPhone = responseColumnDefs([...answers, { key: "whatsapp", label: "WhatsApp", type: "phone", removed: false }]);
    const keys = withPhone.map((d) => d.key);
    expect(keys.indexOf("country:whatsapp")).toBe(keys.indexOf("answer:whatsapp") + 1);
    const country = withPhone.find((d) => d.key === "country:whatsapp")!;
    const phoneRow = (value: string) => ({ ...source({}), answers: { whatsapp: { label: "WhatsApp", type: "phone", value } } });
    expect(country.value(phoneRow("+51930000000"))).toBe("🇵🇪 Perú");
    expect(country.value(phoneRow("123"))).toBe("");
    expect(defs.some((d) => d.key.startsWith("country:"))).toBe(false);
  });

  it("«Mostrar todo» deja todas visibles", () => {
    expect(visibleColumns(defs, showAllColumns(defs))).toHaveLength(defs.length);
  });
});

describe("columnMenuGroups", () => {
  it("agrupa todas las columnas y filtra por lo escrito", () => {
    expect(columnMenuGroups(defs, "").flatMap((g) => g.columns)).toHaveLength(defs.length);
    const found = columnMenuGroups(defs, "url de");
    expect(found.flatMap((g) => g.columns).map((d) => d.key)).toEqual(["entry_url"]);
    expect(columnMenuGroups(defs, "zzz")).toEqual([]);
  });
});

describe("flatAttribution y originSummary", () => {
  it("deja solo texto, sin first_visit", () => {
    expect(flatAttribution({ utm_source: "meta", vacio: "", first_visit: { utm_source: "ig" } })).toEqual({ utm_source: "meta" });
    expect(flatAttribution(null)).toEqual({});
    expect(flatAttribution([])).toEqual({});
  });

  it("resume el origen para el celular", () => {
    expect(originSummary({ utm_source: "meta", utm_medium: "paid", utm_campaign: "clase" })).toBe("meta / paid · clase");
    expect(originSummary({ utm_campaign: "clase" })).toBe("clase");
    expect(originSummary({})).toBe("");
  });
});
