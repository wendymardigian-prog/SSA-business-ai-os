import { describe, it, expect } from "vitest";
import { planMoveToEdits } from "./board-actions";

describe("planMoveToEdits (F16)", () => {
  it("la tarjeta movida a otra columna guarda estado y posicion", () => {
    expect(planMoveToEdits("a", { status: "in_progress", changesStatus: true, updates: [{ id: "a", position: 1500 }] })).toEqual([{ id: "a", patch: { status: "in_progress", position: 1500 } }]);
  });
  it("dentro de la misma columna solo cambia la posicion", () => {
    expect(planMoveToEdits("a", { status: "pending", changesStatus: false, updates: [{ id: "a", position: 0 }] })).toEqual([{ id: "a", patch: { position: 0 } }]);
  });
  it("al renumerar, las demas solo guardan su posicion", () => {
    const edits = planMoveToEdits("b", { status: "pending", changesStatus: true, updates: [{ id: "a", position: 1000 }, { id: "b", position: 2000 }, { id: "c", position: 3000 }] });
    expect(edits).toEqual([
      { id: "a", patch: { position: 1000 } },
      { id: "b", patch: { status: "pending", position: 2000 } },
      { id: "c", patch: { position: 3000 } },
    ]);
  });
});
