import { describe, expect, it } from "vitest";
import { manualSyncKey } from "./manual-sync";

describe("manualSyncKey", () => {
  it("dentro del mismo bloque de 10 minutos la clave es la misma", () => {
    const a = manualSyncKey("act_1", new Date("2026-10-13T09:00:01Z"));
    const b = manualSyncKey("act_1", new Date("2026-10-13T09:09:59Z"));
    expect(a).toBe(b);
  });
  it("en el bloque siguiente cambia, y cada cuenta tiene la suya", () => {
    expect(manualSyncKey("act_1", new Date("2026-10-13T09:00:00Z"))).not.toBe(manualSyncKey("act_1", new Date("2026-10-13T09:10:00Z")));
    expect(manualSyncKey("act_1", new Date("2026-10-13T09:00:00Z"))).not.toBe(manualSyncKey("act_2", new Date("2026-10-13T09:00:00Z")));
  });
});
