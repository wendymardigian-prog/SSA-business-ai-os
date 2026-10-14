import { describe, it, expect } from "vitest";
import { canTransition, countByStatus, duplicateName, formListRow, nextSlug, parseListFilter, slugFromName, SLUG_PATTERN } from "./list";

describe("canTransition", () => {
  it("permite las transiciones del plano", () => {
    expect(canTransition("draft", "published")).toBe(true);
    expect(canTransition("published", "paused")).toBe(true);
    expect(canTransition("paused", "published")).toBe(true);
    for (const from of ["draft", "published", "paused"] as const) expect(canTransition(from, "archived")).toBe(true);
    expect(canTransition("archived", "draft")).toBe(true);
  });

  it("rechaza las demás", () => {
    expect(canTransition("archived", "published")).toBe(false);
    expect(canTransition("archived", "paused")).toBe(false);
    expect(canTransition("draft", "paused")).toBe(false);
    expect(canTransition("published", "draft")).toBe(false);
    expect(canTransition("published", "published")).toBe(false);
  });
});

describe("slugs", () => {
  it('nextSlug("aplicacion", ["aplicacion","aplicacion-2"]) da "aplicacion-3"', () => {
    expect(nextSlug("aplicacion", ["aplicacion", "aplicacion-2"])).toBe("aplicacion-3");
  });

  it("no distingue mayúsculas", () => {
    expect(nextSlug("aplicacion", ["APLICACION"])).toBe("aplicacion-2");
  });

  it("devuelve el base si está libre", () => {
    expect(nextSlug("nuevo", [])).toBe("nuevo");
  });

  it("slugFromName siempre cumple el formato", () => {
    for (const name of ["Aplicación al programa", "¿Cómo vas?", "A", "", "ñ", "x".repeat(200)]) {
      expect(slugFromName(name), name).toMatch(SLUG_PATTERN);
    }
    expect(slugFromName("Aplicación al programa")).toBe("aplicacion-al-programa");
  });

  it("nextSlug respeta el largo máximo", () => {
    const base = "a".repeat(60);
    expect(nextSlug(base, [base]).length).toBeLessThanOrEqual(60);
  });
});

describe("filas y contadores", () => {
  it("formListRow sin estadísticas", () => {
    const row = formListRow({ id: "1", name: "F", type: "custom", status: "draft", slug: "f-1", updated_at: "2026-10-10" });
    expect(row.submissions).toBe(0);
    expect(row.lastSubmissionAt).toBeNull();
  });

  it("countByStatus", () => {
    expect(countByStatus([{ status: "draft" }, { status: "draft" }, { status: "published" }])).toEqual({
      all: 3,
      published: 1,
      draft: 2,
      paused: 0,
      archived: 0,
    });
  });

  it("parseListFilter y duplicateName", () => {
    expect(parseListFilter("paused")).toBe("paused");
    // Plano formularios-ui, D-B2: el default de la lista pasa de "published" a "all" (todos, tambien los archivados).
    // Antes esta asercion pedia "published".
    expect(parseListFilter("x")).toBe("all");
    expect(parseListFilter(undefined)).toBe("all");
    expect(parseListFilter("all")).toBe("all");
    expect(duplicateName("Aplicación")).toBe("Copia de Aplicación");
  });
});

describe("filtro por tipo (EOD)", () => {
  it("'Fin de día' filtra los EOD; 'all' muestra todo; un valor raro es 'all'", async () => {
    const { matchesType, parseTypeFilter } = await import("./list");
    expect(parseTypeFilter("eod")).toBe("eod");
    expect(parseTypeFilter("otro")).toBe("all");
    expect(matchesType({ type: "eod" }, "eod")).toBe(true);
    expect(matchesType({ type: "custom" }, "eod")).toBe(false);
    expect(matchesType({ type: "custom" }, "all")).toBe(true);
  });
});

// ── Buscar, filtrar y resumir (plano formularios-ui, F5) ──────────────────────

import { countsFor, filterForms, hasActiveFilters, listQueryString, listSummary, normalizeSearch, parseListQuery, publicTitleOf, questionCountOf, type FormListRow } from "./list";

const ROW = (over: Partial<FormListRow>): FormListRow => ({
  id: "1",
  name: "Formulario",
  type: "custom",
  status: "published",
  slug: "formulario",
  submissions: 0,
  lastSubmissionAt: null,
  updatedAt: "2026-10-13T12:00:00Z",
  publicTitle: null,
  questionCount: 0,
  conversion: null,
  nps: null,
  average: null,
  people: null,
  ...over,
});

const LIST: FormListRow[] = [
  ROW({ id: "a", name: "Aplicación al Programa X", publicTitle: "Aplicá al Programa X", status: "published", submissions: 128 }),
  ROW({ id: "b", name: "NPS clientes · Q4", type: "survey", publicTitle: "¿Cómo te está yendo?", status: "published", submissions: 46 }),
  ROW({ id: "c", name: "Lead magnet · guía", status: "archived", submissions: 1874 }),
  ROW({ id: "d", name: "Bienvenida", status: "draft", publicTitle: "Bienvenida" }),
  ROW({ id: "e", name: "EOD setters", type: "eod", status: "published", submissions: 84 }),
  ROW({ id: "f", name: "Acuerdo de servicio", type: "contract", status: "paused", submissions: 12 }),
];

describe("parseListQuery (F5): lo que dice la URL", () => {
  it("sin nada: sin filtros", () => {
    expect(parseListQuery({})).toEqual({ q: "", status: "all", type: "all" });
  });

  it("lee q, estado y tipo", () => {
    expect(parseListQuery({ q: " programa ", estado: "paused", tipo: "contract" })).toEqual({ q: "programa", status: "paused", type: "contract" });
  });

  it("un valor invalido se ignora", () => {
    expect(parseListQuery({ estado: "borrado", tipo: "x", q: ["uno", "dos"] })).toEqual({ q: "uno", status: "all", type: "all" });
  });

  it("la busqueda se recorta a 120 caracteres", () => {
    expect(parseListQuery({ q: "a".repeat(300) }).q).toHaveLength(120);
  });

  it("listQueryString solo escribe lo que se aparta del valor por defecto", () => {
    expect(listQueryString({ q: "", status: "all", type: "all" })).toBe("");
    expect(listQueryString({ q: "prog x", status: "paused", type: "custom" })).toBe("q=prog+x&estado=paused&tipo=custom");
    expect(hasActiveFilters({ q: "  ", status: "all", type: "all" })).toBe(false);
    expect(hasActiveFilters({ q: "", status: "draft", type: "all" })).toBe(true);
  });
});

describe("filterForms (F5)", () => {
  const all = { q: "", status: "all" as const, type: "all" as const };

  it("sin filtros devuelve todos (tambien los archivados), con los archivados al final", () => {
    const out = filterForms(LIST, all);
    expect(out.map((r) => r.id)).toEqual(["a", "b", "d", "e", "f", "c"]);
  });

  it("busca por nombre interno y por titulo publico, sin distinguir mayusculas ni tildes", () => {
    expect(filterForms(LIST, { ...all, q: "APLICACION" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterForms(LIST, { ...all, q: "aplica al programa" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterForms(LIST, { ...all, q: "como te esta yendo" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterForms(LIST, { ...all, q: "  guia  " }).map((r) => r.id)).toEqual(["c"]);
    expect(filterForms(LIST, { ...all, q: "no existe" })).toEqual([]);
  });

  it("combina estado, tipo y busqueda", () => {
    expect(filterForms(LIST, { q: "", status: "published", type: "all" }).map((r) => r.id)).toEqual(["a", "b", "e"]);
    expect(filterForms(LIST, { q: "", status: "published", type: "survey" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterForms(LIST, { q: "x", status: "published", type: "custom" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterForms(LIST, { q: "", status: "archived", type: "all" }).map((r) => r.id)).toEqual(["c"]);
  });

  it("no cambia el orden de entrada dentro de cada grupo ni modifica la lista original", () => {
    const copy = [...LIST];
    filterForms(LIST, all);
    expect(LIST).toEqual(copy);
  });

  it("normalizeSearch junta espacios y saca tildes", () => {
    expect(normalizeSearch("  Aplicación   Ñandú ")).toBe("aplicacion nandu");
  });
});

describe("countsFor y listSummary (F5)", () => {
  it("cuenta por estado y por tipo sobre toda la lista", () => {
    const c = countsFor(LIST);
    expect(c.status).toEqual({ all: 6, published: 3, draft: 1, paused: 1, archived: 1 });
    expect(c.type).toEqual({ all: 6, custom: 3, survey: 1, contract: 1, eod: 1 });
  });

  it("sin filtros: formularios, publicados y respuestas en total (sin contar los archivados)", () => {
    const s = listSummary(LIST, 6, { q: "", status: "all", type: "all" });
    expect(s.text).toBe("6 formularios · 3 publicados · 270 respuestas en total");
    expect(s.chips).toEqual([]);
    expect(s.filtered).toBe(false);
  });

  it("singular cuando hay uno", () => {
    expect(listSummary([ROW({ submissions: 1 })], 1, { q: "", status: "all", type: "all" }).text).toBe("1 formulario · 1 publicado · 1 respuesta en total");
  });

  it("con filtros: '3 de 8 formularios' y un chip por cada filtro activo", () => {
    const s = listSummary(LIST, 2, { q: "pro", status: "published", type: "custom" });
    expect(s.text).toBe("2 de 6 formularios");
    expect(s.chips).toEqual([
      { id: "estado", label: "Estado: Publicados" },
      { id: "tipo", label: "Tipo: Personalizado" },
      { id: "q", label: "“pro”" },
    ]);
    expect(s.filtered).toBe(true);
  });
});

describe("la fila de la lista (F6)", () => {
  const source = { id: "x", name: "Nombre", type: "custom" as const, status: "published" as const, slug: "nombre", updated_at: "2026-10-13T10:00:00Z" };

  it("el titulo publico y las preguntas salen del diseno y del borrador (los ocultos no cuentan)", () => {
    expect(publicTitleOf({ title: "  Aplicá  " })).toBe("Aplicá");
    expect(publicTitleOf({ title: "   " })).toBeNull();
    expect(publicTitleOf(null)).toBeNull();
    expect(questionCountOf({ fields: [{ type: "short_text" }, { type: "hidden" }, { type: "email" }] })).toBe(2);
    expect(questionCountOf({})).toBe(0);
    expect(questionCountOf(null)).toBe(0);
  });

  it("la conversion es envios sobre vistas, y sin vistas es null (nunca 0)", () => {
    expect(formListRow(source, { submissions: 25, views: 200 }).conversion).toBe(0.125);
    expect(formListRow(source, { submissions: 25, views: 0 }).conversion).toBeNull();
    expect(formListRow(source, { submissions: 25 }).conversion).toBeNull();
    // un reporte de fin de dia o una encuesta no tienen conversion
    expect(formListRow({ ...source, type: "eod" }, { submissions: 25, views: 200 }).conversion).toBeNull();
    expect(formListRow({ ...source, type: "survey" }, { submissions: 25, views: 200 }).conversion).toBeNull();
  });

  it("una encuesta con NPS calcula el NPS; con estrellas, el promedio", () => {
    const survey = { ...source, type: "survey" as const, survey_config: { scoreFieldKey: "nps" }, draft_definition: { fields: [{ key: "nps", type: "nps" }] } };
    expect(formListRow(survey, { submissions: 4, scores: [10, 9, 7, 3] })).toMatchObject({ nps: 25, average: null });
    const stars = { ...survey, survey_config: { scoreFieldKey: "est" }, draft_definition: { fields: [{ key: "est", type: "rating" }] } };
    expect(formListRow(stars, { submissions: 2, scores: [4, 5] })).toMatchObject({ nps: null, average: 4.5 });
    expect(formListRow(survey, { submissions: 0, scores: [] })).toMatchObject({ nps: null, average: null });
  });

  it("un reporte de fin de dia lleva las personas", () => {
    expect(formListRow({ ...source, type: "eod" }, { submissions: 84, people: 3 }).people).toBe(3);
    expect(formListRow(source, { submissions: 84, people: 3 }).people).toBeNull();
  });

  it("sin datos extra la fila queda como la de antes (campos nuevos vacios)", () => {
    expect(formListRow(source)).toMatchObject({ publicTitle: null, questionCount: 0, conversion: null, nps: null, average: null, people: null, submissions: 0 });
  });
});
