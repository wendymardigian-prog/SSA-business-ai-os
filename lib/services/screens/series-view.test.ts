import { describe, expect, it } from "vitest";
import { seriesView } from "./series-view";

const tpl = (recurrence: unknown, extra = {}) => ({ id: "t1", phase_id: "p1", name: "Llamada", recurrence, series_ended_at: null, series_end_reason: null, ...extra });
const round = (i: number, on: string, status = "pending") => ({ parent_item_id: "t1", status, occurrence_index: i, round_on: on, due_on: on });

describe("seriesView", () => {
  it("cuenta vueltas y cumplidas, y calcula la próxima", () => {
    const [v] = seriesView([tpl({ every: "week", until: "phase_end" })], [round(2, "2026-11-09"), round(1, "2026-11-02", "completed")], () => true);
    expect(v).toMatchObject({ rounds: 2, done: 1, lastOn: "2026-11-09", nextOn: "2026-11-16", ended: false, rule: "Cada semana · hasta que termina su fase" });
  });
  it("una serie terminada no tiene próxima y dice por qué", () => {
    const [v] = seriesView([tpl({ every: "day", until: "n_times", n_until: 1 }, { series_ended_at: "2026-11-03T00:00:00Z", series_end_reason: "n_times" })], [round(1, "2026-11-02", "completed")], () => true);
    expect(v.nextOn).toBeNull();
    expect(v.endedLabel).toBe("Cumplió sus vueltas");
  });
  it("con la fase cerrada o sin vueltas, no hay próxima", () => {
    expect(seriesView([tpl({ every: "week", until: "phase_end" })], [round(1, "2026-11-02")], () => false)[0].nextOn).toBeNull();
    expect(seriesView([tpl({ every: "week", until: "phase_end" })], [], () => true)[0]).toMatchObject({ rounds: 0, nextOn: null });
  });
  it("cada N semanas con días: no adivina la próxima", () => {
    expect(seriesView([tpl({ every: "n_weeks", n: 2, weekdays: [1], until: "phase_end" })], [round(1, "2026-11-02")], () => true)[0].nextOn).toBeNull();
  });
  it("días de la semana cada semana: la próxima es el siguiente día elegido", () => {
    expect(seriesView([tpl({ every: "week", weekdays: [1, 3], until: "phase_end" })], [round(1, "2026-11-02"), round(2, "2026-11-04")], () => true)[0].nextOn).toBe("2026-11-09");
  });
});
