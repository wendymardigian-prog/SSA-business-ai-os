import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb, type MemoryDb } from "../testing/memory-db";
import { allowedSetterStatuses, resolveSetterStatusRequest, setSetterStatus, type EffectContext } from "./effects";
import { setterStatusTool } from "./setter-status";
import { toAgentConfig } from "../config";
import { agentRow } from "../testing/fixtures";
import { planRevert, applyRevert, type AuditEntry } from "../revert";

/**
 * El agente mueve el estado de SETTER (pipeline, 00245): solo a los estados de
 * su lista blanca que sigan activos, nunca pisa por defecto uno que puso una
 * persona, y lo que hace se puede deshacer desde Acciones.
 */

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const SETTINGS = {
  setter: [
    { key: "contactado", name: "Contactado", color: "#2563eb", archived_at: null },
    { key: "en_conversacion", name: "En conversación", color: "#0891b2", archived_at: null },
    { key: "calificado", name: "Calificado", color: "#16a34a", archived_at: null },
    { key: "viejo", name: "Viejo", color: "#78716c", archived_at: "2026-01-01T00:00:00Z" },
  ],
  closer: [],
};

/** Una gemela chica de `set_contact_status`: lo que importa acá es qué le pide el efecto y qué hace con la respuesta. */
function fakeSetContactStatus(args: Record<string, unknown>, db: MemoryDb) {
  const contact = db.tables.contacts.find((c) => c.id === args.p_contact_id && c.workspace_id === args.p_workspace_id);
  if (!contact) return { result: "not_found" };
  const old = (contact.setter_status as string | null) ?? null;
  const status = (args.p_status as string | null) ?? null;
  if (old === status) return { result: "unchanged", old_status: old, new_status: status };
  if (args.p_respect_human && old && !contact.setter_status_by_agent) return { result: "protected", old_status: old, new_status: status };
  contact.setter_status = status;
  contact.setter_status_by_agent = Boolean(status && args.p_actor_agent);
  return { result: "changed", old_status: old, new_status: status, last_status_role: status ? "setter" : null, last_status: status, last_status_at: status ? "2026-10-21T12:00:00Z" : null, change_id: "chg-1" };
}

function world(contact: Record<string, unknown> = {}) {
  return memoryDb(
    {
      workspaces: [{ id: "ws-1", contact_status_settings: SETTINGS }],
      contacts: [{ id: "c-1", workspace_id: "ws-1", setter_status: null, setter_status_by_agent: false, ...contact }],
      audit_log: [],
    },
    { rpc: { set_contact_status: (args, db) => ({ ...fakeSetContactStatus(args, db) }) } },
  );
}

function ctxFor(db: MemoryDb): EffectContext {
  return { supabase: db.client, workspaceId: "ws-1", agentId: "agent-1", runId: "run-1", conversationId: "cv-1", contactId: "c-1", channelId: "ch-1", origin: "tool" };
}

describe("la lista blanca", () => {
  it("solo los permitidos que siguen activos", () => {
    expect(allowedSetterStatuses(SETTINGS.setter, ["calificado", "viejo", "no_existe"]).map((s) => s.key)).toEqual(["calificado"]);
  });

  it("el modelo puede pedir por nombre (sin tildes ni mayúsculas) o por clave", () => {
    const allowed = allowedSetterStatuses(SETTINGS.setter, ["en_conversacion", "calificado"]);
    expect(resolveSetterStatusRequest(allowed, "en conversacion")?.key).toBe("en_conversacion");
    expect(resolveSetterStatusRequest(allowed, "CALIFICADO")?.key).toBe("calificado");
    expect(resolveSetterStatusRequest(allowed, "calificado")?.key).toBe("calificado");
    expect(resolveSetterStatusRequest(allowed, "Contactado")).toBeNull();
  });
});

describe("setSetterStatus", () => {
  const config = { allowedStatuses: ["en_conversacion", "calificado"], canOverrideHuman: false };

  it("cambia el estado con el agente como autor y deja su entrada en Acciones", async () => {
    const db = world();
    const result = await setSetterStatus(ctxFor(db), config, { status: "Calificado", reason: "Tiene presupuesto" });
    expect(result.ok).toBe(true);
    expect(db.rpcCalls[0]).toMatchObject({
      name: "set_contact_status",
      args: { p_role: "setter", p_status: "calificado", p_actor_agent: "agent-1", p_reason: "Tiene presupuesto", p_respect_human: true },
    });
    const audit = db.rows("audit_log")[0];
    expect(audit).toMatchObject({ action: "setter_status", performed_by_agent_id: "agent-1", changes: { setter_status: { old: null, new: "calificado" } } });
  });

  it("un estado fuera de la lista no se aplica, y le dice al modelo cuáles puede usar", async () => {
    const db = world();
    const result = await setSetterStatus(ctxFor(db), config, { status: "Contactado" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("En conversación, Calificado");
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("no pisa un estado que puso una persona", async () => {
    const db = world({ setter_status: "contactado", setter_status_by_agent: false });
    const result = await setSetterStatus(ctxFor(db), config, { status: "calificado" });
    expect(result.ok).toBe(false);
    expect(db.rows("contacts")[0].setter_status).toBe("contactado");
    expect(db.rows("audit_log")).toHaveLength(0);
  });

  it("con permiso para pisarlo, sí", async () => {
    const db = world({ setter_status: "contactado", setter_status_by_agent: false });
    const result = await setSetterStatus(ctxFor(db), { ...config, canOverrideHuman: true }, { status: "calificado" });
    expect(result.ok).toBe(true);
    expect(db.rows("contacts")[0].setter_status).toBe("calificado");
  });

  it("el mismo estado: no hace nada ni deja entrada", async () => {
    const db = world({ setter_status: "calificado", setter_status_by_agent: true });
    const result = await setSetterStatus(ctxFor(db), config, { status: "calificado" });
    expect(result.ok).toBe(true);
    expect(db.rows("audit_log")).toHaveLength(0);
  });
});

describe("la herramienta", () => {
  it("sin estados permitidos no existe para el modelo", () => {
    expect(setterStatusTool.isAvailable?.(toAgentConfig(agentRow({ tools_config: {} })))).toBe(false);
    expect(setterStatusTool.isAvailable?.(toAgentConfig(agentRow({ tools_config: { cambiar_estado_setter: { allowedStatuses: ["calificado"] } } })))).toBe(true);
  });

  it("por defecto no puede pisar a una persona", () => {
    expect(setterStatusTool.configSchema.parse({})).toEqual({ allowedStatuses: [], canOverrideHuman: false });
  });
});

describe("deshacer", () => {
  const entry: AuditEntry = {
    id: "a-1", workspace_id: "ws-1", entity_type: "contact", entity_id: "c-1", action: "setter_status",
    changes: { setter_status: { old: "contactado", new: "calificado" } }, metadata: null, performed_by_agent_id: "agent-1", reverted_at: null,
  };

  it("vuelve al estado anterior", () => {
    expect(planRevert(entry)).toEqual({ kind: "setter_status", contactId: "c-1", status: "contactado" });
    expect(planRevert({ ...entry, changes: { setter_status: { old: null, new: "calificado" } } })).toEqual({ kind: "setter_status", contactId: "c-1", status: null });
  });

  it("pasa por set_contact_status con la persona que revierte como autora", async () => {
    const db = world({ setter_status: "calificado", setter_status_by_agent: true });
    const result = await applyRevert(db.client, entry, { userId: "u-1", service: db.client });
    expect(result.ok).toBe(true);
    expect(db.rpcCalls.at(-1)).toMatchObject({ name: "set_contact_status", args: { p_status: "contactado", p_actor_user: "u-1", p_actor_agent: null } });
    expect(db.rows("contacts")[0].setter_status).toBe("contactado");
  });
});
