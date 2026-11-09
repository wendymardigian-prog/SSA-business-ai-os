// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { accessViewRows, pendingSections } from "./accesses-view";
import type { AccessListRow } from "./load";

const row = (over: Partial<AccessListRow> = {}): AccessListRow => ({
  id: "a1",
  section: "program",
  productId: "p1",
  startsAt: "2026-11-01T06:00:00Z",
  endsAt: "2027-01-31T05:59:59Z",
  untilType: "service",
  source: "service_start",
  reason: null,
  revokedAt: null,
  revokeReason: null,
  suspendedOverdueAt: null,
  suspendedPauseAt: null,
  ...over,
});

describe("la pestaña Accesos", () => {
  const now = "2026-11-08T12:00:00Z";
  it("arma cada fila con su estado y lo que se puede hacer", () => {
    const [r] = accessViewRows([row()], "p1", now, "America/Costa_Rica");
    expect(r).toMatchObject({ sectionLabel: "Programa", state: "active", stateLabel: "Vigente", from: "01/11/2026", until: "30/01/2027", sourceLabel: "Al empezar", canExtend: true, canRevoke: true, otherProgram: false });
  });
  it("una revocada dice por qué y no se toca", () => {
    const [r] = accessViewRows([row({ revokedAt: now, revokeReason: "until_reached" })], "p1", now, "UTC");
    expect(r.stateLabel).toBe("Revocado (llegó a su fin)");
    expect(r.canExtend).toBe(false);
    expect(r.canRevoke).toBe(false);
  });
  it("sin fin no se extiende; hasta completar el camino lo dice", () => {
    const [r] = accessViewRows([row({ endsAt: null, untilType: "phase_completed" })], "p2", now, "UTC");
    expect(r.until).toBe("Hasta que se complete el camino");
    expect(r.canExtend).toBe(false);
    expect(r.otherProgram).toBe(true);
  });
  it("las pendientes son las incluidas, prendidas y nunca abiertas", () => {
    const pending = pendingSections(
      [{ section: "program" }, { section: "assistant", opens: { type: "phase_completed", ref: "ph_aaaaa1" } }, { section: "community", included: false }, { section: "calendar" }],
      { calendar: false },
      [row()],
      "p1",
    );
    expect(pending).toEqual([{ section: "assistant", sectionLabel: "Asistente IA", opensLabel: "Al terminar una fase" }]);
  });
});
