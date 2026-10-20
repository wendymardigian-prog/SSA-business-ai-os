import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "@/lib/testing/fake-db";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), service: vi.fn(), audit: vi.fn(), revalidate: vi.fn(), emailConfigured: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: mocks.permission }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: mocks.service }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail: vi.fn(), isEmailConfigured: mocks.emailConfigured }));

import { saveEventFlowTree, toggleEventFlow } from "./event-flows";
import { FLOW_TEMPLATES, templateGraph } from "@/lib/scheduling/automation/templates";
import { flowToTree } from "@/lib/automations/step-tree";

const FLOW = "22222222-2222-4222-8222-222222222222";

function setup(opts: { status?: string; flow?: Record<string, unknown> | null; nodes?: unknown[]; edges?: unknown[]; eventOwner?: string; manageOthers?: boolean } = {}): FakeDb {
  const graph = templateGraph(FLOW_TEMPLATES.find((t) => t.key === "reminder_1h")!, "ev-1");
  const db = fakeDb({
    "flows:select": { data: opts.flow === null ? null : { id: FLOW, name: "A", status: opts.status ?? "draft", event_type_id: "ev-1", template_key: null, workspace_id: "ws1", nodes: opts.nodes ?? graph.nodes, edges: opts.edges ?? graph.edges, ...(opts.flow ?? {}) } },
    "event_types:select": { data: { owner_user_id: opts.eventOwner ?? "u1" } },
    "flows:update": { data: null },
    "triggers:delete": { data: null },
    "triggers:insert": { data: null },
  });
  mocks.permission.mockResolvedValue({ workspace: { id: "ws1" }, user: { id: "u1", email: "yo@ejemplo.com" }, supabase: db.client, can: (key: string) => key !== "scheduling.manage_others" || (opts.manageOthers ?? true) });
  // Las conexiones del negocio (G1): por defecto sin IA, canales ni agentes; el email segun cada test.
  mocks.service.mockResolvedValue(fakeDb({ "integration_configs:select": { data: [] }, "channels:select": { data: [] }, "agents:select": { data: [] } }).client);
  return db;
}

const stepsOf = () => {
  const g = templateGraph(FLOW_TEMPLATES.find((t) => t.key === "reminder_1h")!, "ev-1");
  return flowToTree(g.nodes, g.edges)!.steps;
};

beforeEach(() => vi.clearAllMocks());

describe("saveEventFlowTree", () => {
  it("guarda el arbol sin perder el mensaje de WhatsApp (onlyIfPhone) ni el disparador", async () => {
    const db = setup();
    expect(await saveEventFlowTree({ flowId: FLOW, tree: { steps: stepsOf() } })).toEqual({ ok: true });
    const nodes = (db.writesTo("flows")[0].values as { nodes: Array<{ type: string; data: Record<string, unknown> }> }).nodes;
    expect(nodes.find((n) => n.type === "sendMessage")?.data.onlyIfPhone).toBe(true);
    expect(nodes[0].data).toMatchObject({ triggerType: "booking_before_start" });
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard/agenda/configuracion/eventos/ev-1");
  });

  it("acepta lo de la Agenda (cancelar la reunion) y Condiciones", async () => {
    setup();
    const out = await saveEventFlowTree({
      flowId: FLOW,
      tree: {
        steps: [
          ...stepsOf(),
          {
            kind: "branch",
            id: "b1",
            data: {},
            paths: [{ id: "p_aaaaaa", label: "No vino", logic: "and", conditions: [{ field: "booking.status", operator: "is", valueType: "text", value: "no_show" }], steps: [{ kind: "action", id: "c1", nodeType: "action", data: { actionType: "cancel_booking", status: "cancelled_other" } }] }],
            otherwise: [],
          },
        ],
      },
    });
    expect(out.ok).toBe(true);
  });

  it("se niega si el grafo guardado no es un arbol, y no escribe", async () => {
    const nodes = [{ id: "trigger", type: "trigger", data: {} }, { id: "a", type: "action", data: { actionType: "addTag" } }, { id: "b", type: "action", data: { actionType: "addTag" } }];
    const edges = [{ id: "e1", source: "trigger", target: "a" }, { id: "e2", source: "trigger", target: "b" }];
    const db = setup({ nodes, edges });
    expect((await saveEventFlowTree({ flowId: FLOW, tree: { steps: [] } })).ok).toBe(false);
    expect(db.writes()).toHaveLength(0);
  });

  it("valida el arbol: un paso desconocido no se guarda", async () => {
    const db = setup();
    const out = await saveEventFlowTree({ flowId: FLOW, tree: { steps: [{ kind: "action", id: "x", nodeType: "inventado", data: {} }] } });
    expect(out.ok).toBe(false);
    expect(db.writes()).toHaveLength(0);
  });

  it("publicado: rehace el trigger activo; borrador: no lo toca", async () => {
    const on = setup({ status: "published" });
    await saveEventFlowTree({ flowId: FLOW, tree: { steps: stepsOf() } });
    expect(on.writesTo("triggers").find((c) => c.op === "insert")?.values).toEqual([expect.objectContaining({ type: "booking_before_start", is_active: true, workspace_id: "ws1" })]);
    const off = setup();
    await saveEventFlowTree({ flowId: FLOW, tree: { steps: stepsOf() } });
    expect(off.writesTo("triggers")).toHaveLength(0);
  });

  it("sin permiso o de otro workspace, nada", async () => {
    mocks.permission.mockResolvedValue(null);
    expect((await saveEventFlowTree({ flowId: FLOW, tree: { steps: [] } })).ok).toBe(false);
    const other = setup({ flow: { workspace_id: "otro" } });
    expect((await saveEventFlowTree({ flowId: FLOW, tree: { steps: [] } })).ok).toBe(false);
    expect(other.writes()).toHaveLength(0);
  });
});

describe("los flujos del evento de otra persona", () => {
  it("un Member (sin gestionar agendas de otros) no los prende ni los edita", async () => {
    mocks.emailConfigured.mockResolvedValue(true);
    const db = setup({ eventOwner: "otra", manageOthers: false });
    const toggled = await toggleEventFlow({ flowId: FLOW, enabled: false });
    expect(toggled).toEqual({ ok: false, error: expect.stringContaining("otra persona") });
    expect((await saveEventFlowTree({ flowId: FLOW, tree: { steps: stepsOf() } })).ok).toBe(false);
    expect(db.writes()).toHaveLength(0);
  });

  it("quien gestiona agendas de otros (Owner, Admin o el permiso) si", async () => {
    setup({ eventOwner: "otra", manageOthers: true, status: "published" });
    expect((await toggleEventFlow({ flowId: FLOW, enabled: false })).ok).toBe(true);
  });

  it("un flujo que no es de ningun evento no se toca desde aca", async () => {
    const db = setup({ flow: { event_type_id: null } });
    expect((await toggleEventFlow({ flowId: FLOW, enabled: false })).ok).toBe(false);
    expect(db.writes()).toHaveLength(0);
  });
});

describe("toggleEventFlow: prender un flujo con una accion sin su conexion (G1)", () => {
  // El flujo de la plantilla "reminder_1h" tiene un email y un mensaje de WhatsApp: con canales sin conectar, no se prende.
  it("sin Resend ni canales conectados NO se prende y no escribe nada", async () => {
    mocks.emailConfigured.mockResolvedValue(false);
    const db = setup();
    const out = await toggleEventFlow({ flowId: FLOW, enabled: true });
    expect(out.ok).toBe(false);
    expect(db.writes()).toHaveLength(0);
  });

  it("apagarlo siempre se puede", async () => {
    mocks.emailConfigured.mockResolvedValue(false);
    const db = setup({ status: "published" });
    expect((await toggleEventFlow({ flowId: FLOW, enabled: false })).ok).toBe(true);
    expect(db.writesTo("flows")[0].values).toEqual({ status: "draft" });
  });
});
