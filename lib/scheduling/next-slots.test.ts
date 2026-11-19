import { describe, expect, it } from "vitest";
import { NEXT_SLOTS_COUNT, pickNextSlots } from "./next-slots";
import { dragConfirmReducer, type DragConfirmState } from "./booking-drag";

describe("los huecos libres siguientes", () => {
  const slots = [
    "2031-03-03T09:00:00.000Z",
    "2031-03-03T10:00:00.000Z", // el pedido, que se acaba de ocupar
    "2031-03-03T12:00:00.000Z",
    "2031-03-03T11:00:00.000Z",
    "2031-03-04T09:00:00.000Z",
    "2031-03-04T10:00:00.000Z",
  ];

  it("propone los siguientes al pedido, en orden, sin el pedido ni los anteriores", () => {
    expect(pickNextSlots(slots, "2031-03-03T10:00:00.000Z")).toEqual([
      "2031-03-03T11:00:00.000Z",
      "2031-03-03T12:00:00.000Z",
      "2031-03-04T09:00:00.000Z",
    ]);
  });

  it("propone como mucho tres y sin repetir", () => {
    const out = pickNextSlots([...slots, "2031-03-03T11:00:00Z"], "2031-03-03T08:00:00.000Z");
    expect(out).toHaveLength(NEXT_SLOTS_COUNT);
    expect(new Set(out).size).toBe(out.length);
  });

  it("sin huecos después, no inventa ninguno", () => {
    expect(pickNextSlots(slots, "2031-03-05T00:00:00.000Z")).toEqual([]);
    expect(pickNextSlots([], "2031-03-03T10:00:00.000Z")).toEqual([]);
    expect(pickNextSlots(slots, "no es una fecha")).toEqual([]);
  });
});

describe("mover una reunión a un hueco propuesto", () => {
  const confirming: DragConfirmState = {
    phase: "confirming",
    bookingId: "b1",
    drop: { kind: "day", date: "2031-03-03" },
    startUtc: "2031-03-03T10:00:00.000Z",
    reason: "lo pidió el cliente",
    ignoreAvailability: false,
  };

  it("el error guarda los huecos propuestos y elegir uno vuelve a pedir confirmación con ese horario", () => {
    const failed = dragConfirmReducer(confirming, { type: "failed", error: "Ese horario se acaba de ocupar.", alternatives: ["2031-03-03T11:00:00.000Z"] });
    expect(failed).toMatchObject({ phase: "error", alternatives: ["2031-03-03T11:00:00.000Z"] });
    const picked = dragConfirmReducer(failed, { type: "pickAlternative", startUtc: "2031-03-03T11:00:00.000Z" });
    expect(picked).toEqual({ ...confirming, phase: "pending", startUtc: "2031-03-03T11:00:00.000Z" });
  });

  it("no acepta un horario que no se propuso, ni elegir sin error", () => {
    const failed = dragConfirmReducer(confirming, { type: "failed", error: "x", alternatives: ["2031-03-03T11:00:00.000Z"] });
    expect(dragConfirmReducer(failed, { type: "pickAlternative", startUtc: "2031-03-03T15:00:00.000Z" })).toBe(failed);
    expect(dragConfirmReducer(confirming, { type: "pickAlternative", startUtc: "2031-03-03T11:00:00.000Z" })).toBe(confirming);
  });

  it("sin huecos propuestos, el error queda como antes", () => {
    expect(dragConfirmReducer(confirming, { type: "failed", error: "x" })).not.toHaveProperty("alternatives");
  });
});
