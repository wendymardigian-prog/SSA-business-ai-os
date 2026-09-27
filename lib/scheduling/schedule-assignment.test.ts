import { describe, expect, it } from "vitest";
import { copyName, decideDeleteSchedule, decideToggleEventSchedule, eventsForSchedule } from "./schedule-rules";

const normal = { id: "s1", name: "Horario normal", is_default: true };
const tardes = { id: "s2", name: "Tardes", is_default: false };

describe("borrar un horario (F10)", () => {
  it("el por defecto no se borra", () => {
    expect(decideDeleteSchedule({ schedule: normal, others: [tardes], eventsUsingIt: 0 })).toMatchObject({ ok: false, reason: "is_default" });
  });
  it("sin eventos que lo usen, se borra directo", () => {
    expect(decideDeleteSchedule({ schedule: tardes, others: [normal], eventsUsingIt: 0 })).toEqual({ ok: true, moveEventsTo: null });
  });
  it("con eventos, exige el reemplazo y los mueve ahi", () => {
    const sin = decideDeleteSchedule({ schedule: tardes, others: [normal], eventsUsingIt: 2 });
    expect(sin).toMatchObject({ ok: false, reason: "needs_replacement" });
    expect(!sin.ok && sin.message).toContain("2 eventos");
    expect(decideDeleteSchedule({ schedule: tardes, others: [normal], eventsUsingIt: 2, replacementId: "s1" })).toEqual({ ok: true, moveEventsTo: "s1" });
    expect(decideDeleteSchedule({ schedule: tardes, others: [normal], eventsUsingIt: 2, replacementId: "s2" })).toMatchObject({ ok: false, reason: "replacement_invalid" });
  });
});

describe("duplicar (F10)", () => {
  it("suma (copia) y numera si ya existe", () => {
    expect(copyName("Tardes", ["Tardes"])).toBe("Tardes (copia)");
    expect(copyName("Tardes", ["Tardes", "Tardes (copia)"])).toBe("Tardes (copia 2)");
    expect(copyName("Tardes (copia)", ["Tardes", "Tardes (copia)"])).toBe("Tardes (copia 2)");
  });
});

describe("eventos que usan este horario (F14)", () => {
  const events = [
    { id: "e1", title: "Diagnóstico", schedule_id: null },
    { id: "e2", title: "Cierre", schedule_id: "s2" },
  ];
  it("en el por defecto, los eventos sin horario aparecen encendidos con la etiqueta", () => {
    expect(eventsForSchedule(events, normal).map((e) => [e.id, e.on, e.implicitDefault])).toEqual([["e1", true, true], ["e2", false, false]]);
    expect(eventsForSchedule(events, tardes).map((e) => [e.id, e.on])).toEqual([["e1", false], ["e2", true]]);
  });
  it("encender asigna; apagar devuelve al por defecto", () => {
    expect(decideToggleEventSchedule({ event: events[0], schedule: tardes, turnOn: true })).toEqual({ change: true, scheduleId: "s2" });
    expect(decideToggleEventSchedule({ event: events[1], schedule: tardes, turnOn: false })).toEqual({ change: true, scheduleId: null });
  });
  it("apagar un evento que ya usa el por defecto en el por defecto no cambia nada y lo explica", () => {
    const d = decideToggleEventSchedule({ event: events[0], schedule: normal, turnOn: false });
    expect(d).toMatchObject({ change: false, reason: "already_default" });
    expect(!d.change && d.tooltip).toContain("por defecto");
  });
});
