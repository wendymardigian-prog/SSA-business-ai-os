import { describe, expect, it } from "vitest";
import {
  applyCallFilters, callFiltersToParams, callTypeLabel, countActiveCallFilters, EMPTY_FILTERS, estimateBatch, groupRows,
  isNonSaleRow, isSaleCallType, mergeColumns, parseCallFilters, parseSavedViews, sortRows, typeDeciderText, weekStartKey, type CallFilters,
} from "./list";

const CLOSER = "11111111-1111-4111-8111-111111111111";
const ctx = { closerIds: [CLOSER] };

describe("tipos de venta y etiquetas", () => {
  it("cierre/seguimiento/triaje son de venta; equipo y los propios no", () => {
    expect(isSaleCallType("cierre")).toBe(true);
    expect(isSaleCallType("equipo")).toBe(false);
    expect(isSaleCallType("mi_tipo")).toBe(false);
    expect(isSaleCallType("venta")).toBe(true);
  });
  it("needs_review nunca es gris; not_applicable siempre", () => {
    expect(isNonSaleRow({ call_type: "equipo", analysis_status: "needs_review" })).toBe(false);
    expect(isNonSaleRow({ call_type: "cierre", analysis_status: "not_applicable" })).toBe(true);
    expect(isNonSaleRow({ call_type: null, analysis_status: "pending" })).toBe(false);
  });
  it("callTypeLabel usa el nombre del tipo propio", () => {
    expect(callTypeLabel("cierre")).toBe("Cierre");
    expect(callTypeLabel(null)).toBe("Sin clasificar");
    expect(callTypeLabel("demo", [{ clave: "demo", nombre: "Demo de producto" }])).toBe("Demo de producto");
    expect(callTypeLabel("venta")).toBe("Cierre");
  });
  it("typeDeciderText: regla, IA o persona", () => {
    expect(typeDeciderText({ call_type_source: "rule", call_type_rule: "11 participantes", call_type_confidence: null })).toBe("regla: 11 participantes");
    expect(typeDeciderText({ call_type_source: "ai", call_type_rule: null, call_type_confidence: 0.91 })).toBe("IA 91%");
    expect(typeDeciderText({ call_type_source: "human", call_type_rule: null, call_type_confidence: null })).toBe("persona");
    expect(typeDeciderText({ call_type_source: null, call_type_rule: null, call_type_confidence: null })).toBeNull();
  });
});

describe("orden, agrupacion y semanas", () => {
  it("orden multi-criterio con vacios al final", () => {
    const rows = [{ a: 1, b: "x" }, { a: null, b: "y" }, { a: 1, b: "a" }, { a: 3, b: "z" }];
    const out = sortRows(rows, [{ key: "a", direction: "desc" }, { key: "b", direction: "asc" }], (r, k) => r[k as "a" | "b"]);
    expect(out.map((r) => r.b)).toEqual(["z", "a", "x", "y"]);
  });
  it("agrupa en orden de aparicion", () => {
    const g = groupRows(["a", "b", "a"], (r) => ({ key: r, label: r.toUpperCase() }));
    expect(g.map((x) => [x.label, x.rows.length])).toEqual([["A", 2], ["B", 1]]);
  });
  it("weekStartKey cae en lunes", () => {
    expect(weekStartKey("2026-09-24T15:00:00Z")).toBe("2026-09-21");
    expect(weekStartKey(null)).toBeNull();
  });
});

describe("estimateBatch", () => {
  it("10 × 0,06 con 20 gastados de 25", () => {
    const e = estimateBatch(10, 0.06, 20, 25);
    expect(e).toMatchObject({ costUsd: 0.6, projectedUsd: 20.6, overBudget: false, affordable: 83 });
  });
  it("sin tope: affordable null; sobre el tope: overBudget", () => {
    expect(estimateBatch(3, 0.06, 0, null).affordable).toBeNull();
    expect(estimateBatch(100, 0.06, 24, 25)).toMatchObject({ overBudget: true, affordable: 16 });
  });
});

describe("mergeColumns", () => {
  it("respeta el orden guardado, suma nuevas y quita desconocidas", () => {
    const defs = [{ key: "a", label: "A", visible: true }, { key: "b", label: "B", visible: true }, { key: "c", label: "C", visible: false }];
    const out = mergeColumns([{ key: "b", label: "B", visible: false }, { key: "zz", label: "Z", visible: true }, { key: "a", label: "A", visible: true }], defs);
    expect(out.map((c) => `${c.key}:${c.visible}`)).toEqual(["b:false", "a:true", "c:false"]);
  });
});

describe("parseCallFilters", () => {
  it("ignora valores desconocidos sin lanzar", () => {
    const f = parseCallFilters({ closer: "inventado", estado: "nope", vinculo: "x", cmin: "abc", desde: "2026-02-31", tipo: "../../x" }, ctx);
    expect(f).toEqual({ ...EMPTY_FILTERS });
  });
  it("lee los validos", () => {
    const f = parseCallFilters({ closer: CLOSER, estado: "analyzed", vinculo: "sin_vincular", cmin: "60", lmax: "90", tipo: "cierre", resultado: "venta_deposito", desde: "2026-10-01", hasta: "2026-10-31", q: " Ana, (x) ", pagina: "3" }, ctx);
    expect(f).toMatchObject({ closer: CLOSER, estado: "analyzed", vinculo: "sin_vincular", closerMin: 60, leadMax: 90, tipo: "cierre", resultado: "venta_deposito", desde: "2026-10-01", hasta: "2026-10-31", q: "Ana x", pagina: 3 });
  });
  it("acota los puntajes a 0..100 y valida el tipo contra la lista", () => {
    expect(parseCallFilters({ cmin: "-5", cmax: "500" }, ctx)).toMatchObject({ closerMin: 0, closerMax: 100 });
    expect(parseCallFilters({ tipo: "otro" }, { ...ctx, typeKeys: ["cierre"] }).tipo).toBe("");
  });
  it("un parametro repetido toma el primero", () => {
    expect(parseCallFilters({ estado: ["error", "analyzed"] }, ctx).estado).toBe("error");
  });
  it("cuenta los filtros activos y arma la URL de vuelta", () => {
    const f: CallFilters = { ...EMPTY_FILTERS, tipo: "cierre", closerMin: 60, pagina: 2 };
    expect(countActiveCallFilters(f)).toBe(2);
    expect(callFiltersToParams(f).toString()).toBe("tipo=cierre&cmin=60&pagina=2");
  });
});

/** Un constructor de consultas que solo anota lo que se le pide. */
function recorder() {
  const calls: Array<[string, ...unknown[]]> = [];
  const q: Record<string, unknown> = {};
  for (const m of ["eq", "is", "not", "gte", "lte", "or"]) q[m] = (...a: unknown[]) => { calls.push([m, ...a]); return q; };
  return { q: q as never, calls };
}

describe("applyCallFilters: se aplican en la consulta", () => {
  it("siempre excluye las archivadas y no inventa filtros de visibilidad", () => {
    const { q, calls } = recorder();
    applyCallFilters(q, EMPTY_FILTERS, { timeZone: "America/Costa_Rica" });
    expect(calls).toEqual([["is", "archived_at", null]]);
  });
  it("'sin vincular' lista solo contact_id null; 'vinculada' lo contrario", () => {
    const a = recorder();
    applyCallFilters(a.q, { ...EMPTY_FILTERS, vinculo: "sin_vincular" }, { timeZone: "UTC" });
    expect(a.calls).toContainEqual(["is", "contact_id", null]);
    const b = recorder();
    applyCallFilters(b.q, { ...EMPTY_FILTERS, vinculo: "vinculada" }, { timeZone: "UTC" });
    expect(b.calls).toContainEqual(["not", "contact_id", "is", null]);
  });
  it("closer, tipo, resultado, estado y rangos de puntaje", () => {
    const { q, calls } = recorder();
    applyCallFilters(q, { ...EMPTY_FILTERS, closer: CLOSER, tipo: "cierre", resultado: "venta", estado: "analyzed", closerMin: 60, leadMax: 80 }, { timeZone: "UTC" });
    expect(calls).toEqual(expect.arrayContaining([
      ["eq", "recorded_by_user_id", CLOSER], ["eq", "call_type", "cierre"], ["eq", "outcome", "venta"],
      ["eq", "analysis_status", "analyzed"], ["gte", "closer_score", 60], ["lte", "lead_score", 80],
    ]));
  });
  it("el rango de fechas se interpreta en la zona de quien mira (Costa Rica = UTC-6)", () => {
    const { q, calls } = recorder();
    applyCallFilters(q, { ...EMPTY_FILTERS, desde: "2026-10-01", hasta: "2026-10-01" }, { timeZone: "America/Costa_Rica" });
    expect(calls).toContainEqual(["gte", "recorded_at", "2026-10-01T06:00:00.000Z"]);
    expect(calls).toContainEqual(["lte", "recorded_at", "2026-10-02T05:59:59.999Z"]);
  });
  it("el filtro por contacto solo acepta un uuid y filtra la consulta; un valor raro se ignora", () => {
    const CONTACT = "11111111-1111-4111-8111-111111111111";
    expect(parseCallFilters({ contacto: CONTACT }, ctx).contacto).toBe(CONTACT);
    expect(parseCallFilters({ contacto: "../../x" }, ctx).contacto).toBe("");
    expect(parseCallFilters({ contacto: `${CONTACT}'--` }, ctx).contacto).toBe("");
    expect(callFiltersToParams({ ...EMPTY_FILTERS, contacto: CONTACT }).get("contacto")).toBe(CONTACT);
    expect(countActiveCallFilters({ ...EMPTY_FILTERS, contacto: CONTACT })).toBe(1);
    const a = recorder();
    applyCallFilters(a.q, { ...EMPTY_FILTERS, contacto: CONTACT }, { timeZone: "UTC" });
    expect(a.calls).toContainEqual(["eq", "contact_id", CONTACT]);
  });

  it("la busqueda mira el titulo y los contactos que coinciden", () => {
    const { q, calls } = recorder();
    applyCallFilters(q, { ...EMPTY_FILTERS, q: "ana" }, { timeZone: "UTC", searchContactIds: [CLOSER, "no-es-uuid"] });
    expect(calls).toContainEqual(["or", `title.ilike.%ana%,contact_id.in.(${CLOSER})`]);
  });
});

describe("vistas guardadas", () => {
  it("lee las validas e ignora la basura", () => {
    expect(parseSavedViews('[{"id":"1","name":"Sin vincular","params":"vinculo=sin_vincular"},{"x":1}]')).toHaveLength(1);
    expect(parseSavedViews("no es json")).toEqual([]);
    expect(parseSavedViews(null)).toEqual([]);
  });
});
