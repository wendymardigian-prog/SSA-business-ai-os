import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "@/lib/testing/fake-db";

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  service: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
  sendEmail: vi.fn(),
  sendMessage: vi.fn(),
  executeFlow: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: mocks.permission }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: mocks.service }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail: mocks.sendEmail }));
vi.mock("@/lib/flow-engine/send", () => ({ sendChannelMessage: mocks.sendMessage }));
vi.mock("@/lib/flow-engine/engine", () => ({ executeFlow: mocks.executeFlow }));
vi.mock("@/lib/user-timezone", () => ({ resolveViewerTimezone: async () => "America/Argentina/Buenos_Aires" }));

import { getTestResponseValues, listTestResponses } from "./test-conditions";
import { explainPaths } from "@/lib/automations/explain-paths";
import { flowToTree } from "@/lib/automations/step-tree";
import { conditionGroupsFor } from "@/lib/automations/step-tree-edit";

const FLOW = "22222222-2222-4222-8222-222222222222";
const FORM = "11111111-1111-4111-8111-111111111111";
const SUB = "33333333-3333-4333-8333-333333333333";
const FACT = ["Menos de USD 1.000", "Más de USD 10.000"];

function setup(opts: { can?: (key: string) => boolean; flow?: Record<string, unknown> | null } = {}): FakeDb {
  const db = fakeDb({
    "flows:select": { data: opts.flow === null ? null : { form_id: FORM, ...(opts.flow ?? {}) } },
    "forms:select": { data: { id: FORM, name: "Aplicación" } },
    "form_submissions:select": (call) => {
      if (call.single) {
        return { data: { form_version_id: "v1", answers: { facturacion: { label: "Facturación", type: "single_select", value: FACT[1] } }, score: null, nps_category: null } };
      }
      return {
        data: [
          { id: SUB, created_at: "2026-10-12T18:30:00Z", contact_id: "c1" },
          { id: "s2", created_at: "2026-10-11T10:00:00Z", contact_id: null },
        ],
      };
    },
    "contacts:select": { data: [{ id: "c1", display_name: "Ana Pérez", email: "ana@ejemplo.com" }] },
    "form_versions:select": { data: { definition: { fields: [{ key: "facturacion", type: "single_select" }] } } },
  });
  mocks.permission.mockResolvedValue({ workspace: { id: "ws1", timezone: "UTC" }, user: { id: "u1", email: "yo@ejemplo.com" }, supabase: db.client, can: opts.can ?? (() => true) });
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("permisos y alcance", () => {
  it("sin forms.view no devuelve nada", async () => {
    mocks.permission.mockResolvedValue(null);
    expect(await listTestResponses({ flowId: FLOW })).toEqual({ ok: false, error: expect.stringMatching(/permiso/) });
    expect(await getTestResponseValues({ flowId: FLOW, submissionId: SUB })).toEqual({ ok: false, error: expect.stringMatching(/permiso/) });
  });

  it("pide forms.view, no una llave de escritura", async () => {
    setup();
    await listTestResponses({ flowId: FLOW });
    expect(mocks.permission).toHaveBeenCalledWith("forms.view");
  });

  it("un id que no es un UUID se rechaza antes de tocar la base", async () => {
    const db = setup();
    expect((await listTestResponses({ flowId: "no" })).ok).toBe(false);
    expect((await getTestResponseValues({ flowId: FLOW, submissionId: "x" })).ok).toBe(false);
    expect(db.calls).toHaveLength(0);
  });

  it("una automatizacion que no es de un formulario (o de otro workspace) no se encuentra", async () => {
    setup({ flow: null });
    expect(await listTestResponses({ flowId: FLOW })).toEqual({ ok: false, error: "No encontré esa automatización." });
  });

  it("filtra por el workspace de la SESION", async () => {
    const db = setup();
    await listTestResponses({ flowId: FLOW });
    for (const call of db.calls.filter((c) => ["flows", "forms", "form_submissions"].includes(c.table))) {
      expect(call.filters).toContainEqual({ method: "eq", column: "workspace_id", value: "ws1" });
    }
  });
});

describe("las respuestas", () => {
  it("lista las ultimas 20 con una etiqueta legible (fecha + contacto)", async () => {
    const db = setup();
    const out = await listTestResponses({ flowId: FLOW });
    expect(out).toMatchObject({ ok: true, formName: "Aplicación" });
    if (!out.ok) return;
    expect(out.responses).toHaveLength(2);
    expect(out.responses[0].label).toContain("Ana Pérez (ana@ejemplo.com)");
    expect(out.responses[1].label).toContain("Sin contacto");
    const list = db.calls.find((c) => c.table === "form_submissions")!;
    expect(list.filters).toContainEqual({ method: "limit", column: 20, value: undefined });
  });

  it("arma los valores con la definicion de la version de ESA respuesta", async () => {
    setup();
    const out = await getTestResponseValues({ flowId: FLOW, submissionId: SUB });
    expect(out).toEqual({ ok: true, values: { "form.name": "Aplicación", "answer.facturacion": FACT[1] } });
  });

  it("una respuesta que no se ve (la RLS no la devuelve) no se encuentra", async () => {
    const db = fakeDb({
      "flows:select": { data: { form_id: FORM } },
      "forms:select": { data: { id: FORM, name: "A" } },
      "form_submissions:select": { data: null },
    });
    mocks.permission.mockResolvedValue({ workspace: { id: "ws1" }, user: { id: "u1" }, supabase: db.client, can: () => true });
    expect(await getTestResponseValues({ flowId: FLOW, submissionId: SUB })).toEqual({ ok: false, error: "No encontré esa respuesta." });
  });
});

describe("probar NO hace nada: ni sesiones, ni eventos, ni emails, ni mensajes", () => {
  it("la accion solo hace selects", async () => {
    const db = setup();
    await listTestResponses({ flowId: FLOW });
    await getTestResponseValues({ flowId: FLOW, submissionId: SUB });
    expect(db.calls.length).toBeGreaterThan(0);
    expect(db.calls.every((c) => c.op === "select")).toBe(true);
    expect(db.writes()).toEqual([]);
    expect(db.rpcCalls).toEqual([]);
    for (const table of ["flow_sessions", "analytics_events", "messages", "email_log", "audit_log"]) expect(db.calls.filter((c) => c.table === table)).toEqual([]);
  });

  it("de punta a punta (leer la respuesta + explicar) no manda un email ni un mensaje, ni corre un flujo, ni toca la auditoria", async () => {
    const db = setup();
    const values = await getTestResponseValues({ flowId: FLOW, submissionId: SUB });
    if (!values.ok) throw new Error("tenia que andar");

    const tree = flowToTree(
      [
        { id: "trigger", type: "trigger", position: { x: 0, y: 0 }, data: { triggerType: "form_submitted" } },
        {
          id: "b1",
          type: "branch",
          position: { x: 0, y: 1 },
          data: { paths: [{ id: "p_alta01", label: "Alta", logic: "and", conditions: [{ field: "answer.facturacion", operator: "is", value: FACT[1], valueType: "single_select" }] }] },
        },
        { id: "mail", type: "action", position: { x: 0, y: 2 }, data: { actionType: "send_email", to: "contact", subject: "Hola", body: "x" } },
      ] as never,
      [
        { id: "e1", source: "trigger", target: "b1" },
        { id: "e2", source: "b1", sourceHandle: "p_alta01", target: "mail" },
      ] as never,
    )!;
    const groups = conditionGroupsFor(tree, "b1", { triggerSchema: [], customFields: [], tags: [], sequences: [] });
    const result = explainPaths(tree, values.values, groups.flatMap((g) => g.fields));
    expect(result.branches[0].takenPathId).toBe("p_alta01");

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.executeFlow).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.service).not.toHaveBeenCalled();
    expect(db.writes()).toEqual([]);
  });
});
