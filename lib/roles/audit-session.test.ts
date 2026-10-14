import { describe, expect, it } from "vitest";
import { AUDIT_SESSION_MS, isEmptyAudit, isSameSession, mergeRoleAuditSession } from "./audit-session";

describe("mergeRoleAuditSession", () => {
  it("la primera vez arranca la fila con lo agregado y quitado", () => {
    const m = mergeRoleAuditSession(null, "r1", "Closer", { addedKeys: ["contacts.view"], removedKeys: [] });
    expect(m).toMatchObject({ kind: "role_updated", role_id: "r1", name: "Closer", added_keys: ["contacts.view"], removed_keys: [], changes: 1 });
  });

  it("suma los cambios de la misma sesion en UNA fila", () => {
    let m = mergeRoleAuditSession(null, "r1", "Closer", { addedKeys: ["a.view"], removedKeys: [] });
    m = mergeRoleAuditSession(m, "r1", "Closer", { addedKeys: ["b.view"], removedKeys: ["c.view"] });
    m = mergeRoleAuditSession(m, "r1", "Closer", { addedKeys: [], removedKeys: [], scopes: { leads: "all" } });
    expect(m).toMatchObject({ added_keys: ["a.view", "b.view"], removed_keys: ["c.view"], scopes: { leads: "all" }, changes: 3 });
  });

  it("una clave que se agrega y se quita en la misma sesion se cancela", () => {
    let m = mergeRoleAuditSession(null, "r1", "Closer", { addedKeys: ["a.view"], removedKeys: [] });
    m = mergeRoleAuditSession(m, "r1", "Closer", { addedKeys: [], removedKeys: ["a.view"] });
    expect(m.added_keys).toEqual([]);
    expect(m.removed_keys).toEqual([]);
    expect(isEmptyAudit(m, "Closer")).toBe(true);
  });

  it("una clave quitada y vuelta a poner tambien se cancela", () => {
    let m = mergeRoleAuditSession(null, "r1", "Closer", { addedKeys: [], removedKeys: ["a.view"] });
    m = mergeRoleAuditSession(m, "r1", "Closer", { addedKeys: ["a.view"], removedKeys: [] });
    expect(m.removed_keys).toEqual([]);
  });

  it("registra el nombre nuevo", () => {
    const m = mergeRoleAuditSession(null, "r1", "Closer", { addedKeys: [], removedKeys: [], renamedTo: "Closer senior" });
    expect(m.name).toBe("Closer senior");
    expect(isEmptyAudit(m, "Closer")).toBe(false);
  });
});

describe("isSameSession", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const prev = (minutesAgo: number, over: Record<string, unknown> = {}) => ({
    performedAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
    performedBy: "u1",
    metadata: { role_id: "r1" },
    ...over,
  });

  it("dentro de los 10 minutos, misma persona y mismo rol: es la misma sesion", () => {
    expect(isSameSession(prev(9), now, "u1", "r1")).toBe(true);
  });
  it("pasados los 10 minutos abre una fila nueva", () => {
    expect(isSameSession(prev(11), now, "u1", "r1")).toBe(false);
    expect(AUDIT_SESSION_MS).toBe(600_000);
  });
  it("otra persona u otro rol: otra sesion", () => {
    expect(isSameSession(prev(1), now, "u2", "r1")).toBe(false);
    expect(isSameSession(prev(1), now, "u1", "r2")).toBe(false);
    expect(isSameSession(null, now, "u1", "r1")).toBe(false);
  });
});
