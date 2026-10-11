import { describe, expect, it } from "vitest";
import { actorName, buildHistoryQuery, describeChange, describeChanges, effectiveActorType, readableValue, runHistoryQuery } from "./audit-history";
import { fakeDb } from "@/lib/testing/fake-db";

describe("effectiveActorType", () => {
  it("una fila vieja con user y sin performed_by es del sistema", () => {
    expect(effectiveActorType({ actor_type: "user", performed_by: null, performed_by_agent_id: null })).toBe("system");
  });
  it("con agente es del agente, aunque diga user", () => {
    expect(effectiveActorType({ actor_type: "user", performed_by: null, performed_by_agent_id: "a" })).toBe("agent");
  });
  it("con una persona es user", () => {
    expect(effectiveActorType({ actor_type: "user", performed_by: "u", performed_by_agent_id: null })).toBe("user");
  });
  it("un webhook guardado se respeta", () => {
    expect(effectiveActorType({ actor_type: "webhook", performed_by: null, performed_by_agent_id: null })).toBe("webhook");
  });
});

describe("actorName", () => {
  it("prefiere la etiqueta del actor", () => {
    expect(actorName({ actor_type: "system", actor_label: "Análisis automático", performed_by: null, performed_by_agent_id: null })).toBe("Análisis automático");
  });
  it("usa el nombre del miembro", () => {
    expect(actorName({ actor_type: "user", actor_label: null, performed_by: "u1", performed_by_agent_id: null }, { users: { u1: "Ana" } })).toBe("Ana");
  });
  it("sin nombre conocido no inventa", () => {
    expect(actorName({ actor_type: "user", actor_label: null, performed_by: "u9", performed_by_agent_id: null })).toBe("Alguien del equipo");
  });
});

describe("describeChange", () => {
  it("devuelve campo, antes y despues legibles", () => {
    expect(describeChange("call", "contact_id", null, "abc")).toEqual({ field: "contact_id", label: "Contacto", before: "—", after: "abc" });
  });
  it("nunca devuelve un JSON crudo de mas de 200 caracteres", () => {
    const big = { a: "x".repeat(500) };
    const line = describeChange("call", "analysis", big, null);
    expect(line.before.length).toBeLessThanOrEqual(200);
  });
  it("resume listas y booleanos", () => {
    expect(readableValue(true)).toBe("Sí");
    expect(readableValue(["a", "b"])).toBe("a, b");
    expect(readableValue([{ a: 1 }, { a: 2 }])).toBe("2 elementos");
  });
  it("describeChanges ignora filas sin changes", () => {
    expect(describeChanges("call", null)).toEqual([]);
    expect(describeChanges("call", { title: { old: "A", new: "B" } })).toHaveLength(1);
  });
});

describe("buildHistoryQuery / runHistoryQuery", () => {
  it("pide una fila de mas para saber si hay otra pagina, con 20 por defecto", () => {
    const q = buildHistoryQuery({ entityType: "call", entityId: "c1" });
    expect(q).toMatchObject({ pageSize: 20, limit: 21, cursor: null });
  });
  it("acota el tamano de pagina", () => {
    expect(buildHistoryQuery({ entityType: "call", entityId: "c1", pageSize: 5000 }).pageSize).toBe(100);
  });
  it("devuelve la pagina y el cursor cuando hay mas", async () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({ id: String(i), action: "update", changes: null, metadata: null, performed_by: null, performed_by_agent_id: null, performed_at: `2026-10-${String(30 - i).padStart(2, "0")}T10:00:00Z` }));
    const db = fakeDb({ audit_log: { data: rows } });
    const r = await runHistoryQuery(db.client, buildHistoryQuery({ entityType: "call", entityId: "c1" }));
    expect(r.ok && r.page.rows).toHaveLength(20);
    expect(r.ok && r.page.nextCursor).toBe(rows[19].performed_at);
  });
  it("sin mas filas no hay cursor; con cursor filtra las anteriores", async () => {
    const db = fakeDb({ audit_log: { data: [] } });
    const r = await runHistoryQuery(db.client, buildHistoryQuery({ entityType: "call", entityId: "c1", cursor: "2026-10-01T00:00:00Z" }));
    expect(r.ok && r.page.nextCursor).toBeNull();
    expect(db.calls[0].filters.some((f) => f.method === "lt")).toBe(true);
  });
  it("un error de la base no se filtra al usuario", async () => {
    const db = fakeDb({ audit_log: { error: { message: "rls detail" } } });
    const r = await runHistoryQuery(db.client, buildHistoryQuery({ entityType: "call", entityId: "c1" }));
    expect(r).toEqual({ ok: false, error: "No pude leer el historial" });
  });
});
