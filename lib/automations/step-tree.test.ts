/**
 * El modelo de arbol de pasos. Lo mas importante de la rama: si la ida y vuelta
 * grafo ↔ arbol pierde o cambia algo, guardar desde el editor rompe un flujo.
 */
import { describe, it, expect, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { FLOW_TEMPLATES, templateGraph } from "@/lib/scheduling/automation/templates";
import { FORM_FLOW_TEMPLATES, formTemplateGraph, blankFormFlowGraph } from "@/lib/forms/automation/templates";
import type { CanvasEdge, CanvasNode } from "@/lib/scheduling/automation/linear-flow";
import { flowToLinear } from "@/lib/scheduling/automation/linear-flow";
import { executeFlow } from "@/lib/flow-engine/engine";
import { BRANCH_ELSE_HANDLE } from "@/lib/flow-engine/branch-paths";
import {
  InvalidTreeError,
  MAX_BRANCH_DEPTH,
  allIds,
  allSteps,
  branchDepth,
  describeTree,
  findStep,
  firstEmailStep,
  flowToTree,
  gateToBranch,
  newStepId,
  treeShapeProblems,
  treeToFlow,
  upstreamNodesOf,
  type ActionStep,
  type BranchPathStep,
  type BranchStep,
  type GateStep,
  type Step,
  type StepTree,
} from "./step-tree";

// El motor pide los nodos al registro: cada nodo REGISTRADO se vuelve un "no hace nada"
// (aca importa POR DONDE pasa, no lo que hace). El `branch` y el `condition` se
// reemplazan abajo por uno que elige la salida que el test le diga.
const route = vi.hoisted(() => ({ choose: {} as Record<string, string> }));
vi.mock("@/lib/flow-engine/registry", async () => {
  const actual = await vi.importActual<typeof import("@/lib/flow-engine/registry")>("@/lib/flow-engine/registry");
  return {
    ...actual,
    getNode: (node: { id?: string; type: string; data?: unknown }) => {
      if (!actual.getNode(node as never)) return undefined;
      const choice = node.id ? route.choose[node.id] : undefined;
      return { type: "noop", label: "noop", execute: async () => (choice ? `handle:${choice}` : undefined) };
    },
  };
});

// ------------------------------------------------------------
// Constructores de arboles
// ------------------------------------------------------------

const trigger = { id: "trigger", data: { triggerType: "form_submitted", form_ids: ["f1"], answer_conditions: { rootConjunction: "and", conditions: [], groups: [] } } };

const email = (id: string, extra: Record<string, unknown> = {}): ActionStep => ({
  kind: "action",
  id,
  nodeType: "action",
  data: { actionType: "send_email", to: "contact", subject: `Asunto ${id}`, body: `Cuerpo ${id}`, ...extra },
});
const tag = (id: string, name = "vip"): ActionStep => ({ kind: "action", id, nodeType: "action", data: { actionType: "addTag", tagName: name } });
const wait = (id: string): ActionStep => ({ kind: "action", id, nodeType: "delay", data: { duration: 2, unit: "hours" } });
const message = (id: string): ActionStep => ({ kind: "action", id, nodeType: "sendMessage", data: { messages: [{ text: "Hola" }], onlyIfPhone: true } });

const cond = (field: string, value: string) => ({ field, operator: "is", valueType: "single_select" as const, value });
const path = (id: string, label: string, steps: Step[] = [], conditions = [cond("answer.facturacion", label)]): BranchPathStep => ({ id, label, logic: "and", conditions, steps });
const branch = (id: string, paths: BranchPathStep[], otherwise: Step[] = [], data: Record<string, unknown> = {}): BranchStep => ({ kind: "branch", id, data, paths, otherwise });
const gate = (id: string, steps: Step[]): GateStep => ({ kind: "gate", id, data: { conditions: [{ field: "tag:vip", operator: "equals", value: "true" }], logic: "and" }, steps });
const tree = (steps: Step[]): StepTree => ({ trigger, steps });

const TREES: Record<string, StepTree> = {
  "0 niveles, vacio": tree([]),
  "0 niveles, tres pasos": tree([email("a"), wait("b"), tag("c")]),
  "1 nivel: dos caminos y Si no": tree([email("a"), branch("b1", [path("p_aaaaaa", "A", [email("x"), tag("y")]), path("p_bbbbbb", "B", [email("z")])], [email("w")], { label: "Según facturación" })]),
  "1 nivel: Si no vacio y un camino vacio": tree([branch("b1", [path("p_aaaaaa", "A"), path("p_bbbbbb", "B", [wait("z")])])]),
  "2 niveles": tree([
    branch("b1", [path("p_aaaaaa", "A", [email("a1"), branch("b2", [path("p_cccccc", "C", [tag("c1")]), path("p_dddddd", "D")], [email("d0")])]), path("p_bbbbbb", "B")], [message("m1")]),
  ]),
  "3 niveles": tree([
    branch("b1", [path("p_aaaaaa", "A", [branch("b2", [path("p_cccccc", "C", [branch("b3", [path("p_eeeeee", "E", [email("deep")]), path("p_ffffff", "F")], [tag("deep2")])])], [])]), path("p_bbbbbb", "B")]),
  ]),
  "un Si plano": tree([email("a"), gate("g", [email("b"), tag("c")])]),
  "un Si adentro de un camino": tree([branch("b1", [path("p_aaaaaa", "A", [gate("g", [email("x")])])], [tag("t")])]),
  "Condiciones adentro de un Si": tree([gate("g", [branch("b1", [path("p_aaaaaa", "A", [email("x")])], [email("y")])])]),
};

describe("ida y vuelta EXACTA: flowToTree(treeToFlow(t)) == t", () => {
  it.each(Object.entries(TREES))("%s", (_name, t) => {
    const flow = treeToFlow(t);
    expect(flowToTree(flow.nodes, flow.edges)).toEqual(t);
  });

  it("y es estable: una segunda vuelta no cambia el grafo", () => {
    for (const t of Object.values(TREES)) {
      const first = treeToFlow(t);
      const second = treeToFlow(flowToTree(first.nodes, first.edges)!);
      expect(second).toEqual(first);
    }
  });

  it("el arbol de 3 niveles tiene profundidad 3 y el limite es 3", () => {
    expect(MAX_BRANCH_DEPTH).toBe(3);
    expect(branchDepth(TREES["3 niveles"].steps)).toBe(3);
    expect(branchDepth(TREES["0 niveles, tres pasos"].steps)).toBe(0);
    expect(branchDepth(TREES["Condiciones adentro de un Si"].steps)).toBe(1);
  });

  it("flowToTree no comparte referencias con el grafo que recibe", () => {
    const flow = treeToFlow(TREES["1 nivel: dos caminos y Si no"]);
    const back = flowToTree(flow.nodes, flow.edges)!;
    (back.steps[0] as ActionStep).data.subject = "cambiado";
    expect((flow.nodes.find((n) => n.id === "a")!.data as { subject: string }).subject).toBe("Asunto a");
  });
});

describe("treeToFlow: ids, datos y conexiones", () => {
  it("conserva el id de cada paso y el tipo del nodo", () => {
    const flow = treeToFlow(TREES["1 nivel: dos caminos y Si no"]);
    expect(flow.nodes.map((n) => n.id).sort()).toEqual(["a", "b1", "trigger", "w", "x", "y", "z"]);
    expect(flow.nodes.find((n) => n.id === "b1")!.type).toBe("branch");
    expect(flow.nodes.find((n) => n.id === "a")!.type).toBe("action");
    expect(flow.nodes.find((n) => n.id === "trigger")!.type).toBe("trigger");
  });

  it("cada camino sale por SU id y 'Si no' por else", () => {
    const flow = treeToFlow(TREES["1 nivel: dos caminos y Si no"]);
    const out = flow.edges.filter((e) => e.source === "b1").map((e) => [e.sourceHandle, e.target]);
    expect(out).toEqual([["p_aaaaaa", "x"], ["p_bbbbbb", "z"], [BRANCH_ELSE_HANDLE, "w"]]);
  });

  it("el nodo Condiciones guarda sus caminos SIN los pasos, y el resto de sus datos", () => {
    const node = treeToFlow(TREES["1 nivel: dos caminos y Si no"]).nodes.find((n) => n.id === "b1")!;
    const data = node.data as { label: string; paths: Array<Record<string, unknown>> };
    expect(data.label).toBe("Según facturación");
    expect(data.paths.map((p) => Object.keys(p).sort())).toEqual([["conditions", "id", "label", "logic"], ["conditions", "id", "label", "logic"]]);
  });

  it("guarda node.data ENTERO: no se pierde onlyIfPhone ni fixedEmail (lo que perdia el editor lineal)", () => {
    const t = tree([message("m"), email("e", { to: "fixed", fixedEmail: "yo@ejemplo.com", cosaNueva: { x: 1 } })]);
    const flow = treeToFlow(t);
    expect(flow.nodes.find((n) => n.id === "m")!.data).toEqual({ messages: [{ text: "Hola" }], onlyIfPhone: true });
    expect(flow.nodes.find((n) => n.id === "e")!.data).toMatchObject({ to: "fixed", fixedEmail: "yo@ejemplo.com", cosaNueva: { x: 1 } });
  });

  it("el 'Si' sale por true (el editor lineal viejo lo escribia sin salida y el motor se cortaba ahi)", () => {
    const flow = treeToFlow(TREES["un Si plano"]);
    const out = flow.edges.find((e) => e.source === "g")!;
    expect(out).toMatchObject({ sourceHandle: "true", target: "b" });
    expect(flow.nodes.find((n) => n.id === "g")!.type).toBe("condition");
  });

  it("un id en blanco o repetido recibe uno nuevo, sin pisar el de otro paso", () => {
    const t = tree([email(""), email("b"), email("b"), email("")]);
    const ids = treeToFlow(t, () => 0.42).nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(5);
    expect(ids).toContain("trigger");
    expect(ids.filter((i) => i === "b")).toHaveLength(1);
  });

  it("un arbol con pasos despues de Condiciones no tiene forma de grafo", () => {
    const bad = tree([branch("b1", [path("p_aaaaaa", "A")]), email("despues")]);
    expect(treeShapeProblems(bad)[0]).toMatch(/adentro/);
    expect(() => treeToFlow(bad)).toThrow(InvalidTreeError);
  });

  it("mas de 3 niveles tampoco", () => {
    const deep = tree([branch("1", [path("p_aaaaaa", "A", [branch("2", [path("p_bbbbbb", "B", [branch("3", [path("p_cccccc", "C", [branch("4", [path("p_dddddd", "D")])])])])])])])]);
    expect(treeShapeProblems(deep).join(" ")).toMatch(/3 niveles/);
  });

  it("newStepId no repite", () => {
    const id = newStepId(["s_aaaaaaaa"], () => 0);
    expect(id).toMatch(/^s_[a-z0-9]{8}$/);
    expect(newStepId([id], () => 0)).not.toBe(id);
  });
});

describe("layout", () => {
  const positions = (t: StepTree) => Object.fromEntries(treeToFlow(t).nodes.map((n) => [n.id, n.position!]));

  it("una lista lineal baja de a 160 en una sola columna (como siempre)", () => {
    const p = positions(TREES["0 niveles, tres pasos"]);
    expect(p).toMatchObject({ trigger: { x: 0, y: 0 }, a: { x: 0, y: 160 }, b: { x: 0, y: 320 }, c: { x: 0, y: 480 } });
  });

  it("los caminos van de izquierda a derecha en orden y 'Si no' queda a la derecha de todos", () => {
    const p = positions(TREES["1 nivel: dos caminos y Si no"]);
    expect(p.x.x).toBeLessThan(p.z.x);
    expect(p.z.x).toBeLessThan(p.w.x);
    // Condiciones queda centrado sobre sus tres columnas.
    expect(p.b1.x).toBe(p.z.x);
  });

  it("los pasos de adentro quedan debajo del nodo Condiciones", () => {
    const p = positions(TREES["2 niveles"]);
    for (const id of ["a1", "b2", "c1", "d0", "m1"]) expect(p[id].y, id).toBeGreaterThan(p.b1.y);
    expect(p.c1.y).toBeGreaterThan(p.b2.y);
  });

  it("ningun par de nodos cae en el mismo lugar, en ningun arbol", () => {
    for (const [name, t] of Object.entries(TREES)) {
      const seen = new Set<string>();
      for (const n of treeToFlow(t).nodes) {
        const key = `${n.position!.x},${n.position!.y}`;
        expect(seen.has(key), `${name}: ${n.id} cae en ${key}`).toBe(false);
        seen.add(key);
      }
    }
  });

  it("el layout no cambia lo que el arbol dice", () => {
    for (const t of Object.values(TREES)) {
      const flow = treeToFlow(t);
      expect(flowToTree(flow.nodes, flow.edges)).toEqual(t);
    }
  });
});

// ------------------------------------------------------------
// Lo que NO es un arbol
// ------------------------------------------------------------

const T: CanvasNode = { id: "t", type: "trigger", data: { triggerType: "form_submitted" } };
const act = (id: string, actionType = "addTag"): CanvasNode => ({ id, type: "action", data: { actionType, tagName: id } });
const edge = (source: string, target: string, sourceHandle?: string): CanvasEdge => ({ id: `${source}-${target}-${sourceHandle ?? ""}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) });
const cnd = (id = "c"): CanvasNode => ({ id, type: "condition", data: { conditions: [{ field: "tag:vip", operator: "equals", value: "true" }], logic: "and" } });
const brn = (id = "b", paths = [{ id: "p_aaaaaa", label: "A", logic: "and", conditions: [] }]): CanvasNode => ({ id, type: "branch", data: { paths } });

describe("flowToTree: devuelve null cuando no es un arbol", () => {
  it("sin disparador", () => expect(flowToTree([act("a")], [])).toBeNull());

  it("una fusion: dos caminos que se vuelven a juntar", () => {
    const nodes = [T, brn(), act("x"), act("y"), act("fin")];
    const edges = [edge("t", "b"), edge("b", "x", "p_aaaaaa"), edge("b", "y", "else"), edge("x", "fin"), edge("y", "fin")];
    expect(flowToTree(nodes, edges)).toBeNull();
  });

  it("un ciclo", () => {
    expect(flowToTree([T, act("a"), act("b")], [edge("t", "a"), edge("a", "b"), edge("b", "a")])).toBeNull();
    expect(flowToTree([T, act("a")], [edge("t", "a"), edge("a", "a")])).toBeNull();
  });

  it("un nodo suelto (huerfano)", () => {
    expect(flowToTree([T, act("a"), act("huerfano")], [edge("t", "a")])).toBeNull();
  });

  it("una conexion a un nodo que no existe, o desde uno que no existe", () => {
    expect(flowToTree([T, act("a")], [edge("t", "a"), edge("a", "fantasma")])).toBeNull();
    expect(flowToTree([T, act("a")], [edge("t", "a"), edge("fantasma", "a")])).toBeNull();
  });

  it("un A/B split (como nodo o como accion)", () => {
    const ab: CanvasNode = { id: "ab", type: "action", data: { actionType: "abSplit" } };
    expect(flowToTree([T, ab, act("a")], [edge("t", "ab"), edge("ab", "a")])).toBeNull();
    expect(flowToTree([T, { id: "ab", type: "abSplit", data: {} }, act("a")], [edge("t", "ab"), edge("ab", "a")])).toBeNull();
  });

  it("un condition con dos salidas", () => {
    expect(flowToTree([T, cnd(), act("a"), act("b")], [edge("t", "c"), edge("c", "a", "true"), edge("c", "b", "false")])).toBeNull();
  });

  it("un condition cuya unica salida es la de 'No'", () => {
    expect(flowToTree([T, cnd(), act("a")], [edge("t", "c"), edge("c", "a", "false")])).toBeNull();
    expect(flowToTree([T, cnd(), act("a")], [edge("t", "c"), edge("c", "a", "no")])).toBeNull();
  });

  it("un nodo comun con dos salidas (el motor solo sigue la primera)", () => {
    expect(flowToTree([T, act("a"), act("b"), act("c")], [edge("t", "a"), edge("a", "b"), edge("a", "c")])).toBeNull();
  });

  it("Condiciones con una salida sin camino, sin salida declarada, o repetida", () => {
    expect(flowToTree([T, brn(), act("x")], [edge("t", "b"), edge("b", "x", "p_inexistente")])).toBeNull();
    expect(flowToTree([T, brn(), act("x")], [edge("t", "b"), edge("b", "x")])).toBeNull();
    expect(flowToTree([T, brn(), act("x"), act("y")], [edge("t", "b"), edge("b", "x", "p_aaaaaa"), edge("b", "y", "p_aaaaaa")])).toBeNull();
  });

  it("Condiciones con caminos mal formados (sin id, repetidos, con un id reservado, sin lista)", () => {
    const mal = (paths: unknown) => flowToTree([T, { id: "b", type: "branch", data: { paths } }], [edge("t", "b")]);
    expect(mal([{ label: "sin id" }])).toBeNull();
    expect(mal([{ id: "p_aaaaaa" }, { id: "p_aaaaaa" }])).toBeNull();
    expect(mal([{ id: "else" }])).toBeNull();
    expect(mal([{ id: "true" }])).toBeNull();
    expect(mal("no es una lista")).toBeNull();
  });

  it("un segundo disparador, o dos nodos con el mismo id", () => {
    expect(flowToTree([T, { id: "t2", type: "trigger", data: {} }], [edge("t", "t2")])).toBeNull();
    expect(flowToTree([T, act("a"), act("a")], [edge("t", "a")])).toBeNull();
  });

  it("mas de 3 niveles de Condiciones", () => {
    const level = (n: number): CanvasNode => ({ id: `b${n}`, type: "branch", data: { paths: [{ id: `p_level${n}`, label: `N${n}`, logic: "and", conditions: [] }] } });
    const nodes = [T, level(1), level(2), level(3), level(4)];
    const edges = [edge("t", "b1"), edge("b1", "b2", "p_level1"), edge("b2", "b3", "p_level2"), edge("b3", "b4", "p_level3")];
    expect(flowToTree(nodes, edges)).toBeNull();
    // Con tres niveles, si.
    expect(flowToTree(nodes.slice(0, 4), edges.slice(0, 3))).not.toBeNull();
  });

  it("un condition o un branch escondido dentro de un 'action' no se abre", () => {
    expect(flowToTree([T, act("a", "condition")], [edge("t", "a")])).toBeNull();
    expect(flowToTree([T, act("a", "branch")], [edge("t", "a")])).toBeNull();
  });
});

describe("flowToTree: los flujos viejos", () => {
  it("un flujo lineal se lee como un arbol sin Condiciones, con los mismos pasos en el mismo orden", () => {
    const nodes = [T, act("a", "addTag"), { id: "d", type: "delay", data: { duration: 1, unit: "hours" } }, act("e", "send_email")];
    const edges = [edge("t", "a"), edge("a", "d"), edge("d", "e")];
    const t = flowToTree(nodes, edges)!;
    expect(t.steps.map((s) => [s.kind, s.id])).toEqual([["action", "a"], ["action", "d"], ["action", "e"]]);
    expect(allSteps(t).some((s) => s.kind === "branch")).toBe(false);
    // Lo mismo que veia el editor lineal.
    expect(flowToLinear(nodes, edges)!.steps).toHaveLength(3);
  });

  it("un 'Si' guardado por el editor lineal viejo (sin salida declarada) se lee como un Si y se escribe con true", () => {
    const nodes = [T, cnd(), act("a")];
    const edges = [edge("t", "c"), edge("c", "a")]; // sin sourceHandle
    const t = flowToTree(nodes, edges)!;
    expect(t.steps).toMatchObject([{ kind: "gate", id: "c", steps: [{ kind: "action", id: "a" }] }]);
    expect(treeToFlow(t).edges.find((e) => e.source === "c")!.sourceHandle).toBe("true");
  });

  it("un Si con la salida 'yes' (el alias viejo) tambien", () => {
    expect(flowToTree([T, cnd(), act("a")], [edge("t", "c"), edge("c", "a", "yes")])).not.toBeNull();
  });

  it("un Si sin nada despues es un Si vacio", () => {
    expect(flowToTree([T, cnd()], [edge("t", "c")])!.steps).toMatchObject([{ kind: "gate", steps: [] }]);
  });

  it("el flujo en blanco de Formularios es solo el disparador", () => {
    const g = blankFormFlowGraph({ id: "f1", type: "custom" });
    const t = flowToTree(g.nodes, g.edges)!;
    expect(t.steps).toEqual([]);
    expect(treeToFlow(t).nodes).toHaveLength(1);
  });

  it("un nodo que el editor no conoce se conserva como accion, con su tipo y sus datos", () => {
    const nodes = [T, { id: "x", type: "algoNuevo", data: { cosa: 1 } } as CanvasNode];
    const t = flowToTree(nodes, [edge("t", "x")])!;
    expect(t.steps).toEqual([{ kind: "action", id: "x", nodeType: "algoNuevo", data: { cosa: 1 } }]);
    expect(treeToFlow(t).nodes[1]).toMatchObject({ id: "x", type: "algoNuevo", data: { cosa: 1 } });
  });
});

// ------------------------------------------------------------
// Los 7 de la Agenda y las 4 plantillas de Formularios
// ------------------------------------------------------------

const FORM = { id: "11111111-1111-4111-8111-111111111111", name: "Aplicacion", type: "custom" as const };
const SURVEY = { ...FORM, type: "survey" as const };

const GRAPHS: Array<{ name: string; graph: { nodes: CanvasNode[]; edges: CanvasEdge[] } }> = [
  ...FLOW_TEMPLATES.map((t) => ({ name: `agenda/${t.key}`, graph: templateGraph(t, "ev-1") })),
  ...FORM_FLOW_TEMPLATES.map((t) => ({
    name: `formularios/${t.key}`,
    graph: formTemplateGraph(t.key, { form: t.key === "detractor_alert" ? SURVEY : FORM, userEmail: "yo@ejemplo.com", tagName: "calificado" }),
  })),
];

async function engineTrail(graph: { nodes: CanvasNode[]; edges: CanvasEdge[] }): Promise<string[]> {
  const db = memoryDb({
    flows: [{ id: "flow-1", workspace_id: "ws-1", status: "published", nodes: graph.nodes, edges: graph.edges }],
    channels: [],
    conversations: [],
    flow_sessions: [],
    analytics_events: [],
  });
  await executeFlow(db.client, {
    triggerId: "tr-1",
    flowId: "flow-1",
    channelId: "",
    contactId: "c-1",
    conversationId: "",
    workspaceId: "ws-1",
    incomingMessage: {},
    variables: {},
  });
  return db
    .rows("analytics_events")
    .filter((e) => e.event_type === "node_executed")
    .map((e) => String((e.metadata as { nodeId: string }).nodeId));
}

const edgeTriples = (g: { edges: CanvasEdge[] }) => g.edges.map((e) => `${e.source}>${e.target}:${e.sourceHandle ?? ""}`).sort();

describe("los flujos precreados (Agenda y Formularios) abren como arbol y se guardan igual", () => {
  it("son 11", () => expect(GRAPHS).toHaveLength(11));

  it.each(GRAPHS.map((g) => [g.name, g.graph] as const))("%s: abre como arbol, sin Condiciones", (_name, graph) => {
    const t = flowToTree(graph.nodes, graph.edges);
    expect(t).not.toBeNull();
    expect(allSteps(t!).every((s) => s.kind === "action")).toBe(true);
  });

  it.each(GRAPHS.map((g) => [g.name, g.graph] as const))("%s: conserva ids, tipos y datos de cada nodo (y el onlyIfPhone)", (_name, graph) => {
    const back = treeToFlow(flowToTree(graph.nodes, graph.edges)!);
    const original = new Map(graph.nodes.map((n) => [n.id, n]));
    expect(back.nodes.map((n) => n.id).sort()).toEqual([...original.keys()].sort());
    for (const node of back.nodes) {
      const was = original.get(node.id)!;
      expect(node.type).toBe(was.type);
      expect(node.data).toEqual(was.data ?? {});
    }
  });

  it.each(GRAPHS.map((g) => [g.name, g.graph] as const))("%s: las mismas conexiones", (_name, graph) => {
    const back = treeToFlow(flowToTree(graph.nodes, graph.edges)!);
    expect(edgeTriples(back)).toEqual(edgeTriples(graph));
  });

  it.each(GRAPHS.map((g) => [g.name, g.graph] as const))("%s: el motor recorre lo mismo, en el mismo orden", async (_name, graph) => {
    const back = treeToFlow(flowToTree(graph.nodes, graph.edges)!);
    expect(await engineTrail(back)).toEqual(await engineTrail(graph));
    expect((await engineTrail(back)).length).toBeGreaterThan(0);
  });

  it("los mensajes de gracias y de 1 h conservan onlyIfPhone (lo que se perdia al guardar)", () => {
    for (const { name, graph } of GRAPHS) {
      const original = graph.nodes.find((n) => n.type === "sendMessage");
      if (!original) continue;
      const back = treeToFlow(flowToTree(graph.nodes, graph.edges)!).nodes.find((n) => n.id === original.id)!;
      expect((back.data as { onlyIfPhone?: boolean }).onlyIfPhone, name).toBe(true);
    }
  });
});

describe("el motor sigue las salidas del arbol", () => {
  it("por el camino que elige el nodo, y por Si no cuando no se cumple ninguno", async () => {
    const t = tree([branch("b1", [path("p_aaaaaa", "A", [tag("a1")]), path("p_bbbbbb", "B", [tag("b1x")])], [tag("e1")])]);
    const flow = treeToFlow(t);
    route.choose = { b1: "p_bbbbbb" };
    expect(await engineTrail(flow)).toEqual(["b1", "b1x"]);
    route.choose = { b1: "p_aaaaaa" };
    expect(await engineTrail(flow)).toEqual(["b1", "a1"]);
    route.choose = { b1: "else" };
    expect(await engineTrail(flow)).toEqual(["b1", "e1"]);
    route.choose = {};
  });

  it("un Si: por true sigue, por false termina (y ya no se corta antes de tiempo)", async () => {
    const flow = treeToFlow(TREES["un Si plano"]);
    route.choose = { g: "true" };
    expect(await engineTrail(flow)).toEqual(["a", "g", "b", "c"]);
    route.choose = { g: "false" };
    expect(await engineTrail(flow)).toEqual(["a", "g"]);
    route.choose = {};
  });
});

// ------------------------------------------------------------
// Convertir un Si en Condiciones, recorrer y resumir
// ------------------------------------------------------------

describe("gateToBranch", () => {
  it("un camino 'Si' con las condiciones tal cual, los mismos pasos, el mismo id y un Si no vacio", () => {
    const g = gate("g", [email("b"), tag("c")]);
    const b = gateToBranch(g, { pathId: "p_xxxxxx" });
    expect(b).toMatchObject({ kind: "branch", id: "g", otherwise: [] });
    expect(b.paths).toEqual([{ id: "p_xxxxxx", label: "Si", logic: "and", conditions: [{ field: "tag:vip", operator: "equals", value: "true" }], steps: [email("b"), tag("c")] }]);
    expect(b.data).toEqual({});
  });

  it("sin logic 'and' se comporta como 'o' (igual que el nodo viejo) y conserva el nombre del nodo", () => {
    const b = gateToBranch({ kind: "gate", id: "g", data: { label: "VIP?", conditions: [] }, steps: [] });
    expect(b.paths[0].logic).toBe("or");
    expect(b.data).toEqual({ label: "VIP?" });
  });

  it("lee las condiciones que el editor lineal viejo guardo como texto JSON", () => {
    const c = { field: "tag:vip", operator: "equals", value: "true" };
    const b = gateToBranch({ kind: "gate", id: "g", data: { conditions: [JSON.stringify(c), "no es json"], logic: "and" }, steps: [] });
    expect(b.paths[0].conditions).toEqual([c]);
  });

  it("el resultado vuelve a ser un grafo valido y el 'Si' sale por el camino", () => {
    const t = tree([gateToBranch(gate("g", [email("b")]), { pathId: "p_xxxxxx" })]);
    const flow = treeToFlow(t);
    expect(flow.edges.find((e) => e.source === "g")).toMatchObject({ sourceHandle: "p_xxxxxx", target: "b" });
    expect(flowToTree(flow.nodes, flow.edges)).toEqual(t);
  });
});

describe("recorrer", () => {
  const t = TREES["2 niveles"];

  it("allSteps va en orden de lectura e incluye los de adentro", () => {
    expect(allSteps(t).map((s) => s.id)).toEqual(["b1", "a1", "b2", "c1", "d0", "m1"]);
    expect(allIds(t)[0]).toBe("trigger");
  });

  it("findStep", () => {
    expect(findStep(t, "c1")?.kind).toBe("action");
    expect(findStep(t, "nada")).toBeUndefined();
  });

  it("los pasos de antes: solo los de su mismo camino, nunca los del camino de al lado", () => {
    const withHttp = tree([
      { kind: "action", id: "h", nodeType: "action", data: { actionType: "httpRequest", responseVariable: "crm" } },
      branch("b1", [path("p_aaaaaa", "A", [{ kind: "action", id: "ai", nodeType: "aiResponse", data: {} }, email("e1")]), path("p_bbbbbb", "B", [email("e2")])]),
    ]);
    expect(upstreamNodesOf(withHttp, "e1").map((n) => n.id)).toEqual(["h", "ai"]);
    expect(upstreamNodesOf(withHttp, "e2").map((n) => n.id)).toEqual(["h"]);
    expect(upstreamNodesOf(withHttp, "b1").map((n) => n.id)).toEqual(["h"]);
    expect(upstreamNodesOf(withHttp, "h")).toEqual([]);
  });

  it("firstEmailStep: el primero en orden de lectura, adentro de un camino si es el primero", () => {
    expect(firstEmailStep(TREES["1 nivel: dos caminos y Si no"])?.id).toBe("a");
    expect(firstEmailStep(tree([branch("b", [path("p_aaaaaa", "A", [email("dentro")])])]))?.id).toBe("dentro");
    expect(firstEmailStep(tree([tag("t")]))).toBeUndefined();
  });
});

describe("describeTree", () => {
  it("'Cuando se envía · 2 caminos + si no · 3 emails'", () => {
    const t = tree([branch("b1", [path("p_aaaaaa", "A", [email("x")]), path("p_bbbbbb", "B", [email("z")])], [email("w")])]);
    expect(describeTree(t)).toBe("Cuando se envía · 2 caminos + si no · 3 emails");
  });

  it("un flujo lineal no habla de caminos", () => {
    expect(describeTree(tree([email("a")]))).toBe("Cuando se envía · 1 email");
    expect(describeTree(tree([email("a"), message("m"), tag("t")]))).toBe("Cuando se envía · 1 email · 1 mensaje");
    expect(describeTree(tree([tag("a"), wait("b")]))).toBe("Cuando se envía · 2 pasos");
    expect(describeTree(tree([]))).toBe("Cuando se envía · sin pasos");
  });

  it("cuenta los caminos de todos los niveles y el 'Cuando' se puede pisar", () => {
    expect(describeTree(TREES["2 niveles"], { when: "Al enviar «Aplicación»" })).toBe("Al enviar «Aplicación» · 4 caminos + si no · 2 emails · 1 mensaje");
  });

  it("la Agenda y un disparador desconocido tienen su frase", () => {
    expect(describeTree({ trigger: { id: "t", data: { triggerType: "booking_created" } }, steps: [] })).toBe("Cuando se agenda · sin pasos");
    expect(describeTree({ trigger: { id: "t", data: {} }, steps: [] })).toBe("Cuando se dispara · sin pasos");
  });
});
