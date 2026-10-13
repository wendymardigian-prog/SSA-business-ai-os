import { describe, expect, it } from "vitest";
import {
  bookingDropToStartUtc,
  classifyRescheduleError,
  dragConfirmReducer,
  isSameStart,
  RESCHEDULE_MESSAGES,
  rescheduleEffects,
  shouldCallAction,
  type DragConfirmEvent,
  type DragConfirmState,
} from "./booking-drag";

const CR = "America/Costa_Rica"; // UTC-6, sin horario de verano
const TOKYO = "Asia/Tokyo"; // UTC+9

describe("bookingDropToStartUtc (R8)", () => {
  it("una hora de la rejilla: la fecha y los minutos exactos, en la zona de quien mira", () => {
    // 14:30 del 20/10 en Costa Rica = 20:30 UTC.
    expect(bookingDropToStartUtc({ kind: "slot", date: "2026-10-20", minutes: 14 * 60 + 30 }, CR, "2026-10-14T15:00:00.000Z")).toBe("2026-10-20T20:30:00.000Z");
  });
  it("con una zona distinta a la del anfitrion: manda la de quien mira", () => {
    // 14:30 del 20/10 en Tokio = 05:30 UTC.
    expect(bookingDropToStartUtc({ kind: "slot", date: "2026-10-20", minutes: 14 * 60 + 30 }, TOKYO, "2026-10-14T15:00:00.000Z")).toBe("2026-10-20T05:30:00.000Z");
  });
  it("una celda del mes: cambia el dia y conserva la hora que veia quien mira", () => {
    // Estaba a las 09:00 en CR (15:00 UTC) el 14/10; se suelta el 22/10 -> 22/10 a las 09:00 en CR.
    expect(bookingDropToStartUtc({ kind: "day", date: "2026-10-22" }, CR, "2026-10-14T15:00:00.000Z")).toBe("2026-10-22T15:00:00.000Z");
    // La misma agenda vista desde Tokio estaba a las 00:00 del 15/10: al soltarla el 22 queda 00:00 del 22 en Tokio.
    expect(bookingDropToStartUtc({ kind: "day", date: "2026-10-22" }, TOKYO, "2026-10-14T15:00:00.000Z")).toBe("2026-10-21T15:00:00.000Z");
  });
  it("los pasos de 15 minutos caen en el minuto exacto", () => {
    expect(bookingDropToStartUtc({ kind: "slot", date: "2026-10-20", minutes: 7 * 60 + 15 }, CR, "2026-10-14T15:00:00.000Z")).toBe("2026-10-20T13:15:00.000Z");
  });
  it("isSameStart: soltar en el mismo lugar no cambia nada", () => {
    expect(isSameStart("2026-10-14T15:00:00.000Z", "2026-10-14T15:00:00Z")).toBe(true);
    expect(isSameStart("2026-10-14T15:15:00.000Z", "2026-10-14T15:00:00Z")).toBe(false);
  });
});

describe("los textos del reagendado estan fijados (R8)", () => {
  it("coinciden con los que devuelve lib/scheduling/booking/reschedule.ts", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("lib/scheduling/booking/reschedule.ts", "utf8");
    for (const message of Object.values(RESCHEDULE_MESSAGES)) expect(source, message).toContain(message);
  });
  it("classifyRescheduleError: solo «ya no esta disponible» ofrece reagendar igual", () => {
    expect(classifyRescheduleError("Ese horario ya no está disponible.")).toBe("outside_availability");
    expect(classifyRescheduleError("Ese horario se acaba de ocupar.")).toBe("taken");
    expect(classifyRescheduleError("Una reunión cancelada no se reagenda.")).toBe("cancelled");
    expect(classifyRescheduleError("No pude reagendar.")).toBe("other");
    expect(classifyRescheduleError(undefined)).toBe("other");
  });
  it("el texto de los efectos no promete lo que no hace", () => {
    const withGoogle = rescheduleEffects("synced").join(" ");
    expect(withGoogle).toContain("Google actualiza el evento");
    expect(withGoogle).toContain("conserva su duración");
    expect(withGoogle).toContain("Aviso de reagendamiento");
    const noGoogle = rescheduleEffects("not_applicable").join(" ");
    expect(noGoogle).toContain("no está en Google Calendar");
    expect(noGoogle).not.toContain("le avisa al invitado");
  });
});

const drop: DragConfirmEvent = { type: "drop", bookingId: "b1", drop: { kind: "slot", date: "2026-10-20", minutes: 600 }, startUtc: "2026-10-20T16:00:00.000Z" };
const run = (events: DragConfirmEvent[], from: DragConfirmState = { phase: "idle" }) => events.reduce(dragConfirmReducer, from);

describe("dragConfirmReducer: nada se guarda sin pasar por «pendiente» y una confirmacion (R8)", () => {
  it("soltar abre el modal (pending) con el destino y sin motivo", () => {
    expect(run([drop])).toMatchObject({ phase: "pending", bookingId: "b1", startUtc: "2026-10-20T16:00:00.000Z", reason: "", ignoreAvailability: false });
  });
  it("confirmar desde idle NO llama a nada", () => {
    expect(run([{ type: "confirm" }])).toEqual({ phase: "idle" });
    const a: DragConfirmState = { phase: "idle" };
    expect(shouldCallAction(a, dragConfirmReducer(a, { type: "confirm" }))).toBe(false);
  });
  it("el camino feliz: idle -> pending -> confirming -> done", () => {
    const phases: string[] = [];
    let s: DragConfirmState = { phase: "idle" };
    for (const e of [drop, { type: "reason", value: "pidió el cliente" } as const, { type: "confirm" } as const, { type: "succeeded" } as const]) {
      s = dragConfirmReducer(s, e);
      phases.push(s.phase);
    }
    expect(phases).toEqual(["pending", "pending", "confirming", "done"]);
  });
  it("la accion se llama SOLO al entrar a confirming, y solo despues de una confirmacion explicita", () => {
    const calls: DragConfirmEvent["type"][] = [];
    let s: DragConfirmState = { phase: "idle" };
    for (const e of [{ type: "confirm" }, drop, { type: "reason", value: "x" }, { type: "ignoreAvailability", value: true }, { type: "cancel" }, { type: "confirm" }, drop, { type: "confirm" }, { type: "confirm" }, { type: "succeeded" }, { type: "confirm" }] as DragConfirmEvent[]) {
      const next = dragConfirmReducer(s, e);
      if (shouldCallAction(s, next)) calls.push(e.type);
      s = next;
    }
    expect(calls).toEqual(["confirm"]);
  });
  it("cancelar vuelve a idle sin efectos, desde pending y desde error", () => {
    expect(run([drop, { type: "cancel" }])).toEqual({ phase: "idle" });
    expect(run([drop, { type: "confirm" }, { type: "failed", error: "x" }, { type: "cancel" }])).toEqual({ phase: "idle" });
  });
  it("con la llamada en vuelo no se puede cancelar ni cambiar el destino", () => {
    const confirming = run([drop, { type: "confirm" }]);
    expect(dragConfirmReducer(confirming, { type: "cancel" })).toBe(confirming);
    expect(dragConfirmReducer(confirming, { ...drop, bookingId: "otra" })).toBe(confirming);
    expect(dragConfirmReducer(confirming, { type: "reason", value: "tarde" })).toBe(confirming);
  });
  it("«ya no esta disponible» deja el modal abierto y ofrece reagendar igual; solo con la casilla se reintenta", () => {
    const failed = run([drop, { type: "confirm" }, { type: "failed", error: RESCHEDULE_MESSAGES.outsideAvailability }]);
    expect(failed).toMatchObject({ phase: "error", offerIgnore: true, ignoreAvailability: false });
    const ticked = dragConfirmReducer(failed, { type: "ignoreAvailability", value: true });
    expect(ticked).toMatchObject({ phase: "error", ignoreAvailability: true });
    const retry = dragConfirmReducer(ticked, { type: "confirm" });
    expect(retry).toMatchObject({ phase: "confirming", ignoreAvailability: true });
    expect(shouldCallAction(ticked, retry)).toBe(true);
  });
  it("un choque con otra agenda NO ofrece reagendar igual; cualquier otro error se muestra sin cerrar", () => {
    expect(run([drop, { type: "confirm" }, { type: "failed", error: RESCHEDULE_MESSAGES.taken }])).toMatchObject({ phase: "error", offerIgnore: false });
    expect(run([drop, { type: "confirm" }, { type: "failed", error: "No pude reagendar." }])).toMatchObject({ phase: "error", offerIgnore: false, error: "No pude reagendar." });
  });
  it("un fallo fuera de «confirmando» se ignora; un destino nuevo despues de un error reemplaza al anterior", () => {
    expect(run([drop, { type: "failed", error: "x" }])).toMatchObject({ phase: "pending" });
    const failed = run([drop, { type: "confirm" }, { type: "failed", error: "x" }]);
    expect(dragConfirmReducer(failed, { ...drop, bookingId: "b2" })).toMatchObject({ phase: "pending", bookingId: "b2", reason: "" });
  });
  it("el motivo y la casilla se pierden al cancelar (la proxima vez arranca limpia)", () => {
    const s = run([drop, { type: "reason", value: "algo" }, { type: "ignoreAvailability", value: true }, { type: "cancel" }, drop]);
    expect(s).toMatchObject({ phase: "pending", reason: "", ignoreAvailability: false });
  });
});
