/**
 * El nodo `branch` ("Condiciones"), probado con el MOTOR de verdad (sobre la
 * base en memoria): el motor sigue `handle:<id>` y este test mira por donde
 * paso. Los demas nodos se reemplazan por uno que no hace nada: aca importa el
 * recorrido, no lo que hace cada accion.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { executeFlow } from "../engine";
import { branchNode } from "./branch";
import { conditionToBranch } from "../convert-condition";
import type { BranchCondition, BranchPath } from "../condition-eval";
import { CONDITION_CASES, contactWith, context as caseContext, fakeSupabase } from "./condition-fixtures";
import type { FlowNode } from "../types";

vi.mock("@/lib/flow-engine/registry", async () => {
  const actual = await vi.importActual<typeof import("@/lib/flow-engine/registry")>("@/lib/flow-engine/registry");
  return {
    ...actual,
    getNode: (node: { type: string; data?: unknown }) => {
      const real = actual.getNode(node as never);
      if (!real) return undefined;
      return real.type === "branch" ? real : { type: "noop", label: "noop", execute: async () => undefined };
    },
  };
});

beforeAll(async () => {
  await import("../registry");
});

const WS = "ws-1";
const FACT = ["Menos de USD 1.000", "USD 1.000 a USD 10.000", "Más de USD 10.000"];

const isOpt = (id: string, label: string, value: string, field = "answer.facturacion"): BranchPath => ({
  id,
  label,
  logic: "and",
  conditions: [{ field, operator: "is", value, valueType: "single_select" }],
});

const PATH_A = isOpt("p_aaaaaa", "Alta", FACT[2]);
const PATH_B = isOpt("p_bbbbbb", "Media", FACT[1]);
// C se cumple con la misma respuesta que B: tiene que ganar B (va primero).
const PATH_C: BranchPath = { id: "p_cccccc", label: "Media también", logic: "or", conditions: [{ field: "answer.facturacion", operator: "is_any_of", values: [FACT[1], FACT[0]], valueType: "single_select" }] };

function world(opts: { answer?: unknown; paths?: BranchPath[]; elseNode?: boolean; contact?: Record<string, unknown> | null } = {}) {
  const paths = opts.paths ?? [PATH_A, PATH_B, PATH_C];
  const elseNode = opts.elseNode ?? true;
  const nodes = [
    { id: "trigger", type: "trigger", data: { triggerType: "form_submitted" }, position: { x: 0, y: 0 } },
    { id: "branch", type: "branch", data: { label: "Según facturación", paths }, position: { x: 0, y: 160 } },
    ...paths.map((p) => ({ id: `n_${p.id}`, type: "action", data: { actionType: "addTag", tagName: p.label }, position: { x: 0, y: 320 } })),
    ...(elseNode ? [{ id: "n_else", type: "action", data: { actionType: "addTag", tagName: "else" }, position: { x: 0, y: 320 } }] : []),
  ];
  const edges = [
    { id: "e0", source: "trigger", target: "branch" },
    ...paths.map((p) => ({ id: `e_${p.id}`, source: "branch", target: `n_${p.id}`, sourceHandle: p.id })),
    ...(elseNode ? [{ id: "e_else", source: "branch", target: "n_else", sourceHandle: "else" }] : []),
  ];
  const db = memoryDb({
    flows: [{ id: "flow-1", workspace_id: WS, status: "published", nodes, edges }],
    channels: [],
    conversations: [],
    flow_sessions: [],
    analytics_events: [],
    contacts: opts.contact === null ? [] : [{ id: "c-1", workspace_id: WS, contact_tags: [], ...(opts.contact ?? {}) }],
    form_versions: [{ id: "v1", definition: { fields: [{ key: "facturacion", type: "single_select" }, { key: "edad", type: "number" }] } }],
    form_submissions: [{ id: "sub-1", workspace_id: WS, form_version_id: "v1", answers: opts.answer === undefined ? {} : { facturacion: { value: opts.answer } } }],
  });
  return db;
}

async function run(db: MemoryDb, variables: Record<string, unknown> = { submission: { id: "sub-1" } }) {
  await executeFlow(db.client, {
    triggerId: "tr-1",
    flowId: "flow-1",
    channelId: "",
    contactId: "c-1",
    conversationId: "",
    workspaceId: WS,
    incomingMessage: {},
    variables,
  });
  const trail = db.rows("analytics_events").filter((e) => e.event_type === "node_executed").map((e) => String((e.metadata as { nodeId: string }).nodeId));
  return { trail, events: db.rows("analytics_events"), session: db.rows("flow_sessions")[0] };
}

describe("el motor sigue el camino que elige el branch", () => {
  it("con una respuesta que cumple B y C, va por B (el primero, en orden)", async () => {
    const { trail } = await run(world({ answer: FACT[1] }));
    expect(trail).toEqual(["branch", "n_p_bbbbbb"]);
  });

  it("si cumple el primero, va por el primero", async () => {
    expect((await run(world({ answer: FACT[2] }))).trail).toEqual(["branch", "n_p_aaaaaa"]);
  });

  it("si solo cumple el ultimo, va por el ultimo", async () => {
    expect((await run(world({ answer: FACT[0] }))).trail).toEqual(["branch", "n_p_cccccc"]);
  });

  it("si ninguno se cumple, va por «Si no»", async () => {
    expect((await run(world({ answer: "otra cosa" }))).trail).toEqual(["branch", "n_else"]);
  });

  it("una pregunta sin responder no cumple `is` y cae en «Si no»", async () => {
    expect((await run(world({}))).trail).toEqual(["branch", "n_else"]);
  });

  it("«Si no» sin pasos termina la sesion sin error", async () => {
    const { trail, session, events } = await run(world({ answer: "otra cosa", elseNode: false }));
    expect(trail).toEqual(["branch"]);
    expect(session.status).toBe("completed");
    expect(events.map((e) => e.event_type)).toContain("flow_completed");
  });

  it("un camino sin pasos tampoco rompe: termina", async () => {
    const db = world({ answer: FACT[2] });
    db.tables.flows[0].edges = (db.tables.flows[0].edges as Array<{ id: string }>).filter((e) => e.id !== "e_p_aaaaaa");
    const { trail, session } = await run(db);
    expect(trail).toEqual(["branch"]);
    expect(session.status).toBe("completed");
  });
});

describe("un campo que no se puede leer: no se cumple y el flujo sigue", () => {
  const goneCondition: BranchCondition = { field: "answer.borrada", operator: "is_empty", valueType: "text" };

  it("la pregunta ya no existe en la version de esa respuesta: ese camino no se cumple y se sigue con el siguiente", async () => {
    const paths: BranchPath[] = [{ id: "p_gone01", label: "Borrada", logic: "and", conditions: [goneCondition] }, PATH_A];
    const { trail, events } = await run(world({ answer: FACT[2], paths }));
    expect(trail).toEqual(["branch", "n_p_aaaaaa"]);
    const taken = events.find((e) => e.event_type === "branch_taken")!;
    expect((taken.metadata as { checks: unknown[] }).checks[0]).toMatchObject({ pathId: "p_gone01", field: "answer.borrada", ok: false, missing: true });
  });

  it("si la base falla al leer la respuesta, tampoco lanza: va por «Si no»", async () => {
    const db = world({ answer: FACT[2] });
    const loose = db.client as unknown as { from: (t: string) => unknown };
    const original = loose.from.bind(db.client);
    loose.from = (table: string) => {
      if (table === "form_submissions") throw new Error("se cayo la base");
      return original(table);
    };
    const { trail, events } = await run(db);
    expect(trail).toEqual(["branch", "n_else"]);
    const taken = events.find((e) => e.event_type === "branch_taken")!;
    expect((taken.metadata as { checks: unknown[] }).checks[0]).toMatchObject({ ok: false, error: true });
  });

  it("datos del nodo rotos (sin caminos, o sin lista de condiciones) van por «Si no» sin lanzar", async () => {
    for (const data of [undefined, {}, { paths: null }, { paths: [{ id: "p_x", label: "x", logic: "and" }] }] as unknown[]) {
      const { client } = fakeSupabase(contactWith());
      const result = await branchNode.execute({
        supabase: client,
        node: { id: "b", type: "branch", data: {}, position: { x: 0, y: 0 } } as unknown as FlowNode,
        data: data as never,
        context: caseContext(),
        sessionId: "s",
        runtime: { executeFlow: async () => undefined },
      });
      // Un camino sin lista de condiciones con `and` queda vacio y se cumple: es el unico que no cae en else.
      expect(["handle:else", "handle:p_x"]).toContain(result);
    }
  });

  it("si no se puede anotar el camino, igual devuelve el camino", async () => {
    const { client } = fakeSupabase(contactWith());
    const loose = client as unknown as { from: (t: string) => unknown };
    const original = loose.from.bind(client);
    loose.from = (table: string) => {
      if (table === "analytics_events") throw new Error("sin base");
      return original(table);
    };
    const result = await branchNode.execute({
      supabase: client,
      node: { id: "b", type: "branch", data: {}, position: { x: 0, y: 0 } } as unknown as FlowNode,
      data: { paths: [{ id: "p_si0001", label: "Si", logic: "and", conditions: [{ field: "platform", operator: "is", value: "whatsapp", valueType: "text" }] }] },
      context: caseContext(),
      sessionId: "s",
      runtime: { executeFlow: async () => undefined },
    });
    expect(result).toBe("handle:p_si0001");
  });
});

describe("branch_taken: el camino sin los valores", () => {
  it("anota el nodo, la sesion, el camino y cada condicion mirada; nunca la respuesta", async () => {
    const { events, session } = await run(world({ answer: FACT[1] }));
    const taken = events.filter((e) => e.event_type === "branch_taken");
    expect(taken).toHaveLength(1);
    expect(taken[0]).toMatchObject({ workspace_id: WS, flow_id: "flow-1", contact_id: "c-1" });
    expect(taken[0].metadata).toEqual({
      nodeId: "branch",
      sessionId: session.id,
      pathId: "p_bbbbbb",
      pathLabel: "Media",
      checks: [
        { pathId: "p_aaaaaa", field: "answer.facturacion", operator: "is", ok: false },
        { pathId: "p_bbbbbb", field: "answer.facturacion", operator: "is", ok: true },
      ],
    });
    // Ni el texto de la respuesta ni sus opciones aparecen en lo que se guarda.
    const raw = JSON.stringify(taken[0].metadata);
    for (const text of FACT) expect(raw).not.toContain(text);
  });

  it("por «Si no» anota `else` y el nombre «Si no»", async () => {
    const { events } = await run(world({ answer: "nada" }));
    const meta = events.find((e) => e.event_type === "branch_taken")!.metadata as { pathId: string; pathLabel: string };
    expect(meta).toMatchObject({ pathId: "else", pathLabel: "Si no" });
  });
});

describe("carga lo justo: cada cosa una sola vez y solo si hace falta", () => {
  async function tablesRead(db: MemoryDb, variables?: Record<string, unknown>) {
    const loose = db.client as unknown as { from: (t: string) => unknown };
    const original = loose.from.bind(db.client);
    const reads: string[] = [];
    loose.from = (table: string) => {
      reads.push(table);
      return original(table);
    };
    await run(db, variables);
    return reads;
  }

  it("solo con respuestas del formulario, no lee el contacto", async () => {
    const reads = await tablesRead(world({ answer: FACT[2] }));
    expect(reads.filter((t) => t === "contacts")).toHaveLength(0);
    expect(reads.filter((t) => t === "form_submissions")).toHaveLength(1);
  });

  it("con un campo del contacto, lo lee una vez y la respuesta, otra", async () => {
    const paths: BranchPath[] = [
      { id: "p_tag001", label: "VIP", logic: "and", conditions: [{ field: "contact.tags", operator: "includes", value: "vip", valueType: "multi_select" }, { field: "contact.tags", operator: "not_includes", value: "frio", valueType: "multi_select" }] },
      PATH_A,
    ];
    const db = world({ answer: FACT[2], paths, contact: { contact_tags: [{ tag_id: "t", tags: { name: "vip" } }] } });
    const reads = await tablesRead(db);
    expect(reads.filter((t) => t === "contacts")).toHaveLength(1);
  });

  it("un campo que miran dos caminos se resuelve una sola vez", async () => {
    const reads = await tablesRead(world({ answer: FACT[0] }));
    // PATH_A, PATH_B y PATH_C miran `answer.facturacion`: una sola lectura de la respuesta.
    expect(reads.filter((t) => t === "form_submissions")).toHaveLength(1);
    expect(reads.filter((t) => t === "form_versions")).toHaveLength(1);
  });

  it("los campos del contacto con un tipo (tags, temperatura) comparan el valor real", async () => {
    const paths: BranchPath[] = [
      { id: "p_hot001", label: "Caliente y VIP", logic: "and", conditions: [{ field: "contact.lead_temperature", operator: "is", value: "hot", valueType: "single_select" }, { field: "contact.tags", operator: "includes_any", values: ["vip", "premium"], valueType: "multi_select" }] },
    ];
    const hot = world({ paths, elseNode: true, contact: { lead_temperature: "hot", contact_tags: [{ tag_id: "1", tags: { name: "premium" } }] } });
    expect((await run(hot)).trail).toEqual(["branch", "n_p_hot001"]);
    const cold = world({ paths, elseNode: true, contact: { lead_temperature: "cold", contact_tags: [{ tag_id: "1", tags: { name: "premium" } }] } });
    expect((await run(cold)).trail).toEqual(["branch", "n_else"]);
  });

  it("sin contacto, los campos que no lo necesitan igual deciden, y los que si, no se cumplen", async () => {
    const db = world({ answer: FACT[2], contact: null });
    expect((await run(db)).trail).toEqual(["branch", "n_p_aaaaaa"]);
    const needs: BranchPath[] = [{ id: "p_tag002", label: "VIP", logic: "and", conditions: [{ field: "contact.tags", operator: "includes", value: "vip", valueType: "multi_select" }] }];
    expect((await run(world({ paths: needs, contact: null }))).trail).toEqual(["branch", "n_else"]);
  });

  it("un numero de la respuesta se compara como numero", async () => {
    const paths: BranchPath[] = [{ id: "p_edad01", label: "Mayor", logic: "and", conditions: [{ field: "answer.edad", operator: "gt", value: "9", valueType: "number" }] }];
    const db = world({ paths });
    db.rows("form_submissions")[0].answers = { edad: { value: 12 } };
    expect((await run(db)).trail).toEqual(["branch", "n_p_edad01"]);
  });
});

describe("Convertir a Condiciones: la misma tabla de contextos da las mismas salidas", () => {
  // El nodo viejo devuelve `false` cuando no hay contacto, aunque no haya NADA que comparar.
  // El branch, sin condiciones, no necesita el contacto y se cumple (`and` vacio). Es la unica
  // diferencia, y solo para un nodo sin condiciones y sin contacto (una situacion que no se da:
  // el motor siempre corre sobre un contacto). Queda anotada en docs/PROGRESS-automatizaciones-condiciones.md.
  const DOCUMENTED_DIFFERENCE = "sin contacto y sin condiciones: `false`";

  it.each(CONDITION_CASES.filter((c) => c.name !== DOCUMENTED_DIFFERENCE))("$name", async ({ conditions, logic, ctx, contact, enrollments, out }) => {
    const oldNode = { id: "c", type: "condition", position: { x: 0, y: 0 }, data: { conditions, logic } };
    const converted = conditionToBranch(oldNode, [], { pathId: "p_si0001" });
    const { client } = fakeSupabase(contact === undefined ? contactWith() : contact, enrollments);
    const result = await branchNode.execute({
      supabase: client,
      node: converted.node as unknown as FlowNode,
      data: converted.node.data,
      context: ctx ?? caseContext(),
      sessionId: "s",
      runtime: { executeFlow: async () => undefined },
    });
    // true -> el camino convertido; false -> «Si no».
    expect(result).toBe(out === "handle:true" ? "handle:p_si0001" : "handle:else");
  });

  it("la diferencia documentada: sin contacto y sin condiciones el nodo viejo da false y el branch se cumple", async () => {
    const converted = conditionToBranch({ id: "c", type: "condition", data: { conditions: [], logic: "and" } }, [], { pathId: "p_si0001" });
    const { client } = fakeSupabase(null);
    const result = await branchNode.execute({ supabase: client, node: converted.node as unknown as FlowNode, data: converted.node.data, context: caseContext(), sessionId: "s", runtime: { executeFlow: async () => undefined } });
    expect(result).toBe("handle:p_si0001");
  });
});
