/**
 * Ventas F15: el job que asigna setter, vendedor y referido. Fija las reglas de
 * escritura (campo lleno, asignado a mano, "puede reasignar"), el actor sistema
 * con el nombre de la regla y el avance del puntero del reparto.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const audits: Array<Record<string, unknown>> = [];
vi.mock("@/lib/audit", () => ({ auditAsSystem: vi.fn(async (args: Record<string, unknown>) => { audits.push(args); return "audit-1"; }) }));

const { handleSalesContactEval } = await import("./sales-contact-eval");

const WS = "ws-1";
const ANA = "ana";
const BETO = "beto";

let db: MemoryDb;

const baseContact = (over: Record<string, unknown> = {}) => ({
  id: "c1", workspace_id: WS, setter_id: null, vendedor_id: null, referred_by_user_id: null, referred_by_contact_id: null,
  assignment_locked_at: null, deleted_at: null, country: "CR", email: "a@b.co", phone: null, whatsapp_phone: null,
  attribution: { version: 2, last_touch: { source: "instagram", medium: "paid_social", campaign: "campañas-de-ana" } }, ...over,
});

const conditionRule = (over: Record<string, unknown> = {}) => ({
  id: "r1", name: "Campañas de Ana", priority: 1, can_reassign: false, is_active: true,
  conditions: { rootConjunction: "and", conditions: [{ field: "last_campaign", operator: "contains", value: "ana" }], groups: [] },
  destination: { type: "user", user_id: ANA }, ...over,
});

const ruleRow = (kind: string, over: Record<string, unknown> = {}) => ({
  id: `ar-${kind}`, workspace_id: WS, kind, entity_type: "contact", mode: "manual", enabled_member_ids: [],
  last_assigned_member_id: null, condition_rules: [], updated_at: "2026-10-01T00:00:00Z", ...over,
});

const seed = (contact = baseContact(), rules: Array<Record<string, unknown>> = [ruleRow("setter", { mode: "condition_based", condition_rules: [conditionRule()] }), ruleRow("vendedor"), ruleRow("referral")]) =>
  memoryDb({
    contacts: [contact],
    assignment_rules: rules,
    workspace_members: [ANA, BETO].map((user_id) => ({ workspace_id: WS, user_id })),
    conversations: [], channels: [],
  });

const run = (payload: Record<string, unknown> = { contact_id: "c1", workspace_id: WS }) =>
  handleSalesContactEval({ supabase: db.client, job: { id: "j1", type: "sales_contact_eval", payload, attempts: 0 } });
const contactNow = () => db.rows("contacts")[0];

beforeEach(() => {
  audits.length = 0;
  db = seed();
});

describe("sales_contact_eval", () => {
  it("contacto sin setter y una regla que coincide → setter = Ana y auditoría de sistema con el nombre de la regla", async () => {
    await run();
    expect(contactNow().setter_id).toBe(ANA);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      entityType: "contact", entityId: "c1", action: "assignment.automatic", label: "Campañas de Ana",
      changes: { setter_id: { old: null, new: ANA } },
    });
  });

  it("un contacto que ya tiene setter y una regla sin 'puede reasignar': no cambia y no audita", async () => {
    db = seed(baseContact({ setter_id: BETO }));
    await run();
    expect(contactNow().setter_id).toBe(BETO);
    expect(audits).toHaveLength(0);
  });

  it("assignment_locked_at con una regla que SÍ puede reasignar: no cambia", async () => {
    db = seed(baseContact({ setter_id: BETO, assignment_locked_at: "2026-10-01T00:00:00Z" }), [
      ruleRow("setter", { mode: "condition_based", condition_rules: [conditionRule({ can_reassign: true })] }),
    ]);
    await run();
    expect(contactNow().setter_id).toBe(BETO);
    expect(audits).toHaveLength(0);
  });

  it("'puede reasignar' sobre un contacto sin bloquear sí pisa al que estaba", async () => {
    db = seed(baseContact({ setter_id: BETO }), [ruleRow("setter", { mode: "condition_based", condition_rules: [conditionRule({ can_reassign: true })] })]);
    await run();
    expect(contactNow().setter_id).toBe(ANA);
    expect(audits[0]).toMatchObject({ changes: { setter_id: { old: BETO, new: ANA } } });
  });

  it("ninguna regla coincide: no se escribe nada", async () => {
    db = seed(baseContact({ attribution: { version: 2, last_touch: { source: "google" } } }));
    await run();
    expect(contactNow().setter_id).toBeNull();
    expect(audits).toHaveLength(0);
  });

  it("todas las reglas en manual: el job no hace nada", async () => {
    db = seed(baseContact(), [ruleRow("setter"), ruleRow("vendedor"), ruleRow("referral")]);
    await run();
    expect(contactNow().setter_id).toBeNull();
    expect(audits).toHaveLength(0);
  });

  it("un destino round robin avanza el last_index DE ESA REGLA", async () => {
    const rr = conditionRule({ destination: { type: "round_robin", members: [ANA, BETO], last_index: 0 } });
    db = seed(baseContact(), [ruleRow("vendedor", { mode: "condition_based", condition_rules: [rr] })]);
    await run();
    expect(contactNow().vendedor_id).toBe(BETO);
    const saved = db.rows("assignment_rules")[0].condition_rules as Array<{ id: string; destination: { last_index: number } }>;
    expect(saved[0].destination.last_index).toBe(1);
  });

  it("el modo reparto equitativo avanza last_assigned_member_id", async () => {
    db = seed(baseContact(), [ruleRow("setter", { mode: "round_robin", enabled_member_ids: [ANA, BETO], last_assigned_member_id: ANA })]);
    await run();
    expect(contactNow().setter_id).toBe(BETO);
    expect(db.rows("assignment_rules")[0].last_assigned_member_id).toBe(BETO);
    expect(audits[0]).toMatchObject({ label: "Reparto equitativo (setter)" });
  });

  it("dos jobs del mismo contacto: el segundo no escribe nada nuevo", async () => {
    await run();
    await run();
    expect(contactNow().setter_id).toBe(ANA);
    expect(audits).toHaveLength(1);
  });

  it("un contacto anónimo no se evalúa: no gasta turnos del reparto", async () => {
    db = seed(baseContact({ is_anonymous: true }));
    await run();
    expect(contactNow().setter_id).toBeNull();
    expect(audits).toHaveLength(0);
  });

  it("un contacto borrado o inexistente se ignora", async () => {
    db = seed(baseContact({ deleted_at: "2026-10-01T00:00:00Z" }));
    await run();
    expect(audits).toHaveLength(0);
    await run({ contact_id: "no-existe", workspace_id: WS });
    expect(audits).toHaveLength(0);
  });

  it("el referido a un contacto escribe referred_by_contact_id solo si el contacto existe", async () => {
    const toContact = conditionRule({ destination: { type: "contact", contact_id: "c-ref" } });
    db = seed(baseContact(), [ruleRow("referral", { mode: "condition_based", condition_rules: [toContact] })]);
    db.rows("contacts").push(baseContact({ id: "c-ref", attribution: null }));
    await run();
    expect(contactNow().referred_by_contact_id).toBe("c-ref");
    expect(audits[0]).toMatchObject({ changes: { referred_by_contact_id: { old: null, new: "c-ref" } } });
  });

  it("no emite assignment_changed a mano (lo emite el trigger de la base)", async () => {
    await run();
    expect(db.rows("automation_events")).toHaveLength(0);
  });
});
