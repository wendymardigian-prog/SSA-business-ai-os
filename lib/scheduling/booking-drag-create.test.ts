import { describe, expect, it } from "vitest";
import {
  dragConfirmReducer,
  dragCreateRange,
  durationLabel,
  MAX_DRAG_MINUTES,
  MIN_DRAG_MINUTES,
  rescheduleEffects,
  resizeDuration,
  wallTimeOfMinutes,
} from "./booking-drag";

describe("crear arrastrando", () => {
  it("de arriba a abajo: inicio y duración", () => {
    expect(dragCreateRange(600, 690)).toEqual({ startMinutes: 600, durationMinutes: 90 });
  });
  it("de abajo a arriba da lo mismo", () => {
    expect(dragCreateRange(690, 600)).toEqual({ startMinutes: 600, durationMinutes: 90 });
  });
  it("un clic sin arrastrar da la duración mínima", () => {
    expect(dragCreateRange(540, 540)).toEqual({ startMinutes: 540, durationMinutes: MIN_DRAG_MINUTES });
  });
  it("nunca pasa de 8 horas ni de la medianoche", () => {
    expect(dragCreateRange(0, 23 * 60).durationMinutes).toBe(MAX_DRAG_MINUTES);
    expect(dragCreateRange(23 * 60 + 45, 23 * 60 + 45)).toEqual({ startMinutes: 23 * 60 + 45, durationMinutes: 15 });
  });
  it("la hora de pared para abrir «Agendar»", () => {
    expect(wallTimeOfMinutes(9 * 60 + 15)).toBe("09:15");
  });
});

describe("cambiar la duración", () => {
  it("estirar y encoger desde el borde de abajo", () => {
    expect(resizeDuration(600, 675)).toBe(75);
    expect(resizeDuration(600, 615)).toBe(15);
  });
  it("encoger por debajo del mínimo se queda en 15 minutos", () => {
    expect(resizeDuration(600, 590)).toBe(15);
  });
  it("tope de 8 horas y de la medianoche", () => {
    expect(resizeDuration(60, 60 + 10 * 60)).toBe(MAX_DRAG_MINUTES);
    expect(resizeDuration(23 * 60, 24 * 60 + 30)).toBe(60);
  });
  it("la etiqueta de la duración", () => {
    expect(durationLabel(45)).toBe("45 min");
    expect(durationLabel(60)).toBe("1 h");
    expect(durationLabel(90)).toBe("1 h 30 min");
  });
  it("el modal guarda la duración nueva hasta confirmar y la conserva en el reintento", () => {
    const pending = dragConfirmReducer({ phase: "idle" }, {
      type: "drop",
      bookingId: "b1",
      drop: { kind: "day", date: "2026-11-16" },
      startUtc: "2026-11-16T09:00:00.000Z",
      durationMinutes: 75,
    });
    expect(pending).toMatchObject({ phase: "pending", durationMinutes: 75 });
    const confirming = dragConfirmReducer(pending, { type: "confirm" });
    expect(confirming).toMatchObject({ phase: "confirming", durationMinutes: 75 });
    const failed = dragConfirmReducer(confirming, { type: "failed", error: "x" });
    expect(failed).toMatchObject({ phase: "error", durationMinutes: 75 });
  });
  it("mover sin estirar no inventa una duración", () => {
    const pending = dragConfirmReducer({ phase: "idle" }, { type: "drop", bookingId: "b1", drop: { kind: "day", date: "2026-11-16" }, startUtc: "2026-11-16T09:00:00.000Z" });
    expect("durationMinutes" in pending).toBe(false);
  });
  it("el modal dice la duración nueva", () => {
    expect(rescheduleEffects("not_applicable", 75)[0]).toBe("La agenda pasa a durar 1 h 15 min y queda en estado «Reagenda».");
    expect(rescheduleEffects("not_applicable")[0]).toBe("La agenda conserva su duración y queda en estado «Reagenda».");
  });
});
