import { describe, expect, it } from "vitest";
import { retentionAction, retentionCutoffs } from "./retention";

const NOW = new Date("2026-10-12T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe("retentionAction", () => {
  it("bordes: 89 conserva, 90 vacia, 365 vacia, 366 borra", () => {
    expect(retentionAction(daysAgo(89), NOW)).toBe("keep");
    expect(retentionAction(daysAgo(90), NOW)).toBe("clear_payload");
    expect(retentionAction(daysAgo(365), NOW)).toBe("clear_payload");
    expect(retentionAction(daysAgo(366), NOW)).toBe("delete");
  });
  it("una fecha ilegible se conserva", () => {
    expect(retentionAction("nada", NOW)).toBe("keep");
  });
  it("los cortes de las consultas coinciden con los bordes", () => {
    const { clearBefore, deleteBefore } = retentionCutoffs(NOW);
    expect(new Date(clearBefore).getTime()).toBe(daysAgo(90).getTime());
    expect(new Date(deleteBefore).getTime()).toBe(daysAgo(366).getTime());
  });
});
