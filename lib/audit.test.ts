import { describe, it, expect, vi } from "vitest";
import { diffFields } from "./audit";

describe("diffFields", () => {
  it("registra solo lo que cambio", () => {
    const changes = diffFields(
      { display_name: "Juan", phone: null, country: "AR" },
      { display_name: "Juan Perez", phone: "+5491122334455", country: "AR" },
    );

    expect(changes).toEqual({
      display_name: { old: "Juan", new: "Juan Perez" },
      phone: { old: null, new: "+5491122334455" },
    });
  });

  it("devuelve null cuando no cambio nada, para no ensuciar el historial", () => {
    expect(diffFields({ display_name: "Juan" }, { display_name: "Juan" })).toBeNull();
    expect(diffFields({}, {})).toBeNull();
  });

  it("trata null, undefined y vacio como el mismo estado", () => {
    expect(diffFields({ phone: null }, { phone: "" })).toBeNull();
    expect(diffFields({ phone: undefined }, { phone: null })).toBeNull();
    expect(diffFields({ phone: "" }, { phone: "+5491122334455" })).toEqual({
      phone: { old: null, new: "+5491122334455" },
    });
  });

  it("ignora los campos que el update no toco", () => {
    const changes = diffFields(
      { display_name: "Juan", email: "juan@example.com" },
      { display_name: "Ana" },
    );
    expect(changes).toEqual({ display_name: { old: "Juan", new: "Ana" } });
  });

  it("conserva los booleanos como booleanos", () => {
    expect(diffFields({ do_not_contact: false }, { do_not_contact: true })).toEqual({
      do_not_contact: { old: false, new: true },
    });
  });
});

// Caracterizacion de logAudit (Llamadas, §4.3): la fila que inserta con la
// firma de siempre. Llamadas le suma actor_type/actor_label sin romper esto.
import { logAudit, auditAsSystem, auditAsWebhook, inferActorType } from "./audit";

function fakeAuditClient(result: { data?: { id: string } | null; error?: { message: string } | null } = { data: { id: "audit-1" }, error: null }) {
  const rows: Array<Record<string, unknown>> = [];
  const client = {
    from: (table: string) => {
      expect(table).toBe("audit_log");
      return {
        insert: (row: Record<string, unknown>) => {
          rows.push(row);
          return { select: () => ({ single: async () => result }) };
        },
      };
    },
  };
  return { client: client as never, rows };
}

describe("logAudit (firma de siempre)", () => {
  it("inserta la fila con los campos de siempre y devuelve el id", async () => {
    const { client, rows } = fakeAuditClient();
    const id = await logAudit({
      supabase: client,
      workspaceId: "ws-1",
      entityType: "contact",
      entityId: "c-1",
      action: "update",
      changes: { phone: { old: null, new: "+54" } },
      metadata: { origin: "test" },
      performedBy: "u-1",
    });
    expect(id).toBe("audit-1");
    expect(rows[0]).toMatchObject({
      workspace_id: "ws-1",
      entity_type: "contact",
      entity_id: "c-1",
      action: "update",
      changes: { phone: { old: null, new: "+54" } },
      metadata: { origin: "test" },
      performed_by: "u-1",
      performed_by_agent_id: null,
    });
  });

  it("si el insert falla devuelve null y no lanza", async () => {
    const { client } = fakeAuditClient({ data: null, error: { message: "rls" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = await logAudit({ supabase: client, workspaceId: "ws-1", entityType: "contact", entityId: "c-1", action: "update" });
    expect(id).toBeNull();
    spy.mockRestore();
  });
});

describe("logAudit: el actor (00144)", () => {
  it("con performedByAgentId la fila queda como agent", async () => {
    const { client, rows } = fakeAuditClient();
    await logAudit({ supabase: client, workspaceId: "ws-1", entityType: "contact", entityId: "c-1", action: "tag", performedByAgentId: "ag-1" });
    expect(rows[0]).toMatchObject({ actor_type: "agent", actor_label: null, performed_by: null });
  });

  it("sin persona ni agente queda como system", async () => {
    const { client, rows } = fakeAuditClient();
    await logAudit({ supabase: client, workspaceId: "ws-1", entityType: "contact", entityId: "c-1", action: "update" });
    expect(rows[0]).toMatchObject({ actor_type: "system" });
  });

  it("con una persona queda como user", async () => {
    const { client, rows } = fakeAuditClient();
    await logAudit({ supabase: client, workspaceId: "ws-1", entityType: "contact", entityId: "c-1", action: "update", performedBy: "u-1" });
    expect(rows[0]).toMatchObject({ actor_type: "user" });
  });

  it("auditAsSystem guarda tipo system, la etiqueta y performed_by null", async () => {
    const { client, rows } = fakeAuditClient();
    await auditAsSystem({ supabase: client, workspaceId: "ws-1", entityType: "call", entityId: "x", action: "call.analyzed", label: "Análisis automático" });
    expect(rows[0]).toMatchObject({ actor_type: "system", actor_label: "Análisis automático", performed_by: null });
  });

  it("auditAsWebhook guarda tipo webhook y la etiqueta", async () => {
    const { client, rows } = fakeAuditClient();
    await auditAsWebhook({ supabase: client, workspaceId: "ws-1", entityType: "call", entityId: "x", action: "call.ingested", label: "Fathom" });
    expect(rows[0]).toMatchObject({ actor_type: "webhook", actor_label: "Fathom" });
  });

  it("inferActorType da prioridad al agente", () => {
    expect(inferActorType("u-1", "ag-1")).toBe("agent");
    expect(inferActorType(null, null)).toBe("system");
    expect(inferActorType("u-1", null)).toBe("user");
  });
});
