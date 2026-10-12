/**
 * "Probar condiciones" tiene que decir lo MISMO que hace el motor: este test
 * corre el nodo `branch` de verdad (con el motor, sobre la base en memoria) y
 * la explicacion con los mismos datos, y compara el camino. Si alguien cambia
 * uno sin el otro, esto se pone en rojo.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { executeFlow } from "@/lib/flow-engine/engine";
import type { BranchCondition, BranchPath } from "@/lib/flow-engine/condition-eval";
import { flowToTree } from "./step-tree";
import { explainPaths } from "./explain-paths";
import { testValuesFromSubmission } from "./test-values";

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
  await import("@/lib/flow-engine/registry");
});

const WS = "ws-1";
const FACT = ["Menos de USD 1.000", "USD 1.000 a USD 10.000", "Más de USD 10.000"];
const FORM_FIELDS = [
  { key: "facturacion", type: "single_select" },
  { key: "edad", type: "number" },
  { key: "intereses", type: "multi_select" },
  { key: "nombre", type: "text" },
];

const cond = (field: string, operator: string, valueType: BranchCondition["valueType"], extra: Partial<BranchCondition> = {}): BranchCondition => ({ field, operator, valueType, ...extra });
const pathOf = (id: string, label: string, conditions: BranchCondition[], logic: "and" | "or" = "and"): BranchPath => ({ id, label, logic, conditions });

const PATHS: BranchPath[] = [
  pathOf("p_gone01", "Pregunta borrada", [cond("answer.borrada", "is_empty", "text")]),
  pathOf("p_alta01", "Alta y adulta", [cond("answer.facturacion", "is", "single_select", { value: FACT[2] }), cond("answer.edad", "gte", "number", { value: "30" })]),
  pathOf("p_seo001", "Le interesa SEO o Ads", [cond("answer.intereses", "includes_any", "multi_select", { values: ["seo", "ads"] })]),
  pathOf("p_joven1", "Joven", [cond("answer.edad", "between", "number", { value: "18", value2: "29" })]),
  pathOf("p_nonom1", "Sin nombre", [cond("answer.nombre", "is_empty", "text")]),
  pathOf("p_score1", "Puntaje alto", [cond("submission.score", "gte", "number", { value: "9" })], "or"),
  pathOf("p_notfac", "Facturación no es la baja", [cond("answer.facturacion", "is_not", "single_select", { value: FACT[0] })]),
];

function graph() {
  const nodes = [
    { id: "trigger", type: "trigger", data: { triggerType: "survey_answered" }, position: { x: 0, y: 0 } },
    { id: "branch", type: "branch", data: { label: "Según respuesta", paths: PATHS }, position: { x: 0, y: 160 } },
    ...PATHS.map((p) => ({ id: `n_${p.id}`, type: "action", data: { actionType: "addTag", tagName: p.label }, position: { x: 0, y: 320 } })),
    { id: "n_else", type: "action", data: { actionType: "addTag", tagName: "else" }, position: { x: 0, y: 320 } },
  ];
  const edges = [
    { id: "e0", source: "trigger", target: "branch" },
    ...PATHS.map((p) => ({ id: `e_${p.id}`, source: "branch", target: `n_${p.id}`, sourceHandle: p.id })),
    { id: "e_else", source: "branch", target: "n_else", sourceHandle: "else" },
  ];
  return { nodes, edges };
}

interface Case {
  name: string;
  answers: Record<string, { value: unknown }>;
  score?: number | null;
}

const CASES: Case[] = [
  { name: "no respondio nada", answers: {} },
  { name: "alta y de 40", answers: { facturacion: { value: FACT[2] }, edad: { value: 40 }, nombre: { value: "Ana" } } },
  { name: "alta pero de 20 (cae en Joven o antes)", answers: { facturacion: { value: FACT[2] }, edad: { value: 20 }, nombre: { value: "Ana" } } },
  { name: "intereses con seo", answers: { facturacion: { value: FACT[0] }, intereses: { value: ["seo"] }, nombre: { value: "Ana" } } },
  { name: "intereses sin match", answers: { facturacion: { value: FACT[0] }, intereses: { value: ["otro"] }, nombre: { value: "Ana" } } },
  { name: "edad como texto no numerico", answers: { facturacion: { value: FACT[0] }, edad: { value: "abc" }, nombre: { value: "Ana" } } },
  { name: "nombre vacio", answers: { facturacion: { value: FACT[0] }, nombre: { value: "" } } },
  { name: "puntaje 9", answers: { facturacion: { value: FACT[0] }, nombre: { value: "Ana" } }, score: 9 },
  { name: "puntaje 0 no es «sin puntaje»", answers: { facturacion: { value: FACT[0] }, nombre: { value: "Ana" } }, score: 0 },
  { name: "facturacion media, todo lo demas contesta", answers: { facturacion: { value: FACT[1] }, nombre: { value: "Ana" } } },
  { name: "una respuesta con una pregunta que ya no esta", answers: { facturacion: { value: FACT[0] }, nombre: { value: "Ana" }, vieja: { value: "x" } } },
];

async function realPath(testCase: Case): Promise<string> {
  const { nodes, edges } = graph();
  const db = memoryDb({
    flows: [{ id: "flow-1", workspace_id: WS, status: "published", nodes, edges }],
    channels: [],
    conversations: [],
    flow_sessions: [],
    analytics_events: [],
    contacts: [{ id: "c-1", workspace_id: WS, contact_tags: [] }],
    form_versions: [{ id: "v1", definition: { fields: FORM_FIELDS } }],
    form_submissions: [{ id: "sub-1", workspace_id: WS, form_version_id: "v1", answers: testCase.answers }],
  });
  await executeFlow(db.client, {
    triggerId: "tr-1",
    flowId: "flow-1",
    channelId: "",
    contactId: "c-1",
    conversationId: "",
    workspaceId: WS,
    incomingMessage: {},
    // Como las deja el disparador del formulario: todo texto (el puntaje, vacio si no hay).
    variables: { submission: { id: "sub-1", score: testCase.score === null || testCase.score === undefined ? "" : String(testCase.score) } },
  });
  const trail = db.rows("analytics_events").filter((e) => e.event_type === "node_executed").map((e) => String((e.metadata as { nodeId: string }).nodeId));
  const last = trail[trail.length - 1];
  return last.replace(/^n_/, "");
}

describe("Probar condiciones elige el mismo camino que el motor", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", async (_name, testCase) => {
    const { nodes, edges } = graph();
    const tree = flowToTree(nodes as never, edges as never);
    expect(tree, "el grafo tiene que ser un arbol").not.toBeNull();

    const values = testValuesFromSubmission({
      fields: FORM_FIELDS,
      answers: testCase.answers,
      formName: "Aplicación",
      score: testCase.score,
    });
    const explained = explainPaths(tree!, values, []);
    expect(explained.branches).toHaveLength(1);
    expect(explained.branches[0].takenPathId).toBe(await realPath(testCase));
  });

  it("los casos cubren caminos distintos (si todos cayeran en el mismo, la paridad no probaria nada)", async () => {
    const taken = new Set<string>();
    for (const c of CASES) taken.add(await realPath(c));
    expect(taken.size).toBeGreaterThanOrEqual(5);
  });
});
