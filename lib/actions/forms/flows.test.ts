import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "@/lib/testing/fake-db";

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  service: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
  sendEmail: vi.fn(),
  emailConfigured: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: mocks.permission }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: mocks.service }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail: mocks.sendEmail, isEmailConfigured: mocks.emailConfigured }));

import { createFormFlow, createFormFlowFromTemplate, saveFormFlowTree, saveFormLinearFlow, sendFormFlowTestEmail, toggleFormFlow } from "./flows";
import { flowToTree } from "@/lib/automations/step-tree";
import { blankFormFlowGraph, formTemplateGraph } from "@/lib/forms/automation/templates";

const FORM = "11111111-1111-4111-8111-111111111111";
const FLOW = "22222222-2222-4222-8222-222222222222";

interface Opts {
  can?: (key: string) => boolean;
  formType?: string;
  formStatus?: string;
  flow?: Record<string, unknown> | null;
  existingNames?: string[];
  /** Las preguntas del formulario (borrador, sin version publicada), para la plantilla que pide una. */
  fields?: Array<Record<string, unknown>>;
  /** Resend conectado (G1): por defecto si, para que el flujo de la plantilla se pueda encender. */
  resend?: boolean;
}

function setup(opts: Opts = {}): FakeDb {
  const graph = formTemplateGraph("notify_me_email", { form: { id: FORM, name: "Aplicación", type: "custom" }, userEmail: "yo@ejemplo.com" });
  const db = fakeDb({
    "forms:select": (call) =>
      call.single
        ? { data: { id: FORM, name: "Aplicación", type: opts.formType ?? "custom", status: opts.formStatus ?? "published" } }
        : // `loadFormsWithFields` (varios formularios, sin version publicada: usa el borrador).
          { data: [{ id: FORM, current_version_id: null, draft_definition: { fields: opts.fields ?? [] } }] },
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
  // Las conexiones del negocio, para prender un flujo (G1): Resend segun `opts.resend`; sin IA, sin canales ni agentes.
  mocks.emailConfigured.mockResolvedValue(opts.resend !== false);
  mocks.service.mockResolvedValue(
    fakeDb({
      "integration_configs:select": { data: [] },
      "channels:select": { data: [] },
      "agents:select": { data: [] },
    }).client,
  );
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

describe("createFormFlowFromTemplate: Email distinto según una respuesta", () => {
  const FACT = ["Poco", "Mucho", "Muchisimo"];
  const fields = [
    { id: "1", key: "facturacion", label: "Facturación", type: "single_select", required: true, options: FACT },
    { id: "2", key: "comentario", label: "Comentario", type: "text", required: false },
    { id: "3", key: "nota", label: "Nota", type: "nps", required: true, min: 0, max: 10 },
  ];

  it("nace APAGADA, atada al formulario, con un Condiciones y tres emails vacíos", async () => {
    const db = setup({ fields });
    const out = await createFormFlowFromTemplate({ formId: FORM, template: "email_by_answer", questionKey: "facturacion" });
    expect(out).toEqual({ ok: true, flowId: FLOW });
    const row = db.writesTo("flows")[0].values as { status: string; form_id: string; name: string; nodes: Array<{ type: string; data: Record<string, unknown> }>; edges: Array<{ sourceHandle?: string }> };
    expect(row).toMatchObject({ status: "draft", form_id: FORM, name: "Aplicación · Email distinto según una respuesta" });
    expect(row.nodes.filter((n) => n.type === "branch")).toHaveLength(1);
    expect(row.nodes.filter((n) => n.data.actionType === "send_email")).toHaveLength(3);
    expect(row.edges.map((e) => e.sourceHandle).filter(Boolean)).toContain("else");
    // Nace apagada: no escribe ningun trigger.
    expect(db.writesTo("triggers")).toEqual([]);
    // Y el editor de pasos la abre.
    expect(flowToTree(row.nodes as never, row.edges as never)).not.toBeNull();
  });

  it("una pregunta numérica arma los umbrales", async () => {
    const db = setup({ fields });
    await createFormFlowFromTemplate({ formId: FORM, template: "email_by_answer", questionKey: "nota" });
    const row = db.writesTo("flows")[0].values as { nodes: Array<{ type: string; data: { paths?: Array<{ conditions: Array<{ operator: string; value: string }> }> } }> };
    const paths = row.nodes.find((n) => n.type === "branch")!.data.paths!;
    expect(paths.map((p) => [p.conditions[0].operator, p.conditions[0].value])).toEqual([["gte", "7"], ["gte", "3"]]);
  });

  it("pide la pregunta", async () => {
    const db = setup({ fields });
    expect((await createFormFlowFromTemplate({ formId: FORM, template: "email_by_answer" })).ok).toBe(false);
    expect(db.writes()).toEqual([]);
  });

  it("una pregunta que no sirve (texto) o que no existe no se acepta", async () => {
    const db = setup({ fields });
    expect((await createFormFlowFromTemplate({ formId: FORM, template: "email_by_answer", questionKey: "comentario" })).ok).toBe(false);
    expect((await createFormFlowFromTemplate({ formId: FORM, template: "email_by_answer", questionKey: "no_existe" })).ok).toBe(false);
    expect(db.writes()).toEqual([]);
  });

  it("un formulario sin preguntas no se acepta", async () => {
    setup();
    expect(await createFormFlowFromTemplate({ formId: FORM, template: "email_by_answer", questionKey: "x" })).toEqual({ ok: false, error: expect.stringMatching(/pregunta/) });
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
  it("sin Resend conectado, un flujo con «Enviar email» NO se prende y no escribe nada (G1)", async () => {
    const db = setup({ resend: false });
    const out = await toggleFormFlow({ flowId: FLOW, enabled: true });
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining("Email saliente (Resend)") });
    expect(db.writes()).toHaveLength(0);
  });
  it("con Resend conectado, el mismo flujo se prende sin tocarlo (G1)", async () => {
    setup({ resend: true });
    expect(await toggleFormFlow({ flowId: FLOW, enabled: true })).toEqual({ ok: true });
  });
  it("apagar un flujo siempre se puede, aunque falte una conexion (G1)", async () => {
    const db = setup({ resend: false });
    expect(await toggleFormFlow({ flowId: FLOW, enabled: false })).toEqual({ ok: true });
    expect(db.writesTo("flows")[0].values).toEqual({ status: "draft" });
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

describe("saveFormFlowTree", () => {
  const graph = () => formTemplateGraph("notify_me_email", { form: { id: FORM, name: "Aplicación", type: "custom" }, userEmail: "yo@ejemplo.com" });
  const steps = () => flowToTree(graph().nodes, graph().edges)!.steps;
  const rule = { rootConjunction: "and", conditions: [{ id: "c_1", fieldKey: "edad", operator: "gte", value: "18" }], groups: [] };
  const branch = {
    kind: "branch" as const,
    id: "b1",
    data: {},
    paths: [{ id: "p_aaaaaa", label: "A", logic: "and" as const, conditions: [{ field: "answer.x", operator: "is", valueType: "single_select" as const, value: "A" }], steps: [] }],
    otherwise: [],
  };

  it("guarda el arbol como grafo: Condiciones con sus salidas, y conserva los ids", async () => {
    const db = setup();
    expect(await saveFormFlowTree({ flowId: FLOW, tree: { steps: [...steps(), branch] } })).toEqual({ ok: true });
    const row = db.writesTo("flows")[0].values as { nodes: Array<{ id: string; type: string }>; edges: Array<{ source: string; sourceHandle?: string }> };
    expect(row.nodes.map((n) => n.id)).toEqual(["trigger", "step-1", "b1"]);
    expect(row.nodes.find((n) => n.id === "b1")?.type).toBe("branch");
    expect(row.edges.filter((e) => e.source === "b1")).toEqual([]);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "form", entityId: FORM }));
  });

  it("el disparador sale de la base y el 'Solo si…' se guarda en el mismo formato", async () => {
    const db = setup();
    await saveFormFlowTree({ flowId: FLOW, tree: { steps: steps() }, answerConditions: rule });
    const nodes = (db.writesTo("flows")[0].values as { nodes: Array<{ id: string; data: Record<string, unknown> }> }).nodes;
    expect(nodes[0].data).toMatchObject({ triggerType: "form_submitted", form_ids: [FORM], answer_conditions: rule });
  });

  it("sin answerConditions no toca el 'Solo si…' que ya habia", async () => {
    const g = graph();
    (g.nodes[0].data as Record<string, unknown>).answer_conditions = rule;
    const db = setup({ flow: { nodes: g.nodes, edges: g.edges } });
    await saveFormFlowTree({ flowId: FLOW, tree: { steps: steps() } });
    const nodes = (db.writesTo("flows")[0].values as { nodes: Array<{ data: Record<string, unknown> }> }).nodes;
    expect(nodes[0].data.answer_conditions).toEqual(rule);
  });

  it("un 'Solo si…' invalido no se guarda", async () => {
    const db = setup();
    const out = await saveFormFlowTree({ flowId: FLOW, tree: { steps: steps() }, answerConditions: { rootConjunction: "xor", conditions: [], groups: [] } });
    expect(out.ok).toBe(false);
    expect(db.writes()).toHaveLength(0);
  });

  it("se niega si el grafo guardado no es un arbol", async () => {
    const g = blankFormFlowGraph({ id: FORM, type: "custom" });
    const nodes = [...g.nodes, { id: "a", type: "action", data: { actionType: "addTag" } }, { id: "b", type: "action", data: { actionType: "addTag" } }];
    const edges = [{ id: "e1", source: "trigger", target: "a" }, { id: "e2", source: "trigger", target: "b" }];
    const db = setup({ flow: { nodes, edges } });
    const out = await saveFormFlowTree({ flowId: FLOW, tree: { steps: [] } });
    expect(out).toEqual({ ok: false, error: expect.stringMatching(/canvas/) });
    expect(db.writes()).toHaveLength(0);
  });

  it("valida el arbol: un paso que Formularios no ofrece no se guarda", async () => {
    const db = setup();
    const out = await saveFormFlowTree({ flowId: FLOW, tree: { steps: [{ kind: "action", id: "x", nodeType: "action", data: { actionType: "cancel_booking", status: "cancelled_other" } }] } });
    expect(out.ok).toBe(false);
    expect(db.writes()).toHaveLength(0);
  });

  it("si estaba encendido, rehace el trigger activo (como las acciones lineales)", async () => {
    const db = setup({ flow: { status: "published" } });
    await saveFormFlowTree({ flowId: FLOW, tree: { steps: steps() } });
    expect(db.writesTo("triggers").some((c) => c.op === "delete")).toBe(true);
    const inserted = db.writesTo("triggers").find((c) => c.op === "insert")!.values as Array<Record<string, unknown>>;
    expect(inserted[0]).toMatchObject({ type: "form_submitted", is_active: true, workspace_id: "ws1" });
  });

  it("apagado no toca los triggers", async () => {
    const db = setup();
    await saveFormFlowTree({ flowId: FLOW, tree: { steps: steps() } });
    expect(db.writesTo("triggers")).toHaveLength(0);
  });

  it("sin permiso, nada; de otro workspace o de otro formulario, nada", async () => {
    mocks.permission.mockResolvedValue(null);
    expect((await saveFormFlowTree({ flowId: FLOW, tree: { steps: [] } })).ok).toBe(false);
    const other = setup({ flow: { workspace_id: "otro" } });
    expect((await saveFormFlowTree({ flowId: FLOW, tree: { steps: [] } })).ok).toBe(false);
    expect(other.writes()).toHaveLength(0);
    const noForm = setup({ flow: { form_id: null } });
    expect((await saveFormFlowTree({ flowId: FLOW, tree: { steps: [] } })).ok).toBe(false);
    expect(noForm.writes()).toHaveLength(0);
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
