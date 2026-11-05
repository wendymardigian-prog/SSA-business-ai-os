import { describe, expect, it } from "vitest";
import { dueDayPatch, dueEditPatch, dueForViewer, dueInstantMs, dueSeen, dueToStored } from "./due-view";

const CR = "America/Costa_Rica"; // UTC-6, sin cambio de hora
const ARG = "America/Argentina/Buenos_Aires"; // UTC-3
const TOKYO = "Asia/Tokyo"; // UTC+9
const NY = "America/New_York";

describe("dueForViewer", () => {
  it("una tarea sin hora es una fecha civil: no se convierte en ninguna zona", () => {
    for (const viewer of [ARG, TOKYO, "Pacific/Kiritimati", "Etc/GMT+12"]) {
      expect(dueForViewer({ due_date: "2026-10-14", due_time: null }, CR, viewer)).toEqual({ date: "2026-10-14", time: null });
    }
  });
  it("sin fecha no hay nada, aunque quedara una hora", () => {
    expect(dueForViewer({ due_date: null, due_time: "10:00" }, CR, TOKYO)).toEqual({ date: null, time: null });
  });
  it("con la misma zona devuelve lo mismo, con la hora normalizada a HH:MM", () => {
    expect(dueForViewer({ due_date: "2026-10-14", due_time: "09:30:00" }, CR, CR)).toEqual({ date: "2026-10-14", time: "09:30" });
  });
  it("convierte la hora dentro del mismo dia", () => {
    expect(dueForViewer({ due_date: "2026-10-14", due_time: "09:30:00" }, CR, ARG)).toEqual({ date: "2026-10-14", time: "12:30" });
  });
  it("cruza al dia siguiente: las 23:00 del negocio son otro dia para quien mira", () => {
    expect(dueForViewer({ due_date: "2026-10-14", due_time: "23:00" }, CR, TOKYO)).toEqual({ date: "2026-10-15", time: "14:00" });
  });
  it("cruza al dia anterior", () => {
    expect(dueForViewer({ due_date: "2026-10-15", due_time: "01:00" }, TOKYO, CR)).toEqual({ date: "2026-10-14", time: "10:00" });
  });
  it("la medianoche se escribe 00:00, nunca 24:00", () => {
    expect(dueForViewer({ due_date: "2026-10-14", due_time: "21:00" }, ARG, "Etc/UTC")).toEqual({ date: "2026-10-15", time: "00:00" });
  });
  it("una zona invalida no lanza: devuelve lo guardado", () => {
    expect(dueForViewer({ due_date: "2026-10-14", due_time: "09:30:00" }, "No/Existe", TOKYO)).toEqual({ date: "2026-10-14", time: "09:30" });
    expect(dueForViewer({ due_date: "2026-10-14", due_time: "09:30" }, CR, "No/Existe")).toEqual({ date: "2026-10-14", time: "09:30" });
  });
  it("un valor invalido no lanza ni se corre de mes: devuelve lo guardado", () => {
    expect(dueForViewer({ due_date: "2026-02-31", due_time: "09:30" }, CR, TOKYO)).toEqual({ date: "2026-02-31", time: "09:30" });
    expect(dueForViewer({ due_date: "2026-10-14", due_time: "99:99" }, CR, TOKYO)).toEqual({ date: "2026-10-14", time: null });
  });
});

describe("dueToStored", () => {
  it("sin hora: la fecha tal cual", () => {
    expect(dueToStored({ date: "2026-10-14", time: null }, CR, TOKYO)).toEqual({ due_date: "2026-10-14", due_time: null });
    expect(dueToStored({ date: null, time: "10:00" }, CR, TOKYO)).toEqual({ due_date: null, due_time: null });
  });
  it("con la misma zona, lo mismo", () => {
    expect(dueToStored({ date: "2026-10-14", time: "09:30" }, CR, CR)).toEqual({ due_date: "2026-10-14", due_time: "09:30" });
  });
  it("cruza de dia en los dos sentidos", () => {
    expect(dueToStored({ date: "2026-10-15", time: "14:00" }, CR, TOKYO)).toEqual({ due_date: "2026-10-14", due_time: "23:00" });
    expect(dueToStored({ date: "2026-10-14", time: "10:00" }, TOKYO, CR)).toEqual({ due_date: "2026-10-15", due_time: "01:00" });
  });
  it("una zona invalida no lanza", () => {
    expect(dueToStored({ date: "2026-10-14", time: "09:30" }, "No/Existe", TOKYO)).toEqual({ due_date: "2026-10-14", due_time: "09:30" });
  });
  it("ida y vuelta: vuelve a lo guardado", () => {
    const cases = [
      { due_date: "2026-10-14", due_time: "23:00" },
      { due_date: "2026-10-14", due_time: "00:15" },
      { due_date: "2026-12-31", due_time: "22:30" },
      { due_date: "2027-01-01", due_time: "02:00" },
    ];
    for (const stored of cases) {
      for (const [ws, viewer] of [[CR, TOKYO], [TOKYO, CR], [ARG, CR], ["Pacific/Kiritimati", "Etc/GMT+12"]]) {
        expect(dueToStored(dueForViewer(stored, ws, viewer), ws, viewer)).toEqual(stored);
      }
    }
  });
});

// Lo que hace hoy `lib/dates` en los bordes del cambio de hora. Estos casos documentan el comportamiento, no dicen que sea
// el ideal: una hora que no existe en la zona no tiene una respuesta correcta.
describe("cambio de horario (America/New_York, 2026)", () => {
  it("una hora que no existe (8/3, 02:30): se guarda como el instante de las 01:30, y al leerla se ve 01:30", () => {
    const stored = dueToStored({ date: "2026-03-08", time: "02:30" }, ARG, NY);
    // 06:30 UTC = 03:30 en Buenos Aires = 01:30 en Nueva York.
    expect(stored).toEqual({ due_date: "2026-03-08", due_time: "03:30" });
    expect(dueForViewer(stored, ARG, NY)).toEqual({ date: "2026-03-08", time: "01:30" });
  });
  it("una hora repetida (1/11, 01:30): se toma la primera vez (con horario de verano)", () => {
    const stored = dueToStored({ date: "2026-11-01", time: "01:30" }, ARG, NY);
    // 05:30 UTC = 02:30 en Buenos Aires.
    expect(stored).toEqual({ due_date: "2026-11-01", due_time: "02:30" });
    expect(dueForViewer(stored, ARG, NY)).toEqual({ date: "2026-11-01", time: "01:30" });
  });
  it("la segunda vez de la hora repetida se ve igual, pero no se puede volver a escribir: se corre una hora", () => {
    // 03:30 en Buenos Aires = 06:30 UTC = 01:30 en Nueva York por segunda vez.
    const seen = dueForViewer({ due_date: "2026-11-01", due_time: "03:30" }, ARG, NY);
    expect(seen).toEqual({ date: "2026-11-01", time: "01:30" });
    expect(dueToStored(seen, ARG, NY)).toEqual({ due_date: "2026-11-01", due_time: "02:30" });
  });
  it("con la misma zona nada se corre, ni con una hora que no existe", () => {
    expect(dueForViewer({ due_date: "2026-03-08", due_time: "02:30" }, NY, NY)).toEqual({ date: "2026-03-08", time: "02:30" });
    expect(dueToStored({ date: "2026-03-08", time: "02:30" }, NY, NY)).toEqual({ due_date: "2026-03-08", due_time: "02:30" });
  });
});

describe("dueSeen", () => {
  it("sin zonas es lo guardado, normalizado; con zonas, lo convertido", () => {
    const task = { due_date: "2026-10-14", due_time: "23:00:00" };
    expect(dueSeen(task)).toEqual({ date: "2026-10-14", time: "23:00" });
    expect(dueSeen(task, { workspaceTz: CR, viewerTz: TOKYO })).toEqual({ date: "2026-10-15", time: "14:00" });
  });
});

describe("dueEditPatch / dueDayPatch", () => {
  const zones = { workspaceTz: CR, viewerTz: TOKYO };
  // 23:00 del 14 en Costa Rica = 14:00 del 15 en Tokio.
  const timed = { due_date: "2026-10-14", due_time: "23:00:00" };

  it("editar solo el dia conserva el instante correcto: el dia guardado se calcula con la hora que se ve", () => {
    // Quien mira ve el 15 a las 14:00 y elige el 20: 14:00 del 20 en Tokio = 23:00 del 19 en Costa Rica.
    expect(dueDayPatch(timed, "2026-10-20", zones)).toEqual({ due_date: "2026-10-19" });
  });
  it("cambiar la hora puede mover tambien la fecha guardada", () => {
    // 15:30 del 15 en Tokio = 00:30 del 15 en Costa Rica.
    expect(dueEditPatch(timed, { date: "2026-10-15", time: "15:30" }, zones)).toEqual({ due_date: "2026-10-15", due_time: "00:30" });
  });
  it("sin cambios no manda nada", () => {
    expect(dueEditPatch(timed, { date: "2026-10-15", time: "14:00" }, zones)).toEqual({});
    expect(dueDayPatch(timed, "2026-10-15", zones)).toEqual({});
  });
  it("quitar la hora deja la fecha que elige quien mira, tal cual (civil)", () => {
    expect(dueEditPatch(timed, { date: "2026-10-15", time: null }, zones)).toEqual({ due_date: "2026-10-15", due_time: null });
  });
  it("agregar una hora a una tarea sin hora convierte el dia y la hora", () => {
    expect(dueEditPatch({ due_date: "2026-10-15", due_time: null }, { date: "2026-10-15", time: "14:00" }, zones)).toEqual({ due_date: "2026-10-14", due_time: "23:00" });
  });
  it("una tarea sin hora: el dia es civil", () => {
    expect(dueDayPatch({ due_date: "2026-10-15", due_time: null }, "2026-10-20", zones)).toEqual({ due_date: "2026-10-20" });
  });
  it("quitar la fecha quita tambien la hora", () => {
    expect(dueDayPatch(timed, null, zones)).toEqual({ due_date: null, due_time: null });
    expect(dueDayPatch({ due_date: "2026-10-15", due_time: null }, null, zones)).toEqual({ due_date: null });
  });
  it("con la misma zona, solo lo que se toco", () => {
    expect(dueDayPatch(timed, "2026-10-20", { workspaceTz: CR, viewerTz: CR })).toEqual({ due_date: "2026-10-20" });
  });
});

describe("dueInstantMs", () => {
  it("sin hora no hay instante", () => {
    expect(dueInstantMs({ due_date: "2026-10-14", due_time: null }, CR)).toBeNull();
    expect(dueInstantMs({ due_date: null }, CR)).toBeNull();
  });
  it("es el instante de la hora en la zona del workspace", () => {
    expect(dueInstantMs({ due_date: "2026-10-14", due_time: "09:30:00" }, CR)).toBe(Date.parse("2026-10-14T15:30:00Z"));
  });
  it("una zona invalida no lanza y sigue ordenando", () => {
    expect(dueInstantMs({ due_date: "2026-10-14", due_time: "09:30" }, "No/Existe")).toBe(Date.parse("2026-10-14T09:30:00Z"));
  });
});
