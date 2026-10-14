/**
 * Ventas F13 y F16: guardar las reglas, el probador y la simulación en seco.
 * Fija que sin assignment.manage no se escribe nada, que se valida en el servidor
 * (no solo en la pantalla) y que el probador y la simulación NO escriben.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";
let db: MemoryDb;
let role = "admin";
const audits: Array<Record<string, unknown>> = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async (a: Record<string, unknown>) => { audits.push(a); return null; }), diffFields: () => null }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({ user: { id: "user-1" }, workspace: { id: WS }, role, roleId: null, supabase: db.client }),
}));

const actions = await import("./assignment-rules");

const rule = (over: Record<string, unknown> = {}) => ({
  id: "r1", name: "Campañas de Ana", priority: 1, can_reassign: false, is_active: true,
  conditions: { rootConjunction: "and", conditions: [{ field: "last_campaign", operator: "contains", value: "ana" }], groups: [] },
  destination: { type: "user", user_id: "ana" }, ...over,
});

const snapshot = () => JSON.stringify(db.tables);

beforeEach(() => {
  role = "admin";
  audits.length = 0;
  db = memoryDb({
    assignment_rules: ["setter", "vendedor", "referral"].map((kind) => ({
      id: `ar-${kind}`, workspace_id: WS, kind, entity_type: "contact", mode: "manual", enabled_member_ids: [], condition_rules: [], last_assigned_member_id: null,
    })),
    workspace_members: ["ana", "beto"].map((user_id) => ({ workspace_id: WS, user_id })),
    workspace_roles: [],
    contacts: [
      { id: "c1", workspace_id: WS, display_name: "Lead con campaña de Ana", setter_id: null, vendedor_id: "beto", referred_by_user_id: null, referred_by_contact_id: null, assignment_locked_at: null, deleted_at: null, country: "CR", email: null, phone: null, whatsapp_phone: null, created_at: "2026-10-02T00:00:00Z",
        attribution: { version: 2, last_touch: { source: "instagram", medium: "paid_social", campaign: "campañas-de-ana" } } },
      { id: "c2", workspace_id: WS, display_name: "Lead sin atribución", setter_id: null, vendedor_id: null, referred_by_user_id: null, referred_by_contact_id: null, assignment_locked_at: null, deleted_at: null, country: null, email: null, phone: null, whatsapp_phone: null, created_at: "2026-10-01T00:00:00Z", attribution: null },
    ],
    conversations: [], channels: [],
  });
});

describe("saveAssignmentRule", () => {
  it("un Member de sistema no puede guardar nada", async () => {
    role = "member";
    const before = snapshot();
    expect(await actions.saveAssignmentRule({ kind: "setter", mode: "round_robin", enabledMemberIds: ["ana"] })).toMatchObject({ ok: false });
    expect(snapshot()).toBe(before);
  });

  it("guarda el reparto equitativo con las personas elegidas y lo audita", async () => {
    expect(await actions.saveAssignmentRule({ kind: "setter", mode: "round_robin", enabledMemberIds: ["ana", "beto"] })).toEqual({ ok: true });
    expect(db.rows("assignment_rules").find((r) => r.kind === "setter")).toMatchObject({ mode: "round_robin", enabled_member_ids: ["ana", "beto"], updated_by: "user-1" });
    expect(audits[0]).toMatchObject({ entityType: "assignment_rule", action: "assignment_rule.updated" });
  });

  it("round_robin sin personas se rechaza con el mensaje", async () => {
    expect(await actions.saveAssignmentRule({ kind: "setter", mode: "round_robin", enabledMemberIds: [] })).toEqual({ ok: false, error: "Elegí al menos una persona" });
    expect(db.rows("assignment_rules").find((r) => r.kind === "setter")?.mode).toBe("manual");
  });

  it("por condiciones: una regla sin destino o con prioridad repetida se rechaza", async () => {
    expect((await actions.saveAssignmentRule({ kind: "setter", mode: "condition_based", conditionRules: [rule({ destination: undefined })] })).ok).toBe(false);
    expect((await actions.saveAssignmentRule({ kind: "setter", mode: "condition_based", conditionRules: [rule(), rule({ id: "r2", name: "Otra" })] })).ok).toBe(false);
  });

  it("por condiciones válida: se guarda; al volver a manual se vacía la lista de reglas", async () => {
    expect((await actions.saveAssignmentRule({ kind: "vendedor", mode: "condition_based", conditionRules: [rule()] })).ok).toBe(true);
    expect((db.rows("assignment_rules").find((r) => r.kind === "vendedor")?.condition_rules as unknown[]).length).toBe(1);
    expect((await actions.saveAssignmentRule({ kind: "vendedor", mode: "manual" })).ok).toBe(true);
    expect(db.rows("assignment_rules").find((r) => r.kind === "vendedor")?.condition_rules).toEqual([]);
  });

  it("un tipo o un modo inventado se rechaza", async () => {
    expect((await actions.saveAssignmentRule({ kind: "fuente", mode: "manual" })).ok).toBe(false);
    expect((await actions.saveAssignmentRule({ kind: "setter", mode: "azar" })).ok).toBe(false);
  });
});

describe("probador y simulación (NO escriben)", () => {
  beforeEach(async () => {
    await actions.saveAssignmentRule({ kind: "setter", mode: "condition_based", conditionRules: [rule()] });
    await actions.saveAssignmentRule({ kind: "vendedor", mode: "condition_based", conditionRules: [rule({ id: "rv", destination: { type: "user", user_id: "ana" } })] });
  });

  it("con un toque a mano: a quién se asignaría y por qué regla", async () => {
    const before = snapshot();
    const r = await actions.probeAssignment({ touch: { source: "instagram", medium: "paid_social", campaign: "campaña de ana" } });
    expect(r.ok && r.data.find((x) => x.kind === "setter")).toMatchObject({ applies: true, wouldAssign: { id: "ana" }, ruleName: "Campañas de Ana" });
    expect(r.ok && r.data.find((x) => x.kind === "referral")?.reasonText).toContain("modo manual");
    expect(snapshot()).toBe(before);
  });

  it("con un toque inválido (fuente fuera de la lista) se rechaza", async () => {
    expect((await actions.probeAssignment({ touch: { source: "facebook" } })).ok).toBe(false);
  });

  it("con un contacto: dice 'no se aplicaría: ya tiene vendedor' cuando el campo está lleno", async () => {
    const r = await actions.probeAssignment({ contactId: "c1" });
    expect(r.ok && r.data.find((x) => x.kind === "vendedor")).toMatchObject({ applies: false, reasonText: "no se aplicaría: ya tiene vendedor" });
  });

  it("la simulación recorre los últimos contactos sin escribir nada", async () => {
    const before = snapshot();
    const r = await actions.simulateAssignments();
    expect(r.ok && r.data.map((x) => x.contactId)).toEqual(["c1", "c2"]);
    expect(snapshot()).toBe(before);
  });

  it("un Member de sistema no puede probar", async () => {
    role = "member";
    expect((await actions.probeAssignment({ contactId: "c1" })).ok).toBe(false);
    expect((await actions.simulateAssignments()).ok).toBe(false);
  });

  it("el código del probador no escribe: sin insert, update, upsert ni delete", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("lib/actions/assignment-rules.ts", "utf8");
    const probeSource = source.slice(source.indexOf("export async function probeAssignment"));
    expect(probeSource).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
});
