// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import rules from "./access-rule.cases.json";
import picks from "./access.cases.json";
import { accessRowState, accessWindow, addMonths, pickEffective, untilReached, type AccessRow, type AccessWindowInput } from "./access";

describe("cuándo se abre una sección y hasta cuándo (casos compartidos con la base)", () => {
  for (const c of rules.window) it(c.name, () => expect(accessWindow(c.input as AccessWindowInput)).toEqual(c.expected));
  it("hay al menos 20 casos", () => expect(rules.window.length + rules.until.length).toBeGreaterThanOrEqual(20));
});

describe("qué hecho cierra un acceso (casos compartidos con la base)", () => {
  for (const c of rules.until) it(c.name, () => expect(untilReached(c.until, c.event as never)).toBe(c.expected));
});

describe("el acceso que vale (casos compartidos con la base)", () => {
  for (const c of picks.cases) it(c.name, () => expect(pickEffective(c.rows as AccessRow[], c.now)).toBe(c.expected));
});

describe("el estado de una fila de Accesos", () => {
  const base = { ends_at: null, revoked_at: null, suspended_overdue_at: null, suspended_pause_at: null };
  const now = "2026-11-08T12:00:00Z";
  it("los siete estados", () => {
    expect(accessRowState(null, now)).toBe("pending");
    expect(accessRowState(base, now)).toBe("active");
    expect(accessRowState({ ...base, ends_at: "2026-11-12T23:59:59Z" }, now)).toBe("expiring");
    expect(accessRowState({ ...base, ends_at: "2026-12-31T23:59:59Z" }, now)).toBe("active");
    expect(accessRowState({ ...base, ends_at: "2026-11-01T23:59:59Z" }, now)).toBe("expired");
    expect(accessRowState({ ...base, suspended_pause_at: now }, now)).toBe("suspended_pause");
    expect(accessRowState({ ...base, suspended_overdue_at: now }, now)).toBe("suspended_overdue");
    expect(accessRowState({ ...base, revoked_at: now, suspended_pause_at: now }, now)).toBe("revoked");
  });
  it("suma meses como la base", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2026-11-01", 12)).toBe("2027-11-01");
  });
});
