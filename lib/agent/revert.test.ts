import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "./testing/memory-db";
import { applyRevert, invertedChanges, planRevert, type AuditEntry } from "./revert";

/**
 * Revertir una accion del agente deshace exactamente lo que quedo en el audit
 * y deja su propia entrada (quien, cuando, sobre que).
 */

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const base = (over: Partial<AuditEntry>): AuditEntry => ({
  id: "a-1",
  workspace_id: "ws-1",
  entity_type: "contact",
  entity_id: "c-1",
  action: "tag",
  changes: null,
  metadata: null,
  performed_by_agent_id: "agent-1",
  reverted_at: null,
  ...over,
});

describe("planRevert", () => {
  it("etiquetas: vuelve al conjunto anterior", () => {
    const plan = planRevert(base({ action: "tag", changes: { tags: { old: "t-a", new: "t-a,t-b" } } }));
    expect(plan).toEqual({ kind: "tags", contactId: "c-1", add: [], remove: ["t-b"] });
    const quitado = planRevert(base({ action: "tag", changes: { tags: { old: "t-a", new: null } } }));
    expect(quitado).toEqual({ kind: "tags", contactId: "c-1", add: ["t-a"], remove: [] });
  });

  it("temperatura, seguimiento y resumen vuelven al valor viejo", () => {
    expect(planRevert(base({ action: "temperature", changes: { lead_temperature: { old: "warm", new: "hot" } } }))).toEqual({ kind: "contact", contactId: "c-1", patch: { lead_temperature: "warm" } });
    expect(planRevert(base({ action: "followup", changes: { next_followup_date: { old: null, new: "2026-10-01" } } }))).toEqual({ kind: "contact", contactId: "c-1", patch: { next_followup_date: null } });
    expect(planRevert(base({ action: "summary", changes: { ai_conversation_summary: { old: "antes", new: "despues" } } }))).toEqual({ kind: "contact", contactId: "c-1", patch: { ai_conversation_summary: "antes" } });
  });

  it("asignacion, derivacion y pausa sobre la conversacion", () => {
    expect(planRevert(base({ entity_type: "conversation", entity_id: "cv-1", action: "assign", changes: { assigned_to: { old: null, new: "u-1" } } }))).toEqual({ kind: "conversation", conversationId: "cv-1", patch: { assigned_to: null } });
    expect(
      planRevert(base({ entity_type: "conversation", entity_id: "cv-1", action: "human_takeover", changes: { agent_enabled: { old: null, new: false }, is_automation_paused: { old: false, new: true } } })),
    ).toEqual({ kind: "conversation", conversationId: "cv-1", patch: { agent_enabled: null, is_automation_paused: false } });
    expect(planRevert(base({ entity_type: "conversation", entity_id: "cv-1", action: "agent_paused", changes: { agent_paused_until: { old: null, new: "infinity" } } }))).toEqual({ kind: "conversation", conversationId: "cv-1", patch: { agent_paused_until: null } });
  });

  it("no se revierte lo que no hizo el agente, ni lo ya revertido, ni lo que no tiene inverso", () => {
    expect(planRevert(base({ performed_by_agent_id: null, changes: { tags: { old: null, new: "t" } } }))).toBeNull();
    expect(planRevert(base({ reverted_at: "2026-09-24T00:00:00Z", changes: { tags: { old: null, new: "t" } } }))).toBeNull();
    expect(planRevert(base({ action: "create" }))).toBeNull();
  });

  it("invertedChanges da vuelta el antes/despues", () => {
    expect(invertedChanges(base({ changes: { lead_temperature: { old: "cold", new: "hot" } } }))).toEqual({ lead_temperature: { old: "hot", new: "cold" } });
  });
});

describe("applyRevert", () => {
  it("deshace la etiqueta y deja la entrada revert firmada por quien revirtio", async () => {
    const db = memoryDb({
      tags: [{ id: "t-b", workspace_id: "ws-1", name: "B" }],
      contact_tags: [{ contact_id: "c-1", tag_id: "t-a" }, { contact_id: "c-1", tag_id: "t-b" }],
      audit_log: [],
    });
    const entry = base({ changes: { tags: { old: "t-a", new: "t-a,t-b" } } });

    const r = await applyRevert(db.client, entry, { userId: "u-1" });

    expect(r.ok).toBe(true);
    expect(db.rows("contact_tags").map((t) => t.tag_id)).toEqual(["t-a"]);
    expect(db.rows("audit_log")[0]).toMatchObject({
      action: "revert",
      entity_type: "contact",
      entity_id: "c-1",
      performed_by: "u-1",
      performed_by_agent_id: null,
      changes: { tags: { old: "t-a,t-b", new: "t-a" } },
      metadata: { reverted_audit_id: "a-1", original_action: "tag" },
    });
  });

  it("vuelve la temperatura y el seguimiento al valor anterior", async () => {
    const db = memoryDb({ contacts: [{ id: "c-1", lead_temperature: "hot", next_followup_date: "2026-10-01" }], audit_log: [] });
    await applyRevert(db.client, base({ action: "temperature", changes: { lead_temperature: { old: "warm", new: "hot" } } }), { userId: "u-1" });
    await applyRevert(db.client, base({ id: "a-2", action: "followup", changes: { next_followup_date: { old: null, new: "2026-10-01" } } }), { userId: "u-1" });
    expect(db.rows("contacts")[0]).toMatchObject({ lead_temperature: "warm", next_followup_date: null });
    expect(db.rows("audit_log")).toHaveLength(2);
  });

  it("si la RLS no deja tocar la fila (no vuelve nada), falla sin auditar", async () => {
    const db = memoryDb({ contacts: [], audit_log: [] });
    const r = await applyRevert(db.client, base({ action: "temperature", changes: { lead_temperature: { old: "warm", new: "hot" } } }), { userId: "u-1" });
    expect(r.ok).toBe(false);
    expect(db.rows("audit_log")).toHaveLength(0);
  });
});
