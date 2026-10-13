import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { getNode, getNodeByType, listTriggers, resolveNodeType } from "@/lib/flow-engine/registry";
import { buildDesiredTriggers } from "@/lib/flow-triggers";
import { publishFlow } from "@/lib/flow-engine/publish";
import { SALES_TEMPLATE_KEYS } from "@/lib/sales/automation/templates";
import { salesVariables } from "@/lib/sales/automation/variables";
import {
  ensureTaskPaymentFlows,
  getPaymentTasksState,
  PAYMENT_TASK_SOURCE_KEY,
  TASK_PAYMENT_TEMPLATE_KEYS,
  TASK_PAYMENT_TEMPLATES,
  taskFlowProblems,
  taskPaymentTemplateByKey,
} from "./automation-templates";

const WS = "ws-1";

function world(flows: Array<Record<string, unknown>> = []) {
  return memoryDb(
    { flows, flow_versions: [], triggers: [], workspaces: [{ id: WS }] },
    { generated: { flows: (row) => { row.version ??= 0; row.channel_id ??= null; } } },
  );
}

const overdue = TASK_PAYMENT_TEMPLATES[0];
const close = TASK_PAYMENT_TEMPLATES[1];

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("las plantillas de cobranza con tareas (R5)", () => {
  it("son dos, con claves propias que NO se mezclan con las de «Crear flujos de cobranza»", () => {
    expect(TASK_PAYMENT_TEMPLATE_KEYS).toEqual(["task_payment_overdue", "task_payment_paid_close"]);
    for (const key of TASK_PAYMENT_TEMPLATE_KEYS) expect((SALES_TEMPLATE_KEYS as readonly string[]).includes(key)).toBe(false);
    expect(taskPaymentTemplateByKey("task_payment_overdue")?.name).toBe("Cobranza · Tarea al vencer un pago");
    expect(taskPaymentTemplateByKey("task_payment_paid_close")?.name).toBe("Cobranza · Cerrar la tarea al cobrar");
    expect(taskPaymentTemplateByKey("otra")).toBeUndefined();
  });

  it("los grafos son validos y pasan la validacion de publicacion", () => {
    for (const t of TASK_PAYMENT_TEMPLATES) expect(taskFlowProblems(t.nodes, t.edges), t.key).toEqual([]);
  });

  it("un grafo roto se detecta", () => {
    expect(taskFlowProblems([{ id: "a", type: "action", data: { actionType: "inventado" } }], []).length).toBeGreaterThan(0);
    expect(taskFlowProblems([{ id: "t", type: "trigger", data: { triggerType: "no_existe" } }], [])).toContain("El disparador no existe.");
    expect(taskFlowProblems([], [])).toContain("El flujo tiene que tener un solo disparador.");
    expect(taskFlowProblems(overdue.nodes, [{ id: "x", source: "trigger", target: "no-esta" }])).toContain("Hay una conexión a un paso que no existe.");
  });

  it("el disparador y los nodos existen en el registro", () => {
    expect(listTriggers().map((t) => t.type)).toContain("payment_status_changed");
    const create = overdue.nodes[1];
    const complete = close.nodes[1];
    expect(resolveNodeType(create as never)).toBe("create_task");
    expect(resolveNodeType(complete as never)).toBe("complete_task");
    expect(getNode(create as never)).toBeDefined();
    expect(getNodeByType("complete_task")).toBeDefined();
  });

  it("los disparadores salen como payment_status_changed con to_status overdue y paid", () => {
    const a = buildDesiredTriggers(overdue.nodes as never, "f1");
    const b = buildDesiredTriggers(close.nodes as never, "f2");
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ type: "payment_status_changed", config: { to_status: ["overdue"] } });
    expect(b[0]).toMatchObject({ type: "payment_status_changed", config: { to_status: ["paid"] } });
  });

  it("el paso de crear usa lo que pide el requerimiento", () => {
    expect(overdue.nodes[1].data).toMatchObject({
      actionType: "create_task",
      title: "Cobrar cuota de {{contact.first_name}} · {{sale.product_name}}",
      owner: "seller",
      dueMode: "days",
      dueDays: 0,
      priority: "high",
      project: "Cobranza",
      sourceKey: "payment:{{payment.id}}",
    });
    expect(overdue.nodes[1].data.description).toContain("{{payment.amount}}");
    expect(overdue.nodes[1].data.description).toContain("{{payment.due_date}}");
    expect(close.nodes[1].data).toMatchObject({ actionType: "complete_task", sourceKey: PAYMENT_TASK_SOURCE_KEY });
  });

  it("las variables que usan las plantillas existen en las de un evento de pago", () => {
    const vars = salesVariables({
      sale: { id: "s", status: "active", final_amount: 100, product_snapshot: { product_name: "Mentoría" }, attribution: {}, attribution_type: "organic", vendedor_id: null, setter_id: null },
      payment: { id: "p1", amount: 100, due_date: "2026-10-12", payment_method: null, status: "overdue" },
      contact: { display_name: "Ana Pérez" },
      event: { payment_id: "p1", sale_id: "s" },
    }) as unknown as Record<string, Record<string, string>>;
    const used = new Set<string>();
    for (const t of TASK_PAYMENT_TEMPLATES) {
      for (const n of t.nodes) {
        for (const v of Object.values(n.data)) {
          if (typeof v === "string") for (const m of v.matchAll(/\{\{([\w.]+)\}\}/g)) used.add(m[1]);
        }
      }
    }
    expect([...used].sort()).toEqual(["contact.first_name", "payment.amount", "payment.due_date", "payment.id", "sale.product_name"]);
    for (const path of used) {
      const [group, name] = path.split(".");
      expect(vars[group]?.[name], path).toBeTruthy();
    }
  });
});

describe("estado del interruptor (se lee del flujo)", () => {
  it("sin flujos: apagado", async () => {
    expect(await getPaymentTasksState(world().client, WS)).toEqual({ enabled: false, flows: [] });
  });
  it("con los flujos en borrador: apagado", async () => {
    const db = world([{ id: "a", workspace_id: WS, name: overdue.name, status: "draft", template_key: "task_payment_overdue" }]);
    expect((await getPaymentTasksState(db.client, WS)).enabled).toBe(false);
  });
  it("con el flujo que crea la tarea publicado: prendido", async () => {
    const db = world([{ id: "a", workspace_id: WS, name: overdue.name, status: "published", template_key: "task_payment_overdue" }]);
    const state = await getPaymentTasksState(db.client, WS);
    expect(state.enabled).toBe(true);
    expect(state.flows).toEqual([{ key: "task_payment_overdue", id: "a", name: overdue.name, status: "published" }]);
  });
  it("ignora los flujos de otros workspaces y los de otras plantillas", async () => {
    const db = world([
      { id: "a", workspace_id: "otro", name: "x", status: "published", template_key: "task_payment_overdue" },
      { id: "b", workspace_id: WS, name: "y", status: "published", template_key: "payment_reminder_3d" },
    ]);
    expect((await getPaymentTasksState(db.client, WS)).enabled).toBe(false);
  });
});

describe("ensureTaskPaymentFlows", () => {
  it("prender: crea y publica los dos flujos, con sus disparadores", async () => {
    const db = world();
    const res = await ensureTaskPaymentFlows(db.client, WS, { enabled: true, userId: "u-1" });
    expect(res.ok).toBe(true);
    expect(res.state.enabled).toBe(true);
    expect(db.rows("flows")).toHaveLength(2);
    expect(db.rows("flows").every((f) => f.status === "published" && f.version === 1)).toBe(true);
    expect(db.rows("flows").map((f) => f.template_key).sort()).toEqual([...TASK_PAYMENT_TEMPLATE_KEYS].sort());
    expect(db.rows("triggers").map((t) => t.type)).toEqual(["payment_status_changed", "payment_status_changed"]);
    expect(db.rows("triggers").every((t) => t.is_active === true)).toBe(true);
    expect(db.rows("flow_versions")).toHaveLength(2);
    expect(db.rows("flow_versions")[0].published_by).toBe("u-1");
  });

  it("es idempotente: prender dos veces no duplica flujos, disparadores ni versiones", async () => {
    const db = world();
    await ensureTaskPaymentFlows(db.client, WS, { enabled: true });
    await ensureTaskPaymentFlows(db.client, WS, { enabled: true });
    expect(db.rows("flows")).toHaveLength(2);
    expect(db.rows("triggers")).toHaveLength(2);
    expect(db.rows("flow_versions")).toHaveLength(2);
    expect(db.rows("flows").every((f) => f.version === 1)).toBe(true);
  });

  it("apagar: pasa los flujos a borrador, saca sus disparadores y NO los borra", async () => {
    const db = world();
    await ensureTaskPaymentFlows(db.client, WS, { enabled: true });
    const res = await ensureTaskPaymentFlows(db.client, WS, { enabled: false });
    expect(res.ok && !res.state.enabled).toBe(true);
    expect(db.rows("flows")).toHaveLength(2);
    expect(db.rows("flows").every((f) => f.status === "draft")).toBe(true);
    expect(db.rows("triggers")).toHaveLength(0);
  });

  it("apagar sin haberlo prendido no crea nada", async () => {
    const db = world();
    const res = await ensureTaskPaymentFlows(db.client, WS, { enabled: false });
    expect(res.ok).toBe(true);
    expect(db.rows("flows")).toHaveLength(0);
  });

  it("volver a prender despues de apagar vuelve a publicar los mismos flujos", async () => {
    const db = world();
    await ensureTaskPaymentFlows(db.client, WS, { enabled: true });
    await ensureTaskPaymentFlows(db.client, WS, { enabled: false });
    const res = await ensureTaskPaymentFlows(db.client, WS, { enabled: true });
    expect(res.ok && res.state.enabled).toBe(true);
    expect(db.rows("flows")).toHaveLength(2);
    expect(db.rows("triggers")).toHaveLength(2);
  });

  it("NO pisa un grafo que la persona edito: solo cambia el estado", async () => {
    const db = world();
    await ensureTaskPaymentFlows(db.client, WS, { enabled: true });
    const edited = db.rows("flows").find((f) => f.template_key === "task_payment_overdue")!;
    const mine = (edited.nodes as Array<{ id: string; data: Record<string, unknown> }>).map((n) => (n.id === "create-task" ? { ...n, data: { ...n.data, priority: "urgent", title: "Cobrar YA" } } : n));
    edited.nodes = mine;
    await ensureTaskPaymentFlows(db.client, WS, { enabled: false });
    await ensureTaskPaymentFlows(db.client, WS, { enabled: true });
    const after = db.rows("flows").find((f) => f.template_key === "task_payment_overdue")!;
    expect((after.nodes as Array<{ id: string; data: Record<string, unknown> }>).find((n) => n.id === "create-task")!.data).toMatchObject({ priority: "urgent", title: "Cobrar YA" });
    expect(after.status).toBe("published");
  });

  it("si publicar falla por validacion: los dos quedan en borrador, se devuelve el motivo y el interruptor queda apagado", async () => {
    const db = world([
      { id: "ok", workspace_id: WS, name: close.name, status: "draft", template_key: "task_payment_paid_close", nodes: close.nodes, edges: close.edges },
      { id: "roto", workspace_id: WS, name: overdue.name, status: "draft", template_key: "task_payment_overdue", nodes: [{ id: "trigger", type: "trigger", data: { triggerType: "no_existe" } }], edges: [] },
    ]);
    const res = await ensureTaskPaymentFlows(db.client, WS, { enabled: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("El disparador no existe.");
    expect(res.state.enabled).toBe(false);
    expect(db.rows("flows").every((f) => f.status === "draft")).toBe(true);
    expect(db.rows("triggers")).toHaveLength(0);
  });

  it("nunca lanza: una base rota devuelve ok:false", async () => {
    const broken = { from: () => { throw new Error("la base se cayo"); } };
    const res = await ensureTaskPaymentFlows(broken as never, WS, { enabled: true });
    expect(res.ok).toBe(false);
  });
});

describe("publishFlow", () => {
  it("404 si el flujo no existe en el workspace; 400 con una validacion extra; no escribe nada", async () => {
    const db = world([{ id: "f", workspace_id: WS, name: "x", status: "draft", nodes: [], edges: [] }]);
    const base = { db: db.client, userId: null, workspaceId: WS, getServiceClient: async () => db.client };
    expect(await publishFlow({ ...base, flowId: "no-esta" })).toMatchObject({ ok: false, status: 404 });
    expect(await publishFlow({ ...base, flowId: "f", extraProblems: () => ["no"] })).toMatchObject({ ok: false, status: 400, error: "no", problems: ["no"] });
    expect(db.rows("flows")[0].status).toBe("draft");
    expect(db.rows("flow_versions")).toHaveLength(0);
  });
});
