import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "@/lib/testing/fake-db";

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  service: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
  sendEmail: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: mocks.permission }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: mocks.service }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail: mocks.sendEmail }));

import { createFormFlow, createFormFlowFromTemplate, saveFormLinearFlow, sendFormFlowTestEmail, toggleFormFlow } from "./flows";
import { blankFormFlowGraph, formTemplateGraph } from "@/lib/forms/automation/templates";

const FORM = "11111111-1111-4111-8111-111111111111";
const FLOW = "22222222-2222-4222-8222-222222222222";

interface Opts {
  can?: (key: string) => boolean;
  formType?: string;
  formStatus?: string;
  flow?: Record<string, unknown> | null;
  existingNames?: string[];
}

function setup(opts: Opts = {}): FakeDb {
  const graph = formTemplateGraph("notify_me_email", { form: { id: FORM, name: "Aplicación", type: "custom" }, userEmail: "yo@ejemplo.com" });
  const db = fakeDb({
    "forms:select": { data: { id: FORM, name: "Aplicación", type: opts.formType ?? "custom", status: opts.formStatus ?? "published" } },
    "flows:select": (call) => {
      // `namesTaken` pide solo el nombre; `formFlowGraph` pide el grafo.
      if (call.single || call.filters.some((f) => f.column === "id")) {
        return { data: opts.flow === null ? null : { id: FLOW, name: "A", status: "draft", form_id: FORM, workspace_id: "ws1", nodes: graph.nodes, edges: graph.edges, ...(opts.flow ?? {}) } };
      }
      return { data: (opts.existingNames ?? []).map((name) => ({ name })) };
    },
    "flows:insert": { data: { id: FLOW } },
    "flows:update": { data: null },
    "triggers:delete": { data: null },
    "triggers:insert": { data: null },
  });
  mocks.permission.mockResolvedValue({
    workspace: { id: "ws1" },
    user: { id: "u1", email: "yo@ejemplo.com" },
    supabase: db.client,
    can: opts.can ?? (() => true),
  });
  mocks.service.mockResolvedValue(fakeDb().client);
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendEmail.mockResolvedValue({ ok: true });
});

describe("permisos", () => {
  it("sin forms.manage no hace nada", async () => {
    mocks.permission.mockResolvedValue(null);
    expect(await createFormFlow({ formId: FORM })).toEqual({ ok: false, error: expect.stringMatching(/permiso/) });
  });
  it("con forms.manage pero sin flows.edit tampoco", async () => {
    const db = setup({ can: (k) => k !== "flows.edit" });
    expect((await createFormFlow({ formId: FORM })).ok).toBe(false);
    expect(db.writes()).toHaveLength(0);
  });
});

describe("createFormFlow", () => {
  it("crea un flow en borrador atado al formulario, con el trigger del tipo y form_ids = [este]", async () => {
    const db = setup({ formType: "survey" });
    const out = await createFormFlow({ formId: FORM });
    expect(out).toEqual({ ok: true, flowId: FLOW });
    const insert = db.writesTo("flows")[0];
    const row = insert.values as Record<string, unknown>;
    expect(row).toMatchObject({ workspace_id: "ws1", status: "draft", form_id: FORM, name: "Aplicación · Automatización 1" });
    const nodes = row.nodes as Array<{ data: Record<string, unknown> }>;
    expect(nodes[0].data).toMatchObject({ triggerType: "survey_answered", form_ids: [FORM] });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "form", entityId: FORM, action: "form.updated" }));
  });
  it("un formulario archivado no admite automatizaciones nuevas", async () => {
    setup({ formStatus: "archived" });
    expect((await createFormFlow({ formId: FORM })).ok).toBe(false);
  });
  it("un id que no es uuid no consulta nada", async () => {
    const db = setup();
    expect((await createFormFlow({ formId: "x" })).ok).toBe(false);
    expect(db.calls).toHaveLength(0);
  });
});

describe("createFormFlowFromTemplate", () => {
  it("notify_me_email nace apagado con to: fixed y el email de quien la crea", async () => {
    const db = setup();
    const out = await createFormFlowFromTemplate({ formId: FORM, template: "notify_me_email" });
    expect(out.ok).toBe(true);
    const row = db.writesTo("flows")[0].values as { status: string; nodes: Array<{ id: string; data: Record<string, unknown> }> };
    expect(row.status).toBe("draft");
    expect(row.nodes.find((n) => n.id === "step-1")?.data).toMatchObject({ to: "fixed", fixedEmail: "yo@ejemplo.com" });
  });
  it("la de detractores no existe para un formulario común", async () => {
    setup({ formType: "custom" });
    expect((await createFormFlowFromTemplate({ formId: FORM, template: "detractor_alert" })).ok).toBe(false);
  });
  it("ponerle un tag pide el tag", async () => {
    setup();
    expect((await createFormFlowFromTemplate({ formId: FORM, template: "add_tag" })).ok).toBe(false);
    expect((await createFormFlowFromTemplate({ formId: FORM, template: "add_tag", tagName: "calificado" })).ok).toBe(true);
  });
});

describe("toggleFormFlow", () => {
  it("encender publica el flow y escribe su trigger activo", async () => {
    const db = setup();
    expect(await toggleFormFlow({ flowId: FLOW, enabled: true })).toEqual({ ok: true });
    expect(db.writesTo("flows")[0].values).toEqual({ status: "published" });
    const inserted = db.writesTo("triggers").find((c) => c.op === "insert")!.values as Array<Record<string, unknown>>;
    expect(inserted[0]).toMatchObject({ type: "form_submitted", is_active: true, workspace_id: "ws1" });
  });
  it("apagar lo deja en borrador con el trigger inactivo", async () => {
    const db = setup();
    await toggleFormFlow({ flowId: FLOW, enabled: false });
    expect(db.writesTo("flows")[0].values).toEqual({ status: "draft" });
    const inserted = db.writesTo("triggers").find((c) => c.op === "insert")!.values as Array<Record<string, unknown>>;
    expect(inserted[0]).toMatchObject({ is_active: false });
  });
  it("un flow que no es de un formulario no se toca", async () => {
    const db = setup({ flow: { form_id: null } });
    expect((await toggleFormFlow({ flowId: FLOW, enabled: true })).ok).toBe(false);
    expect(db.writes()).toHaveLength(0);
  });
  it("un flow de otro workspace no se toca", async () => {
    const db = setup({ flow: { workspace_id: "otro" } });
    expect((await toggleFormFlow({ flowId: FLOW, enabled: true })).ok).toBe(false);
    expect(db.writes()).toHaveLength(0);
  });
});

describe("saveFormLinearFlow", () => {
  const linear = () => ({
    trigger: { type: "form_submitted", config: { form_ids: [FORM] } },
    conditions: [],
    steps: [{ kind: "email" as const, to: "fixed", subject: "Hola", body: "Cuerpo", fixedEmail: "yo@ejemplo.com" }],
  });
  it("guarda el grafo y conserva el email fijo", async () => {
    const db = setup();
    expect((await saveFormLinearFlow({ flowId: FLOW, linear: linear() })).ok).toBe(true);
    const nodes = (db.writesTo("flows")[0].values as { nodes: Array<{ id: string; data: Record<string, unknown> }> }).nodes;
    expect(nodes.find((n) => n.id === "step-1")?.data).toMatchObject({ fixedEmail: "yo@ejemplo.com" });
  });
  it("si estaba encendido, rehace el trigger activo", async () => {
    const db = setup({ flow: { status: "published" } });
    await saveFormLinearFlow({ flowId: FLOW, linear: linear() });
    expect(db.writesTo("triggers").some((c) => c.op === "insert")).toBe(true);
  });
  it("un flujo con ramas no se guarda desde la vista lineal", async () => {
    const graph = blankFormFlowGraph({ id: FORM, type: "custom" });
    const nodes = [...graph.nodes, { id: "a", type: "action", data: { actionType: "addTag" } }, { id: "b", type: "action", data: { actionType: "addTag" } }];
    const edges = [
      { id: "e1", source: "trigger", target: "a" },
      { id: "e2", source: "trigger", target: "b" },
    ];
    const db = setup({ flow: { nodes, edges } });
    const out = await saveFormLinearFlow({ flowId: FLOW, linear: linear() });
    expect(out.ok).toBe(false);
    expect(db.writes()).toHaveLength(0);
  });
});

describe("sendFormFlowTestEmail", () => {
  it("va solo al email de quien edita, como flow_test y con variables de ejemplo", async () => {
    setup();
    const out = await sendFormFlowTestEmail({ flowId: FLOW, subject: "Nueva respuesta: {{form.name}}", body: "Hola {{contact.display_name}} {{submission.score}}" });
    expect(out.ok).toBe(true);
    const sent = mocks.sendEmail.mock.calls[0][0];
    expect(sent).toMatchObject({ to: "yo@ejemplo.com", kind: "flow_test", relatedEntityType: "flow", relatedEntityId: FLOW });
    expect(sent.subject).toBe("Nueva respuesta: Formulario de ejemplo");
    expect(sent.html).toContain("Ana Pérez");
  });
  it("sin Resend conectado lo explica", async () => {
    setup();
    mocks.sendEmail.mockResolvedValue({ ok: false, reason: "not_configured", error: "x" });
    const out = await sendFormFlowTestEmail({ flowId: FLOW, subject: "a", body: "b" });
    expect(out).toEqual({ ok: false, error: expect.stringMatching(/Resend/) });
  });
});
