import { describe, it, expect, vi, beforeEach } from "vitest";
import { saveResponseRules, saveResponseRulesDefault } from "./save";
import { memoryDb } from "../testing/memory-db";
import { defaultRulesTemplate } from "./template";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function db() {
  return memoryDb({ agents: [{ id: "agent-1", workspace_id: "ws-1", response_rules: [], response_rules_default: "draft" }], audit_log: [] });
}

describe("permisos de las reglas (F10)", () => {
  it("un Member (isAdmin=false) es rechazado", async () => {
    const m = db();
    const r = await saveResponseRules({ supabase: m.client, workspaceId: "ws-1", agentId: "agent-1", userId: "u-1", isAdmin: false, rules: defaultRulesTemplate().rules, previousRules: [] });
    expect(r.ok).toBe(false);
    // No tocó las reglas.
    expect(m.rows("agents")[0].response_rules).toEqual([]);
  });

  it("un Admin guarda la plantilla y queda en audit_log", async () => {
    const m = db();
    const r = await saveResponseRules({ supabase: m.client, workspaceId: "ws-1", agentId: "agent-1", userId: "u-1", isAdmin: true, rules: defaultRulesTemplate().rules, previousRules: [] });
    expect(r.ok).toBe(true);
    expect((m.rows("agents")[0].response_rules as unknown[]).length).toBe(9);
    expect(m.rows("audit_log").length).toBe(1);
  });

  it("reglas inválidas se rechazan aunque sea Admin", async () => {
    const m = db();
    const r = await saveResponseRules({ supabase: m.client, workspaceId: "ws-1", agentId: "agent-1", userId: "u-1", isAdmin: true, rules: [{ id: "x", enabled: true, action: "draft", conditions: [] }], previousRules: [] });
    expect(r.ok).toBe(false);
  });

  it("la acción por defecto se valida", async () => {
    const m = db();
    expect((await saveResponseRulesDefault({ supabase: m.client, workspaceId: "ws-1", agentId: "agent-1", userId: "u-1", isAdmin: true, action: "nope", previous: "draft" })).ok).toBe(false);
    expect((await saveResponseRulesDefault({ supabase: m.client, workspaceId: "ws-1", agentId: "agent-1", userId: "u-1", isAdmin: true, action: "send", previous: "draft" })).ok).toBe(true);
  });
});
