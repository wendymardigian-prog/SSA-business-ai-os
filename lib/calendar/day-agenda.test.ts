import { describe, expect, it } from "vitest";
import { daySummary, filterDayEntries, sortDayEntries, type DayEntry } from "./day-agenda";

const e = (kind: DayEntry["kind"], id: string, startMinutes: number | null, title = id): DayEntry => ({
  kind, id, title, startMinutes, timeLabel: "", sub: null, openable: kind !== "busy",
});

describe("«Ver todo» de un día", () => {
  it("todo el día primero; después por hora; a igual hora, reunión, tarea y Google", () => {
    const sorted = sortDayEntries([e("google", "g9", 540), e("booking", "b9", 540), e("task", "t9", 540), e("google", "allday", null), e("booking", "b8", 480)]);
    expect(sorted.map((x) => x.id)).toEqual(["allday", "b8", "b9", "t9", "g9"]);
  });

  it("los interruptores sacan tareas o Google; las reuniones siempre quedan", () => {
    const all = [e("booking", "b", 600), e("task", "t", 610), e("google", "g", 620), e("busy", "o", 630)];
    expect(filterDayEntries(all, { tasks: false, google: true }).map((x) => x.id)).toEqual(["b", "g", "o"]);
    expect(filterDayEntries(all, { tasks: true, google: false }).map((x) => x.id)).toEqual(["b", "t"]);
  });

  it("el resumen cuenta cada cosa, en singular o plural", () => {
    expect(daySummary([e("booking", "a", 1), e("booking", "b", 2), e("google", "g", 3), e("task", "t", 4)])).toBe("2 reuniones · 1 evento de Google · 1 tarea");
    expect(daySummary([])).toBe("Nada agendado");
  });
});

describe("clases en vivo en el día", () => {
  it("van después de las reuniones a la misma hora, siempre se muestran y se cuentan", () => {
    const entry = (kind: DayEntry["kind"], id: string, startMinutes: number | null): DayEntry => ({ kind, id, title: id, startMinutes, timeLabel: "", sub: null, openable: kind !== "class" });
    const all = [entry("task", "t", 600), entry("class", "c", 600), entry("booking", "b", 600)];
    expect(sortDayEntries(all).map((x) => x.id)).toEqual(["b", "c", "t"]);
    expect(filterDayEntries(all, { tasks: false, google: false }).map((x) => x.id)).toEqual(["b", "c"]);
    expect(daySummary([entry("booking", "b", 1), entry("class", "c", 2), entry("class", "d", 3)])).toBe("1 reunión · 2 clases");
  });
});
