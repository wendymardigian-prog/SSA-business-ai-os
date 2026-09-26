import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "../testing/memory-db";
import {
  applyTags,
  assignConversation,
  isFollowupManual,
  pauseAgentInConversation,
  setFollowup,
  setTemperature,
  type EffectContext,
} from "./effects";

/**
 * Los efectos de negocio del agente respetan su configuracion, y cada uno deja
 * su entrada en audit_log con el agente como actor.
 */

const NOW = new Date("2026-09-24T12:00:00.000Z");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function world(seed: Record<string, Record<string, unknown>[]> = {}) {
  return memoryDb({
    tags: [
      { id: "t-interesado", workspace_id: "ws-1", name: "Interesado" },
      { id: "t-cliente", workspace_id: "ws-1", name: "Cliente" },
      { id: "t-vip", workspace_id: "ws-1", name: "VIP" },
    ],
    contact_tags: [],
    contacts: [{ id: "c-1", workspace_id: "ws-1", lead_temperature: null, next_followup_date: null, setter_id: null }],
    conversations: [{ id: "cv-1", workspace_id: "ws-1", assigned_to: null, agent_paused_until: null }],
    workspace_members: [
      { workspace_id: "ws-1", user_id: "u-1", role: "member" },
      { workspace_id: "ws-1", user_id: "u-2", role: "member" },
    ],
    audit_log: [],
    ...seed,
  });
}

function ctxFor(db: ReturnType<typeof memoryDb>, over: Partial<EffectContext> = {}): EffectContext {
  return {
    supabase: db.client,
    workspaceId: "ws-1",
    agentId: "agent-1",
    runId: "run-1",
    conversationId: "cv-1",
    contactId: "c-1",
    channelId: "ch-1",
    origin: "tool",
    ...over,
  };
}

describe("etiquetar: solo la lista blanca, nunca crea", () => {
  it("nunca aplica una etiqueta con efecto sobre el agente, aunque una config vieja la tenga en la lista (00073)", async () => {
    const db = world({
      tags: [
        { id: "t-conocido", workspace_id: "ws-1", name: "es-conocido", disables_agent: true, assigns_to: null },
        { id: "t-asigna", workspace_id: "ws-1", name: "vip-wendy", disables_agent: false, assigns_to: "u-1" },
        { id: "t-interesado", workspace_id: "ws-1", name: "Interesado", disables_agent: false, assigns_to: null },
      ],
    });
    const r = await applyTags(
      ctxFor(db),
      { allowedTagIds: ["t-conocido", "t-asigna", "t-interesado"], canRemove: false },
      { add: ["es-conocido", "vip-wendy", "Interesado"], remove: [] },
    );
    expect(db.rows("contact_tags").map((t) => t.tag_id)).toEqual(["t-interesado"]);
    expect(r.message).toContain("es-conocido");
  });

  it("agrega un tag permitido y lo audita con el agente como actor", async () => {
    const db = world();
    const r = await applyTags(ctxFor(db), { allowedTagIds: ["t-interesado"], canRemove: false }, { add: ["interesado"], remove: [] });

    expect(r.ok).toBe(true);
    expect(db.rows("contact_tags").map((t) => t.tag_id)).toEqual(["t-interesado"]);
    expect(db.rows("audit_log")[0]).toMatchObject({
      action: "tag",
      entity_type: "contact",
      entity_id: "c-1",
      performed_by_agent_id: "agent-1",
      performed_by: null,
      changes: { tags: { old: null, new: "t-interesado" } },
    });
    expect((db.rows("audit_log")[0].metadata as Record<string, unknown>)).toMatchObject({ origin: "tool", run_id: "run-1", channel_id: "ch-1" });
  });

  it("un tag que existe pero NO esta en la lista blanca no se aplica, y el modelo se entera", async () => {
    const db = world();
    const r = await applyTags(ctxFor(db), { allowedTagIds: ["t-interesado"], canRemove: false }, { add: ["VIP"], remove: [] });

    expect(r.ok).toBe(false);
    expect(r.message).toContain("no estan en la lista permitida");
    expect(db.rows("contact_tags")).toHaveLength(0);
    expect(db.rows("audit_log")).toHaveLength(0);
  });

  it("un nombre inventado no crea ningun tag", async () => {
    const db = world();
    await applyTags(ctxFor(db), { allowedTagIds: ["t-interesado", "t-cliente"], canRemove: false }, { add: ["Fanatico"], remove: [] });
    expect(db.rows("tags")).toHaveLength(3);
    expect(db.rows("contact_tags")).toHaveLength(0);
  });

  it("sin permiso para quitar, no quita", async () => {
    const db = world({ contact_tags: [{ contact_id: "c-1", tag_id: "t-cliente" }] });
    const r = await applyTags(ctxFor(db), { allowedTagIds: ["t-cliente"], canRemove: false }, { add: [], remove: ["Cliente"] });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("no tenes permitido quitar");
    expect(db.rows("contact_tags")).toHaveLength(1);
  });

  it("con permiso, quita y audita el antes/despues", async () => {
    const db = world({ contact_tags: [{ contact_id: "c-1", tag_id: "t-cliente" }] });
    const r = await applyTags(ctxFor(db), { allowedTagIds: ["t-cliente"], canRemove: true }, { add: [], remove: ["cliente"] });
    expect(r.ok).toBe(true);
    expect(db.rows("contact_tags")).toHaveLength(0);
    expect(db.rows("audit_log")[0].changes).toEqual({ tags: { old: "t-cliente", new: null } });
  });

  it("con la lista blanca vacia no hace nada", async () => {
    const db = world();
    const r = await applyTags(ctxFor(db), { allowedTagIds: [], canRemove: true }, { add: ["Interesado"], remove: [] });
    expect(r.ok).toBe(false);
    expect(db.rows("contact_tags")).toHaveLength(0);
  });
});

describe("temperatura", () => {
  it("sube de frio a caliente y lo audita", async () => {
    const db = world({ contacts: [{ id: "c-1", workspace_id: "ws-1", lead_temperature: "cold", next_followup_date: null }] });
    const r = await setTemperature(ctxFor(db), { canLower: false }, { temperature: "hot" });
    expect(r.ok).toBe(true);
    expect(db.rows("contacts")[0].lead_temperature).toBe("hot");
    expect(db.rows("audit_log")[0]).toMatchObject({ action: "temperature", changes: { lead_temperature: { old: "cold", new: "hot" } } });
  });

  it("sin permiso, no la baja", async () => {
    const db = world({ contacts: [{ id: "c-1", workspace_id: "ws-1", lead_temperature: "hot", next_followup_date: null }] });
    const r = await setTemperature(ctxFor(db), { canLower: false }, { temperature: "warm" });
    expect(r.ok).toBe(false);
    expect(db.rows("contacts")[0].lead_temperature).toBe("hot");
    expect(db.rows("audit_log")).toHaveLength(0);
  });

  it("con permiso, la baja", async () => {
    const db = world({ contacts: [{ id: "c-1", workspace_id: "ws-1", lead_temperature: "hot", next_followup_date: null }] });
    const r = await setTemperature(ctxFor(db), { canLower: true }, { temperature: "cold" });
    expect(r.ok).toBe(true);
    expect(db.rows("contacts")[0].lead_temperature).toBe("cold");
  });
});

describe("seguimiento", () => {
  it("dentro del maximo: guarda la fecha y audita", async () => {
    const db = world();
    const r = await setFollowup(ctxFor(db), { maxDaysAhead: 90, canOverrideManual: false }, { days: 7, now: NOW });
    expect(r.ok).toBe(true);
    expect(db.rows("contacts")[0].next_followup_date).toBe("2026-10-01T12:00:00.000Z");
    expect(db.rows("audit_log")[0]).toMatchObject({ action: "followup" });
  });

  it("mas alla del maximo de dias: rechaza", async () => {
    const db = world();
    const r = await setFollowup(ctxFor(db), { maxDaysAhead: 30, canOverrideManual: false }, { days: 45, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("30 dias");
    expect(db.rows("contacts")[0].next_followup_date).toBeNull();
  });

  it("una fecha puesta a mano por una persona no se pisa sin permiso", async () => {
    const db = world({
      contacts: [{ id: "c-1", workspace_id: "ws-1", lead_temperature: null, next_followup_date: "2026-10-15T12:00:00.000Z" }],
      audit_log: [
        {
          id: "a-1",
          workspace_id: "ws-1",
          entity_type: "contact",
          entity_id: "c-1",
          action: "update",
          changes: { next_followup_date: { old: null, new: "2026-10-15T12:00:00.000Z" } },
          performed_by: "u-1",
          performed_by_agent_id: null,
          performed_at: "2026-09-20T10:00:00.000Z",
        },
      ],
    });
    expect(await isFollowupManual(db.client, "c-1")).toBe(true);
    const r = await setFollowup(ctxFor(db), { maxDaysAhead: 90, canOverrideManual: false }, { days: 3, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("puesta por una persona");
    expect(db.rows("contacts")[0].next_followup_date).toBe("2026-10-15T12:00:00.000Z");
  });

  it("una fecha que puso el propio agente si se puede mover", async () => {
    const db = world({
      contacts: [{ id: "c-1", workspace_id: "ws-1", lead_temperature: null, next_followup_date: "2026-10-15T12:00:00.000Z" }],
      audit_log: [
        {
          id: "a-1",
          workspace_id: "ws-1",
          entity_type: "contact",
          entity_id: "c-1",
          action: "followup",
          changes: { next_followup_date: { old: null, new: "2026-10-15T12:00:00.000Z" } },
          performed_by: null,
          performed_by_agent_id: "agent-1",
          performed_at: "2026-09-20T10:00:00.000Z",
        },
      ],
    });
    expect(await isFollowupManual(db.client, "c-1")).toBe(false);
    const r = await setFollowup(ctxFor(db), { maxDaysAhead: 90, canOverrideManual: false }, { days: 3, now: NOW });
    expect(r.ok).toBe(true);
  });

  it("acepta una fecha concreta", async () => {
    const db = world();
    const r = await setFollowup(ctxFor(db), { maxDaysAhead: 90, canOverrideManual: false }, { date: "2026-10-10", now: NOW });
    expect(r.ok).toBe(true);
    expect(String(db.rows("contacts")[0].next_followup_date)).toContain("2026-10-10");
  });
});

describe("asignar", () => {
  it("usuario fijo habilitado: asigna y audita", async () => {
    const db = world();
    const r = await assignConversation(ctxFor(db), { allowedUserIds: ["u-1"], strategy: "fixed", fixedUserId: "u-1" }, {});
    expect(r.ok).toBe(true);
    expect(db.rows("conversations")[0].assigned_to).toBe("u-1");
    expect(db.rows("audit_log")[0]).toMatchObject({ action: "assign", entity_type: "conversation", changes: { assigned_to: { old: null, new: "u-1" } } });
  });

  it("nunca asigna a alguien fuera de la lista ni a quien no es miembro", async () => {
    const db = world();
    const r = await assignConversation(ctxFor(db), { allowedUserIds: ["u-9"], strategy: "round_robin", fixedUserId: null }, {});
    expect(r.ok).toBe(false);
    expect(db.rows("conversations")[0].assigned_to).toBeNull();
  });

  it("round-robin: primero quien nunca recibio, despues el que hace mas que no recibe", async () => {
    const db = world({
      audit_log: [
        {
          id: "a-1", workspace_id: "ws-1", entity_type: "conversation", entity_id: "cv-0", action: "assign",
          changes: { assigned_to: { old: null, new: "u-1" } }, performed_by: null, performed_by_agent_id: "agent-1",
          performed_at: "2026-09-20T10:00:00.000Z",
        },
      ],
    });
    const config = { allowedUserIds: ["u-1", "u-2"], strategy: "round_robin" as const, fixedUserId: null };
    const r1 = await assignConversation(ctxFor(db), config, {});
    expect(r1.detail).toMatchObject({ assigned_to: "u-2" });

    // Ahora u-2 es el ultimo: le toca a u-1. (performed_at lo pone la base; aca se completa a mano.)
    for (const row of db.rows("audit_log")) row.performed_at ??= "2026-09-24T12:00:00.000Z";
    db.rows("conversations").push({ id: "cv-2", workspace_id: "ws-1", assigned_to: null, agent_paused_until: null });
    const r2 = await assignConversation(ctxFor(db, { conversationId: "cv-2" }), config, {});
    expect(r2.detail).toMatchObject({ assigned_to: "u-1" });
  });

  it("al setter del contacto, si es miembro", async () => {
    const db = world({ contacts: [{ id: "c-1", workspace_id: "ws-1", setter_id: "u-2", lead_temperature: null, next_followup_date: null }] });
    const r = await assignConversation(ctxFor(db), { allowedUserIds: [], strategy: "contact_setter", fixedUserId: null }, {});
    expect(r.ok).toBe(true);
    expect(db.rows("conversations")[0].assigned_to).toBe("u-2");
  });
});

describe("pausarse", () => {
  it("recorta al maximo permitido y se reanuda sola al vencer", async () => {
    const db = world();
    const r = await pauseAgentInConversation(ctxFor(db), { maxMinutes: 60, autoResume: true }, { minutes: 600, now: NOW });
    expect(r.ok).toBe(true);
    expect(db.rows("conversations")[0].agent_paused_until).toBe("2026-09-24T13:00:00.000Z");
    expect(r.message).toContain("maximo permitido es 60");
    expect(db.rows("audit_log")[0]).toMatchObject({ action: "agent_paused", performed_by_agent_id: "agent-1" });
  });

  it("sin reanudacion automatica queda hasta que alguien la levante", async () => {
    const db = world();
    await pauseAgentInConversation(ctxFor(db), { maxMinutes: 60, autoResume: false }, { minutes: 10, now: NOW });
    expect(db.rows("conversations")[0].agent_paused_until).toBe("infinity");
  });
});
