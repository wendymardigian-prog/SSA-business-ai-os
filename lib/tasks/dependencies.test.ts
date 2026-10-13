import { describe, it, expect } from "vitest";
import { buildBlockers, computeGap, regapForNewDue, wouldCreateCycle } from "./dependencies";

const map = (entries: Record<string, string[]>) => new Map(Object.entries(entries));

describe("wouldCreateCycle (F5)", () => {
  it("auto-bloqueo", () => {
    expect(wouldCreateCycle(map({}), "A", ["A"])).toBe(true);
  });
  it("ciclo directo: B ya depende de A, y A pasa a depender de B", () => {
    expect(wouldCreateCycle(map({ B: ["A"] }), "A", ["B"])).toBe(true);
  });
  it("ciclo indirecto: A -> B -> C, y A pasa a depender de C", () => {
    // C depende de B, B depende de A.
    expect(wouldCreateCycle(map({ B: ["A"], C: ["B"] }), "A", ["C"])).toBe(true);
  });
  it("diamante valido: D depende de B y C, que dependen de A", () => {
    expect(wouldCreateCycle(map({ B: ["A"], C: ["A"] }), "D", ["B", "C"])).toBe(false);
  });
  it("una cadena larga sin cierre es valida", () => {
    expect(wouldCreateCycle(map({ B: ["A"], C: ["B"] }), "D", ["C"])).toBe(false);
  });
  it("reemplaza los bloqueantes actuales por los nuevos", () => {
    // A dependia de B. Si ahora A depende de C, el camino A -> B desaparece...
    expect(wouldCreateCycle(map({ A: ["B"] }), "A", ["C"])).toBe(false);
    // ...pero si B pasa a depender de A (que sigue dependiendo de B), se cierra el ciclo.
    expect(wouldCreateCycle(map({ A: ["B"] }), "B", ["A"])).toBe(true);
  });
  it("datos con un ciclo previo no cuelgan", () => {
    expect(() => wouldCreateCycle(map({ X: ["Y"], Y: ["X"] }), "A", ["X"])).not.toThrow();
  });
});

describe("computeGap", () => {
  it("dias entre vencimientos, cero si es el mismo dia", () => {
    expect(computeGap("2026-10-10", "2026-10-14")).toEqual({ ok: true, gap: 4 });
    expect(computeGap("2026-10-10", "2026-10-10")).toEqual({ ok: true, gap: 0 });
  });
  it("sin alguna fecha, cero", () => {
    expect(computeGap(null, "2026-10-14")).toEqual({ ok: true, gap: 0 });
    expect(computeGap("2026-10-10", null)).toEqual({ ok: true, gap: 0 });
  });
  it("la bloqueada antes que el bloqueante se rechaza", () => {
    expect(computeGap("2026-10-10", "2026-10-09")).toEqual({ ok: false, error: "date_before_blocker" });
  });
});

describe("buildBlockers", () => {
  const due = new Map<string, string | null>([["A", "2026-10-10"], ["B", null], ["T", "2026-10-15"]]);
  it("arma el gap de cada uno", () => {
    const r = buildBlockers({ taskId: "T", dependentDue: "2026-10-15", blockerIds: ["A", "B"], dueById: due, blockedBy: new Map() });
    expect(r).toEqual({ ok: true, blockers: [{ task_id: "A", gap_days: 5 }, { task_id: "B", gap_days: 0 }] });
  });
  it("rechaza duplicados, mas de 10, auto-bloqueo, inexistentes y ciclos", () => {
    const base = { taskId: "T", dependentDue: "2026-10-15", dueById: due, blockedBy: new Map<string, string[]>() };
    expect(buildBlockers({ ...base, blockerIds: ["A", "A"] })).toMatchObject({ ok: false, error: "duplicate" });
    expect(buildBlockers({ ...base, blockerIds: Array.from({ length: 11 }, (_, i) => `x${i}`) })).toMatchObject({ ok: false, error: "too_many" });
    expect(buildBlockers({ ...base, blockerIds: ["T"] })).toMatchObject({ ok: false, error: "self" });
    expect(buildBlockers({ ...base, blockerIds: ["Z"] })).toMatchObject({ ok: false, error: "missing_task", taskId: "Z" });
    expect(buildBlockers({ ...base, blockedBy: new Map([["A", ["T"]]]), blockerIds: ["A"] })).toMatchObject({ ok: false, error: "cycle" });
  });
  it("rechaza si la bloqueada vence antes que el bloqueante", () => {
    const r = buildBlockers({ taskId: "T", dependentDue: "2026-10-05", blockerIds: ["A"], dueById: due, blockedBy: new Map() });
    expect(r).toMatchObject({ ok: false, error: "date_before_blocker", taskId: "A" });
  });
});

describe("regapForNewDue", () => {
  const due = new Map<string, string | null>([["A", "2026-10-10"]]);
  it("recalcula el gap con la fecha nueva", () => {
    expect(regapForNewDue([{ task_id: "A", gap_days: 1 }], "2026-10-20", due)).toEqual({ ok: true, blockers: [{ task_id: "A", gap_days: 10 }] });
  });
  it("rechaza si quedaria negativo", () => {
    expect(regapForNewDue([{ task_id: "A", gap_days: 1 }], "2026-10-09", due)).toMatchObject({ ok: false, error: "date_before_blocker" });
  });
  it("sin fecha nueva conserva el gap", () => {
    expect(regapForNewDue([{ task_id: "A", gap_days: 3 }], null, due)).toEqual({ ok: true, blockers: [{ task_id: "A", gap_days: 3 }] });
  });
});
