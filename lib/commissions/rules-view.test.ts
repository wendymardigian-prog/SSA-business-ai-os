import { describe, expect, it } from "vitest";
import { compareRuleSnapshot } from "./detail-model";
import { buildRuleViews, utmSuggestions } from "./rules-view";
import { commissionRuleFromRow } from "./rule-row";
import { jsonCreated, jsonDiff } from "./audit-diff";
import type { CommissionRole, CommissionRule } from "./types";

const roles: CommissionRole[] = [
  { key: "vendedor", name: "Vendedor", payee: "sale_vendedor", active: true, system: true, created_at: "" },
  { key: "pauta", name: "Pauta", payee: "fixed", active: true, system: true, created_at: "" },
];
const rule = (patch: Partial<CommissionRule>): CommissionRule => ({
  id: "r", name: "r", role: "vendedor", position: 1, conditions: {}, calc_type: "percent", rate: 10, fixed_amount: null, base: "gross",
  beneficiary_user_id: null, hold_days: 0, valid_from: null, valid_until: null, is_active: true, archived_at: null, ...patch,
});

describe("buildRuleViews", () => {
  it("agrupa por rol, en orden de prioridad, con la frase, el estado y el aviso «nunca se usa»", () => {
    const views = buildRuleViews(
      roles,
      [
        rule({ id: "b", position: 2, name: "Mentoría", conditions: { financing_types: ["installments"] } }),
        rule({ id: "a", position: 1, name: "Todas", rate: 5 }),
        rule({ id: "x", position: 3, name: "Pausada", is_active: false }),
        rule({ id: "z", position: 4, name: "Archivada", archived_at: "2026-01-01" }),
      ],
      {},
      "2026-10-15",
    );
    expect(views.vendedor.map((v) => v.id)).toEqual(["a", "b", "x"]);
    expect(views.vendedor.map((v) => v.state)).toEqual(["activa", "activa", "pausada"]);
    // «Todas» (sin condiciones) está arriba: se queda con todos los pagos antes de que «Mentoría» se mire.
    expect(views.vendedor.map((v) => v.shadowed)).toEqual([false, true, false]);
    expect(views.vendedor[0].description).toBe("vendedor · 5 % del cobrado");
    expect(views.pauta).toEqual([]);
  });
});

describe("utmSuggestions", () => {
  it("cuenta, decodifica y pone en minúsculas; más frecuentes primero; hasta el límite", () => {
    const touches = [
      { source: "Instagram", medium: "cpc", campaign: "Black%20Friday", content_label: null, term: null },
      { source: "instagram", medium: "cpc", campaign: "black friday", content_label: "c8k2f", term: null },
      { source: "tiktok", medium: "dm", campaign: null, content_label: "  ", term: "" },
    ];
    const s = utmSuggestions(touches);
    expect(s.source).toEqual(["instagram", "tiktok"]);
    expect(s.medium).toEqual(["cpc", "dm"]);
    expect(s.campaign).toEqual(["black friday"]);
    expect(s.content).toEqual(["c8k2f"]);
    expect(s.term).toEqual([]);
    expect(utmSuggestions(Array.from({ length: 30 }, (_, i) => ({ source: `s${String(i).padStart(2, "0")}`, medium: null, campaign: null, content_label: null, term: null }))).source).toHaveLength(20);
  });
});

describe("compareRuleSnapshot", () => {
  const current = rule({ id: "r", name: "Vendedor 8", rate: 8 });
  const snapshot = { name: "Vendedor 8", role: "vendedor", calc_type: "percent", rate: 8, fixed_amount: null, base: "gross", conditions: {}, position: 1 };
  it("sin cambios", () => {
    expect(compareRuleSnapshot(snapshot, current)).toEqual({ changed: false, fields: [], archived: false, unknown: false });
  });
  it("dice qué cambió; mover la posición no cuenta", () => {
    expect(compareRuleSnapshot({ ...snapshot, rate: 5, position: 3 }, current)).toMatchObject({ changed: true, fields: ["El porcentaje"] });
    expect(compareRuleSnapshot({ ...snapshot, conditions: { product_ids: ["x"] } }, current).fields).toEqual(["Las condiciones"]);
  });
  it("una regla archivada se avisa; sin regla actual (otro alcance) no se compara", () => {
    expect(compareRuleSnapshot(snapshot, { ...current, archived_at: "2026-10-01" })).toMatchObject({ archived: true, changed: false });
    expect(compareRuleSnapshot(snapshot, null)).toMatchObject({ unknown: true, changed: false });
    expect(compareRuleSnapshot(null, current).unknown).toBe(true);
  });
});

describe("commissionRuleFromRow", () => {
  it("normaliza lo que viene raro de la base", () => {
    const r = commissionRuleFromRow({ id: "x", name: "n", role: "vendedor", position: "2", conditions: null, calc_type: "percent", rate: "12.500", fixed_amount: null, base: "net_of_fees", hold_days: "3", is_active: true });
    expect(r).toMatchObject({ position: 2, conditions: {}, rate: 12.5, base: "net_of_fees", hold_days: 3, beneficiary_user_id: null, archived_at: null });
  });
});

describe("jsonDiff", () => {
  it("compara por JSON canónico: el orden de las claves no cuenta, null y vacío son lo mismo", () => {
    expect(jsonDiff({ conditions: { a: 1, b: [1, 2] }, name: "" }, { conditions: { b: [1, 2], a: 1 }, name: null }, ["conditions", "name"])).toBeNull();
  });
  it("guarda valores JSON de verdad (objetos incluidos)", () => {
    const changes = jsonDiff({ conditions: {}, rate: 5 }, { conditions: { channels: ["organic"] }, rate: 5 }, ["conditions", "rate"]);
    expect(changes).toEqual({ conditions: { old: {}, new: { channels: ["organic"] } } });
  });
  it("jsonCreated solo trae lo que no está vacío", () => {
    expect(jsonCreated({ name: "x", rate: null, hold_days: 0 }, ["name", "rate", "hold_days"])).toEqual({ name: { old: null, new: "x" }, hold_days: { old: null, new: 0 } });
  });
});
