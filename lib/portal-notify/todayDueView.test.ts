// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { todayDueView, type DueItem } from "./todayDueView";

const item = (id: string, due_at: string, done = false, grace_hours?: number): DueItem => ({ id, icon: "doc", title: id, detail: "", due_at, grace_hours, done, action: { label: "Ir" } });
const CR = "America/Costa_Rica";

describe("todayDueView (F252)", () => {
  const now = new Date("2025-12-01T12:00:00-06:00");
  it("junta lo que vence hoy en su zona", () => {
    const r = todayDueView([item("hoy", "2025-12-01T23:59:00-06:00"), item("domingo", "2025-12-07T23:59:00-06:00")], now, CR);
    expect(r.map((x) => x.id)).toEqual(["hoy"]);
  });
  it("el reporte con gracia hasta las 6:00 de mañana es de hoy", () => {
    expect(todayDueView([item("reporte", "2025-12-02T06:00:00-06:00", false, 6)], now, CR)).toHaveLength(1);
    expect(todayDueView([item("sin gracia", "2025-12-02T06:00:00-06:00")], now, CR)).toHaveLength(0);
  });
  it("lo hecho y lo vencido no aparecen", () => {
    expect(todayDueView([item("hecho", "2025-12-01T23:00:00-06:00", true), item("vencido", "2025-12-01T08:00:00-06:00")], now, CR)).toEqual([]);
  });
  it("depende de la zona: las 22:30 de Costa Rica ya son mañana en Buenos Aires", () => {
    const x = [item("cr", "2025-12-01T22:30:00-06:00")];
    expect(todayDueView(x, now, CR)).toHaveLength(1);
    expect(todayDueView(x, now, "America/Argentina/Buenos_Aires")).toHaveLength(0);
  });
});
