import { describe, expect, it } from "vitest";
import { dropTarget, isSameDrop, movedMessage, snapMinutes, undoPatch } from "./calendar-drag";

const CR = "America/Costa_Rica";
const TOKYO = "Asia/Tokyo";
const timedTask = { due_date: "2026-10-14", due_time: "09:30:00", duration_minutes: 45 };
const plainTask = { due_date: "2026-10-14", due_time: null, duration_minutes: null };

describe("snapMinutes (R7)", () => {
  // La rejilla arranca a las 7 y cada hora mide 44 px.
  it("el borde de arriba es la primera hora", () => {
    expect(snapMinutes(0, 44, 7)).toBe(7 * 60);
  });
  it("ajusta a pasos de 15 minutos", () => {
    expect(snapMinutes(44, 44, 7)).toBe(8 * 60); // una hora abajo
    expect(snapMinutes(44 + 6, 44, 7)).toBe(8 * 60 + 15); // ~16 min -> 15
    expect(snapMinutes(44 + 2, 44, 7)).toBe(8 * 60); // ~3 min -> 0
    expect(snapMinutes(44 * 3 + 22, 44, 7)).toBe(10 * 60 + 30); // media hora
  });
  it("redondea al paso mas cercano, no hacia abajo", () => {
    expect(snapMinutes((52 / 60) * 44, 44, 0)).toBe(45); // 52 min -> 45
    expect(snapMinutes((53 / 60) * 44, 44, 0)).toBe(60); // 53 min -> 60
  });
  it("no sale del dia", () => {
    expect(snapMinutes(-500, 44, 7)).toBe(0);
    expect(snapMinutes(99999, 44, 7)).toBe(24 * 60 - 15);
  });
  it("respeta otro paso", () => {
    expect(snapMinutes(9, 44, 7, 30)).toBe(7 * 60); // 7:12 -> 7:00
    expect(snapMinutes(13, 44, 7, 30)).toBe(7 * 60 + 30); // 7:17 -> 7:30
  });
});

describe("dropTarget (R7)", () => {
  it("una hora de la rejilla -> fecha + hora, conservando la duracion (misma zona)", () => {
    expect(dropTarget({ task: timedTask, target: { kind: "slot", date: "2026-10-16", minutes: 15 * 60 + 15 }, workspaceTz: CR, viewerTz: CR })).toEqual({ due_date: "2026-10-16", due_time: "15:15", duration_minutes: 45 });
  });
  it("con una zona del workspace distinta de la del perfil: se convierte a hora del workspace", () => {
    // 09:00 del 16/10 en Tokio (UTC+9) = 00:00 UTC = 18:00 del 15/10 en Costa Rica.
    expect(dropTarget({ task: timedTask, target: { kind: "slot", date: "2026-10-16", minutes: 9 * 60 }, workspaceTz: CR, viewerTz: TOKYO })).toEqual({ due_date: "2026-10-15", due_time: "18:00", duration_minutes: 45 });
  });
  it("una tarea sin hora soltada en la rejilla gana hora (sin duracion)", () => {
    expect(dropTarget({ task: plainTask, target: { kind: "slot", date: "2026-10-16", minutes: 600 }, workspaceTz: CR, viewerTz: CR })).toEqual({ due_date: "2026-10-16", due_time: "10:00", duration_minutes: null });
  });
  it("la franja «Sin hora» -> solo fecha: se quitan la hora y la duracion", () => {
    expect(dropTarget({ task: timedTask, target: { kind: "allday", date: "2026-10-17" }, workspaceTz: CR, viewerTz: CR })).toEqual({ due_date: "2026-10-17", due_time: null, duration_minutes: null });
    expect(dropTarget({ task: timedTask, target: { kind: "allday", date: "2026-10-17" }, workspaceTz: CR, viewerTz: TOKYO }).due_date).toBe("2026-10-17");
  });
  it("una celda del mes -> cambia el dia y conserva la hora y la duracion (misma zona)", () => {
    expect(dropTarget({ task: timedTask, target: { kind: "day", date: "2026-10-22" }, workspaceTz: CR, viewerTz: CR })).toEqual({ due_date: "2026-10-22", due_time: "09:30", duration_minutes: 45 });
  });
  it("una celda del mes con otra zona: conserva la hora que veia quien mira", () => {
    // 09:30 CR del 14 = 15:30 UTC = 00:30 del 15 en Tokio; se suelta el 22 (Tokio) -> 22 a las 00:30 en Tokio = 21 a las 09:30 en CR.
    expect(dropTarget({ task: timedTask, target: { kind: "day", date: "2026-10-22" }, workspaceTz: CR, viewerTz: TOKYO })).toEqual({ due_date: "2026-10-21", due_time: "09:30", duration_minutes: 45 });
  });
  it("una celda del mes con una tarea sin hora: solo cambia el dia", () => {
    expect(dropTarget({ task: plainTask, target: { kind: "day", date: "2026-10-22" }, workspaceTz: CR, viewerTz: TOKYO })).toEqual({ due_date: "2026-10-22", due_time: null, duration_minutes: null });
  });
});

describe("isSameDrop / undoPatch / movedMessage (R7)", () => {
  it("soltar en el mismo lugar no hace nada", () => {
    expect(isSameDrop(timedTask, { due_date: "2026-10-14", due_time: "09:30", duration_minutes: 45 })).toBe(true);
    expect(isSameDrop(plainTask, { due_date: "2026-10-14", due_time: null, duration_minutes: null })).toBe(true);
    expect(isSameDrop(timedTask, { due_date: "2026-10-14", due_time: "09:45", duration_minutes: 45 })).toBe(false);
    expect(isSameDrop(timedTask, { due_date: "2026-10-15", due_time: "09:30", duration_minutes: 45 })).toBe(false);
  });
  it("undoPatch restaura fecha, hora y duracion anteriores", () => {
    expect(undoPatch(timedTask)).toEqual({ due_date: "2026-10-14", due_time: "09:30", duration_minutes: 45 });
    expect(undoPatch(plainTask)).toEqual({ due_date: "2026-10-14", due_time: null, duration_minutes: null });
  });
  it("mover y deshacer vuelve a donde estaba", () => {
    const moved = dropTarget({ task: timedTask, target: { kind: "allday", date: "2026-10-20" }, workspaceTz: CR, viewerTz: CR });
    expect(undoPatch(timedTask)).not.toEqual(moved);
    expect(isSameDrop(timedTask, undoPatch(timedTask))).toBe(true);
  });
  it("el aviso dice el dia y la hora, en el formato de quien mira", () => {
    expect(movedMessage({ due_date: "2026-10-20", due_time: "14:30", duration_minutes: 30 }, "24h", "2026-10-13")).toBe("Tarea movida al 20/10 · 14:30");
    expect(movedMessage({ due_date: "2026-10-20", due_time: "14:30", duration_minutes: 30 }, "12h", "2026-10-13")).toBe("Tarea movida al 20/10 · 2:30 p. m.");
    expect(movedMessage({ due_date: "2026-10-20", due_time: null, duration_minutes: null }, "24h", "2026-10-13")).toBe("Tarea movida al 20/10");
  });
});
