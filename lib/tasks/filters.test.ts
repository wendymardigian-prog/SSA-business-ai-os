import { describe, it, expect } from "vitest";
import { applyFilters, type FilterContext } from "./filters";
import { makeTask, taskId } from "./fixtures";
import { DEFAULT_VIEW_STATE } from "./view-state";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const TODAY = "2026-10-13";

const tasks = [
  makeTask({ id: taskId(1), title: "Enviar propuesta", status: "pending", owner_id: ME, due_date: "2026-10-10", priority: "high", project: "Lanzamiento Q4", project_key: "lanzamiento q4" }),
  makeTask({ id: taskId(2), title: "Diseñar landing", status: "in_progress", owner_id: OTHER, follower_ids: [ME], due_date: "2026-10-20", project: "Lanzamiento Q4", project_key: "lanzamiento q4", source: "flow" }),
  makeTask({ id: taskId(3), title: "Llamar a Ana", status: "completed", owner_id: ME, due_date: "2026-10-01", source: "agent" }),
  makeTask({ id: taskId(4), title: "Sin dueño", status: "pending", owner_id: null, blocked_by: [{ task_id: taskId(1), gap_days: 1 }] }),
];
const byId = new Map(tasks.map((t) => [t.id, t]));
const ctx: FilterContext = { meId: ME, today: TODAY, byId };
const ids = (state: Partial<typeof DEFAULT_VIEW_STATE>) => applyFilters(tasks, { ...DEFAULT_VIEW_STATE, ...state }, ctx).map((t) => t.id);

describe("filtros (F14)", () => {
  it("sin filtros: todo", () => expect(ids({})).toHaveLength(4));
  it("estado (varios)", () => expect(ids({ status: ["pending", "in_progress"] })).toEqual([taskId(1), taskId(2), taskId(4)]));
  it("responsable: yo", () => expect(ids({ owner: ["me"] })).toEqual([taskId(1), taskId(3)]));
  it("responsable: sin responsable", () => expect(ids({ owner: ["none"] })).toEqual([taskId(4)]));
  it("responsable: una persona y yo a la vez", () => expect(ids({ owner: ["me", OTHER] })).toEqual([taskId(1), taskId(2), taskId(3)]));
  it("seguidor: yo", () => expect(ids({ follower: ["me"] })).toEqual([taskId(2)]));
  it("proyecto y sin proyecto", () => {
    expect(ids({ project: ["lanzamiento q4"] })).toEqual([taskId(1), taskId(2)]);
    expect(ids({ project: ["none"] })).toEqual([taskId(3), taskId(4)]);
  });
  it("prioridad y origen", () => {
    expect(ids({ priority: ["high"] })).toEqual([taskId(1)]);
    expect(ids({ source: ["flow", "agent"] })).toEqual([taskId(2), taskId(3)]);
  });
  it("vencidas: antes de hoy y sin completar", () => expect(ids({ overdue: true })).toEqual([taskId(1)]));
  it("bloqueadas: tiene algun bloqueante abierto", () => expect(ids({ blocked: true })).toEqual([taskId(4)]));
  it("texto en el titulo, sin importar acentos ni mayusculas", () => {
    expect(ids({ q: "disenar" })).toEqual([taskId(2)]);
    expect(ids({ q: "PROPUESTA" })).toEqual([taskId(1)]);
    expect(ids({ q: "dueno" })).toEqual([taskId(4)]);
  });
  it("«Mis tareas»: mias y sin completar", () => expect(ids({ mine: true })).toEqual([taskId(1)]));
  it("los filtros se combinan con Y", () => expect(ids({ owner: ["me"], status: ["completed"] })).toEqual([taskId(3)]));
});

describe("«vencidas» con la zona de quien mira", () => {
  const zones = { workspaceTz: "America/Costa_Rica", viewerTz: "Asia/Tokyo" };
  // 23:00 del 12 en Costa Rica = 14:00 del 13 en Tokio; TODAY es el 13.
  const late = makeTask({ id: taskId(11), due_date: "2026-10-12", due_time: "23:00", status: "pending" });
  const civil = makeTask({ id: taskId(12), due_date: "2026-10-12", status: "pending" });
  const run = (z?: typeof zones) => applyFilters([late, civil], { ...DEFAULT_VIEW_STATE, overdue: true }, { meId: ME, today: TODAY, byId: new Map(), zones: z }).map((t) => t.id);

  it("la de hoy para quien mira no es vencida; la fecha sin hora, si", () => expect(run(zones)).toEqual([taskId(12)]));
  it("sin zonas, sobre lo guardado", () => expect(run()).toEqual([taskId(11), taskId(12)]));
});
