import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { defaultCommissionRoles } from "./roles";

const WS = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";

let db: MemoryDb;

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));
vi.mock("@/lib/workspace-members", () => ({ getWorkspaceMembers: async () => [{ userId: ME, name: "Yo", role: "owner", email: "" }] }));

const { loadRulesForViewer } = await import("./rules-ui-load");

const rule = (n: number, over: Record<string, unknown> = {}) => ({
  id: `d${n}000000-0000-4000-8000-000000000000`, workspace_id: WS, name: `Regla ${n}`, role: "vendedor", position: n, conditions: {}, calc_type: "percent", rate: 8, fixed_amount: null,
  base: "gross", beneficiary_user_id: null, hold_days: 0, valid_from: null, valid_until: null, is_active: true, archived_at: null, updated_at: `2026-10-0${n}T00:00:00Z`, ...over,
});

function ctxFor(keys: string[]) {
  return {
    supabase: db.client,
    user: { id: ME },
    workspace: { id: WS, timezone: "UTC" },
    can: (key: string) => keys.includes(key),
    scope: () => "all",
  } as unknown as Parameters<typeof loadRulesForViewer>[0];
}

beforeEach(() => {
  db = memoryDb({
    commission_rules: [rule(1), rule(2), rule(3, { archived_at: "2026-01-01" })],
    workspaces: [{ id: WS, commission_settings: { roles: defaultCommissionRoles() }, payment_methods: null }],
    products: [], product_variants: [], contact_touches: [],
  });
});

describe("loadRulesForViewer", () => {
  it("quien administra recibe las reglas con su versión", async () => {
    const data = await loadRulesForViewer(ctxFor(["commissions.manage"]), "manage");
    expect(data.access).toBe("manage");
    expect(data.loadError).toBe(false);
    expect(data.rules.vendedor.map((r) => r.name)).toEqual(["Regla 1", "Regla 2"]);
    expect(Object.keys(data.updatedAt)).toHaveLength(2);
    expect(data.updatedAt[rule(2).id]).toBe("2026-10-02T00:00:00Z");
  });

  it("quien solo ve todo también recibe las reglas, marcadas como solo lectura", async () => {
    const data = await loadRulesForViewer(ctxFor(["commissions.view"]), "read");
    expect(data.access).toBe("read");
    expect(data.rules.vendedor).toHaveLength(2);
    expect(data.roles).toHaveLength(4);
  });
});
