import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { applyAuditFilters, auditFilters, entityHref } from "./audit-query";
import { buildHistoryQuery, runHistoryQuery } from "./audit-history";

describe("auditFilters", () => {
  it("sin nada, sin filtros", () => {
    expect(auditFilters({})).toEqual([]);
  });
  it("cada filtro pasa por la función compartida", () => {
    expect(auditFilters({ entityType: "sale" })).toEqual([{ column: "entity_type", op: "eq", value: "sale" }]);
    expect(auditFilters({ entityId: "e1" })).toEqual([{ column: "entity_id", op: "eq", value: "e1" }]);
    expect(auditFilters({ actorType: "system" })).toEqual([{ column: "actor_type", op: "eq", value: "system" }]);
    expect(auditFilters({ performedBy: "u1" })).toEqual([{ column: "performed_by", op: "eq", value: "u1" }]);
    expect(auditFilters({ fromIso: "2026-10-01T06:00:00Z", toIso: "2026-10-08T06:00:00Z" })).toEqual([{ column: "performed_at", op: "gte", value: "2026-10-01T06:00:00Z" }, { column: "performed_at", op: "lt", value: "2026-10-08T06:00:00Z" }]);
    expect(auditFilters({ actorLabel: "Job de mora" })).toEqual([{ column: "actor_label", op: "ilike", value: "%Job de mora%" }]);
    expect(auditFilters({ cursor: "2026-10-05T00:00:00Z" })).toEqual([{ column: "performed_at", op: "lt", value: "2026-10-05T00:00:00Z" }]);
  });
  it("una acción exacta filtra por igualdad; una parte, por prefijo", () => {
    expect(auditFilters({ action: "sale.created" })).toEqual([{ column: "action", op: "eq", value: "sale.created" }]);
    expect(auditFilters({ action: "sale." })).toEqual([{ column: "action", op: "ilike", value: "sale.%" }]);
    expect(auditFilters({ action: "pay" })).toEqual([{ column: "action", op: "ilike", value: "pay%" }]);
  });
  it("un tipo de actor desconocido se ignora y los comodines del texto no se cuelan", () => {
    expect(auditFilters({ actorType: "inventado" as never })).toEqual([]);
    expect(auditFilters({ actorLabel: "a%b_c" })[0].value).toBe("%a b c%");
  });
});

describe("el historial de una entidad sigue haciendo lo mismo", () => {
  const rows = [
    { id: "1", entity_type: "sale", entity_id: "s1", action: "sale.created", performed_at: "2026-10-03T10:00:00Z", performed_by: "u1", actor_type: "user" },
    { id: "2", entity_type: "sale", entity_id: "s1", action: "sale.updated", performed_at: "2026-10-02T10:00:00Z", performed_by: "u1", actor_type: "user" },
    { id: "3", entity_type: "sale", entity_id: "s2", action: "sale.created", performed_at: "2026-10-04T10:00:00Z", performed_by: "u1", actor_type: "user" },
    { id: "4", entity_type: "payment", entity_id: "s1", action: "payment.paid", performed_at: "2026-10-05T10:00:00Z", performed_by: null, actor_type: "system" },
  ];
  it("trae solo la entidad pedida, de la más nueva a la más vieja, con su cursor", async () => {
    const db = memoryDb({ audit_log: rows });
    const first = await runHistoryQuery(db.client as never, buildHistoryQuery({ entityType: "sale", entityId: "s1", pageSize: 1 }));
    expect(first.ok && first.page.rows.map((r) => r.id)).toEqual(["1"]);
    expect(first.ok && first.page.nextCursor).toBe("2026-10-03T10:00:00Z");
    const second = await runHistoryQuery(db.client as never, buildHistoryQuery({ entityType: "sale", entityId: "s1", cursor: "2026-10-03T10:00:00Z", pageSize: 1 }));
    expect(second.ok && second.page.rows.map((r) => r.id)).toEqual(["2"]);
    expect(second.ok && second.page.nextCursor).toBeNull();
  });
  it("applyAuditFilters aplica los filtros a una consulta real", async () => {
    const db = memoryDb({ audit_log: rows });
    const { data } = await applyAuditFilters(db.client.from("audit_log").select("id") as never, auditFilters({ actorType: "system" })) as unknown as { data: Array<{ id: string }> };
    expect(data.map((r) => r.id)).toEqual(["4"]);
  });
});

describe("entityHref", () => {
  it("lleva a la entidad cuando tiene pantalla; el pago, a su venta", () => {
    expect(entityHref("sale", "s1")).toBe("/dashboard/ventas/s1");
    expect(entityHref("payment", "p1", { sale_id: "s9" })).toBe("/dashboard/ventas/s9");
    expect(entityHref("payment", "p1", {})).toBeNull();
    expect(entityHref("contact", "c1")).toBe("/dashboard/contacts/c1");
    expect(entityHref("product", "x")).toBe("/dashboard/settings/productos/x");
    expect(entityHref("tag", "t")).toBeNull();
  });
});
