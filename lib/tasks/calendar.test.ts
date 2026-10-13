import { describe, expect, it } from "vitest";
import { makeTask, taskId } from "./fixtures";
import { dueDateWindow, placeTasksInCalendar } from "./calendar";

const CR = "America/Costa_Rica"; // UTC-6
const TOKYO = "Asia/Tokyo"; // UTC+9
const ARG = "America/Argentina/Buenos_Aires"; // UTC-3
const range = { from: "2026-10-12", to: "2026-10-18" };
const place = (tasks: ReturnType<typeof makeTask>[], over: Partial<Parameters<typeof placeTasksInCalendar>[0]> = {}) =>
  placeTasksInCalendar({ tasks, workspaceTz: CR, viewerTz: CR, view: "week", range, ...over });

describe("placeTasksInCalendar (R7)", () => {
  it("una tarea con hora cae en su dia y su hora; dura lo suyo o 30 minutos", () => {
    const withDuration = makeTask({ id: taskId(1), due_date: "2026-10-14", due_time: "09:30:00", duration_minutes: 60 });
    const withoutDuration = makeTask({ id: taskId(2), due_date: "2026-10-14", due_time: "11:00" });
    const { byDate } = place([withDuration, withoutDuration]);
    expect(byDate["2026-10-14"].map((i) => [i.task.id, i.startMinutes, i.endMinutes, i.durationMinutes])).toEqual([
      [taskId(1), 570, 630, 60],
      [taskId(2), 660, 690, 30],
    ]);
  });

  it("una tarea sin hora queda en su fecha tal cual, sin minutos, y despues de las que tienen hora", () => {
    const { byDate } = place([makeTask({ id: taskId(1), due_date: "2026-10-14" }), makeTask({ id: taskId(2), due_date: "2026-10-14", due_time: "16:00" })]);
    expect(byDate["2026-10-14"].map((i) => [i.task.id, i.timed, i.startMinutes])).toEqual([[taskId(2), true, 960], [taskId(1), false, null]]);
  });

  it("las sin hora no se mueven aunque la zona de quien mira sea distinta (no tienen instante que convertir)", () => {
    const task = makeTask({ id: taskId(1), due_date: "2026-10-14" });
    for (const viewerTz of [CR, TOKYO, ARG]) expect(place([task], { viewerTz }).byDate["2026-10-14"]).toHaveLength(1);
  });

  it("con dos zonas: la hora del workspace se convierte a la de quien mira", () => {
    // 09:30 en Costa Rica (UTC-6) = 15:30 UTC = 12:30 en Buenos Aires (UTC-3) = 00:30 del dia siguiente en Tokio (UTC+9).
    const task = makeTask({ id: taskId(1), due_date: "2026-10-14", due_time: "09:30" });
    expect(place([task], { viewerTz: ARG }).byDate["2026-10-14"][0].startMinutes).toBe(12 * 60 + 30);
    const tokyo = place([task], { viewerTz: TOKYO });
    expect(tokyo.byDate["2026-10-14"]).toHaveLength(0);
    expect(tokyo.byDate["2026-10-15"][0]).toMatchObject({ startMinutes: 30, date: "2026-10-15" });
  });

  it("cruce de medianoche: una tarea de la noche del workspace puede caer al dia siguiente en otra zona, y al revez", () => {
    const late = makeTask({ id: taskId(1), due_date: "2026-10-14", due_time: "21:00" });
    // 21:00 CR = 03:00 UTC (dia 15) = 12:00 del 15 en Tokio.
    expect(place([late], { viewerTz: TOKYO }).byDate["2026-10-15"][0].startMinutes).toBe(12 * 60);
    // 01:00 CR del 15 = 07:00 UTC; visto desde un workspace en Tokio (UTC+9) es el 14 a las 16:00 desde CR?: aca el workspace es Tokio.
    const early = makeTask({ id: taskId(2), due_date: "2026-10-15", due_time: "01:00" });
    const back = place([early], { workspaceTz: TOKYO, viewerTz: CR });
    expect(back.byDate["2026-10-14"][0].startMinutes).toBe(10 * 60);
  });

  it("una tarea que termina despues de medianoche conserva el fin (puede pasar de 1440)", () => {
    const task = makeTask({ id: taskId(1), due_date: "2026-10-14", due_time: "23:30", duration_minutes: 90 });
    const item = place([task]).byDate["2026-10-14"][0];
    expect(item.startMinutes).toBe(23 * 60 + 30);
    expect(item.endMinutes).toBe(23 * 60 + 30 + 90);
  });

  it("completadas: se ubican igual (la pantalla las dibuja atenuadas); las borradas y las sin fecha, no", () => {
    const done = makeTask({ id: taskId(1), due_date: "2026-10-14", status: "completed" });
    const deleted = makeTask({ id: taskId(2), due_date: "2026-10-14", deleted_at: "2026-10-01T00:00:00Z" });
    const undated = makeTask({ id: taskId(3), due_date: null });
    expect(place([done, deleted, undated]).items.map((i) => i.task.id)).toEqual([taskId(1)]);
  });

  it("el rango: solo los dias de la vista, y todos los dias aparecen (vacios incluidos)", () => {
    const inside = makeTask({ id: taskId(1), due_date: "2026-10-18" });
    const before = makeTask({ id: taskId(2), due_date: "2026-10-11" });
    const after = makeTask({ id: taskId(3), due_date: "2026-10-19" });
    const placement = place([inside, before, after]);
    expect(placement.items.map((i) => i.task.id)).toEqual([taskId(1)]);
    expect(Object.keys(placement.byDate)).toHaveLength(7);
    expect(placement.byDate["2026-10-12"]).toEqual([]);
  });

  it("una duracion invalida se ignora (se dibuja de 30 minutos)", () => {
    const task = makeTask({ id: taskId(1), due_date: "2026-10-14", due_time: "10:00", duration_minutes: 3 });
    expect(place([task]).byDate["2026-10-14"][0].durationMinutes).toBe(30);
  });

  it("dueDateWindow pide un dia de margen a cada lado por la zona", () => {
    expect(dueDateWindow({ from: "2026-10-12", to: "2026-10-18" })).toEqual({ from: "2026-10-11", to: "2026-10-19" });
  });
});
