import { describe, expect, it } from "vitest";
import { readRoundState, roundActions } from "./round-state";

describe("las vueltas de Reunión", () => {
  it("agendada: asistió o no se presentó", () => expect(roundActions("scheduled", true)).toEqual(["attended", "no_show"]));
  it("no se presentó o por agendar: asistió o perdida", () => {
    expect(roundActions("no_show", true)).toEqual(["attended", "lost"]);
    expect(roundActions("to_schedule", true)).toEqual(["attended", "lost"]);
  });
  it("cerrada o sin estado: nada", () => {
    expect(roundActions("attended", true)).toEqual([]);
    expect(roundActions("scheduled", false)).toEqual([]);
    expect(roundActions(null, true)).toEqual([]);
  });
  it("un valor desconocido no es un estado", () => expect(readRoundState("otro")).toBeNull());
});
