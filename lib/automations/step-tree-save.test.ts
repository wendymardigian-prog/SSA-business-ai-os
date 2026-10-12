import { describe, it, expect } from "vitest";
import { FLOW_TEMPLATES, templateGraph } from "@/lib/scheduling/automation/templates";
import { formTemplateGraph } from "@/lib/forms/automation/templates";
import type { CanvasEdge, CanvasNode } from "@/lib/scheduling/automation/linear-flow";
import { MAX_TREE_STEPS, prepareTreeSave } from "./step-tree-save";
import { flowToTree, gateToBranch, treeToFlow, type ActionStep, type BranchStep, type Step, type StepTree } from "./step-tree";

const FORM = { id: "11111111-1111-4111-8111-111111111111", name: "Aplicacion", type: "custom" as const };
const stored = (kind: "forms" | "agenda" = "forms") =>
  kind === "forms" ? formTemplateGraph("thank_you_message", { form: FORM, userEmail: "yo@ejemplo.com" }) : templateGraph(FLOW_TEMPLATES.find((t) => t.key === "reminder_1h")!, "ev-1");

const treeOf = (g: { nodes: CanvasNode[]; edges: CanvasEdge[] }): StepTree => flowToTree(g.nodes, g.edges)!;
const email = (id: string, over: Record<string, unknown> = {}): ActionStep => ({
  kind: "action",
  id,
  nodeType: "action",
  data: { actionType: "send_email", to: "contact", subject: "Hola", body: "Cuerpo", ...over },
});
const cond = { field: "answer.facturacion", operator: "is", valueType: "single_select" as const, value: "A" };
const branch = (id: string, steps: Step[] = [], otherwise: Step[] = []): BranchStep => ({
  kind: "branch",
  id,
  data: {},
  paths: [{ id: "p_aaaaaa", label: "A", logic: "and", conditions: [cond], steps }],
  otherwise,
});

const save = (steps: Step[], opts: { screen?: "forms" | "agenda"; graph?: { nodes: CanvasNode[]; edges: CanvasEdge[] }; triggerData?: Record<string, unknown> } = {}) =>
  prepareTreeSave({ screen: opts.screen ?? "forms", stored: opts.graph ?? stored(opts.screen ?? "forms"), tree: { steps }, triggerData: opts.triggerData });

describe("prepareTreeSave: lo que se acepta", () => {
  it("guardar tal cual un flujo precreado devuelve el mismo grafo (ids, tipos y datos)", () => {
    const g = stored();
    const out = save(treeOf(g).steps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.graph.nodes.map((n) => n.id).sort()).toEqual(g.nodes.map((n) => n.id).sort());
    for (const n of g.nodes) expect(out.graph.nodes.find((x) => x.id === n.id)?.data).toEqual(n.data);
  });

  it("lo mismo en la Agenda, con onlyIfPhone", () => {
    const g = stored("agenda");
    const out = save(treeOf(g).steps, { screen: "agenda", graph: g });
    expect(out.ok && out.graph.nodes.find((n) => n.type === "sendMessage")?.data).toMatchObject({ onlyIfPhone: true });
  });

  it("un email nuevo, un camino con pasos y un 'Si no' con pasos", () => {
    const t = treeOf(stored());
    const out = save([...t.steps.slice(0, 1), branch("b1", [email("e1")], [email("e2", { subject: "Otro" })])]);
    expect(out.ok).toBe(true);
  });

  it("el disparador sale de lo guardado: lo que el navegador mande aparte se ignora", () => {
    const g = stored();
    const out = prepareTreeSave({ screen: "forms", stored: g, tree: { steps: [], trigger: { id: "otro", data: { triggerType: "contract_signed" } } } });
    expect(out.ok && out.graph.nodes[0].data).toEqual(g.nodes[0].data);
    expect(out.ok && out.graph.nodes[0].id).toBe("trigger");
  });

  it("el disparador final lo pone quien guarda (el 'Solo si…' de Formularios)", () => {
    const g = stored();
    const data = { ...(g.nodes[0].data as Record<string, unknown>), answer_conditions: { rootConjunction: "and", conditions: [], groups: [] } };
    const out = save(treeOf(g).steps, { triggerData: data });
    expect(out.ok && out.graph.nodes[0].data).toEqual(data);
  });

  it("un nombre de camino vacio pasa a ser 'Camino N'", () => {
    const b = branch("b1");
    b.paths = [{ ...b.paths[0], label: "" }, { id: "p_bbbbbb", label: "   ", logic: "and", conditions: [cond], steps: [] }];
    const out = save([b]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const saved = (out.graph.nodes.find((n) => n.id === "b1")!.data as { paths: Array<{ label: string }> }).paths;
    expect(saved.map((p) => p.label)).toEqual(["Camino 1", "Camino 2"]);
  });

  it("un Si que ya estaba se conserva, y se puede convertir en Condiciones", () => {
    const g = {
      nodes: [
        { id: "trigger", type: "trigger", data: { triggerType: "form_submitted", form_ids: [FORM.id] } },
        { id: "g", type: "condition", data: { conditions: [{ field: "tag:vip", operator: "equals", value: "true" }], logic: "and" } },
        { id: "a", type: "action", data: { actionType: "addTag", tagName: "x" } },
      ] as CanvasNode[],
      edges: [{ id: "e1", source: "trigger", target: "g" }, { id: "e2", source: "g", target: "a", sourceHandle: "true" }] as CanvasEdge[],
    };
    const t = treeOf(g);
    expect(save(t.steps, { graph: g }).ok).toBe(true);
    const converted = gateToBranch(t.steps[0] as never, { pathId: "p_xxxxxx" });
    expect(save([converted], { graph: g }).ok).toBe(true);
  });

  it("un paso que el editor no edita (una llamada HTTP) se conserva si ya estaba, igual, aunque se mueva", () => {
    const http = { id: "h", type: "action", data: { actionType: "httpRequest", url: "https://x", responseVariable: "crm" } };
    const g = {
      nodes: [{ id: "trigger", type: "trigger", data: { triggerType: "form_submitted" } }, http, { id: "a", type: "action", data: { actionType: "addTag", tagName: "x" } }] as CanvasNode[],
      edges: [{ id: "e1", source: "trigger", target: "h" }, { id: "e2", source: "h", target: "a" }] as CanvasEdge[],
    };
    const t = treeOf(g);
    expect(save(t.steps, { graph: g }).ok).toBe(true);
    expect(save([t.steps[1], t.steps[0]], { graph: g }).ok).toBe(true);
    expect(save([t.steps[1]], { graph: g }).ok).toBe(true); // y se puede borrar
  });
});

describe("prepareTreeSave: lo que se rechaza", () => {
  const reject = (out: ReturnType<typeof save>, pattern: RegExp) => {
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(pattern);
  };

  it("si lo guardado NO es un arbol, no se guarda nada", () => {
    const g = {
      nodes: [{ id: "trigger", type: "trigger", data: {} }, { id: "a", type: "action", data: { actionType: "addTag", tagName: "a" } }, { id: "b", type: "action", data: { actionType: "addTag", tagName: "b" } }] as CanvasNode[],
      edges: [{ id: "e1", source: "trigger", target: "a" }, { id: "e2", source: "trigger", target: "b" }] as CanvasEdge[],
    };
    reject(save([], { graph: g }), /canvas/);
  });

  it("un paso que no existe en esta pantalla (cancelar la reunion en Formularios)", () => {
    reject(save([{ kind: "action", id: "n", nodeType: "action", data: { actionType: "cancel_booking", status: "cancelled_other" } }]), /pantalla/);
    // En la Agenda, si.
    expect(save([{ kind: "action", id: "n", nodeType: "action", data: { actionType: "cancel_booking", status: "cancelled_other" } }], { screen: "agenda", graph: stored("agenda") }).ok).toBe(true);
  });

  it("una llamada HTTP NUEVA, o una que ya estaba pero con otros datos", () => {
    const http = (id: string, url: string): ActionStep => ({ kind: "action", id, nodeType: "action", data: { actionType: "httpRequest", url } });
    reject(save([http("nuevo", "https://malo")]), /pantalla/);
    const g = {
      nodes: [{ id: "trigger", type: "trigger", data: {} }, { id: "h", type: "action", data: { actionType: "httpRequest", url: "https://x" } }] as CanvasNode[],
      edges: [{ id: "e1", source: "trigger", target: "h" }] as CanvasEdge[],
    };
    reject(save([http("h", "https://otro")], { graph: g }), /pantalla/);
  });

  it("un tipo de nodo desconocido escondido en un paso", () => {
    reject(save([{ kind: "action", id: "n", nodeType: "inventado", data: { cosa: 1 } }]), /pantalla/);
  });

  it("un email a una direccion fija sin direccion, o a un anfitrion en Formularios", () => {
    reject(save([email("e", { to: "fixed", fixedEmail: "no-es-un-email" })]), /email/i);
    reject(save([email("e", { to: "host" })]), /Email/);
  });

  it("un tag sin nombre, una espera en cero", () => {
    reject(save([{ kind: "action", id: "t", nodeType: "action", data: { actionType: "addTag", tagName: "  " } }]), /Agregar un tag/);
    reject(save([{ kind: "action", id: "d", nodeType: "delay", data: { duration: 0, unit: "hours" } }]), /Esperar/);
  });

  it("un Si nuevo, o un Si cambiado", () => {
    const g = stored();
    const gate = { kind: "gate" as const, id: "g", data: { conditions: [], logic: "and" }, steps: [] };
    reject(save([gate], { graph: g }), /Condiciones/);
  });

  it("Condiciones mal armadas: sin condiciones, sin camino, mas de 10, ids repetidos", () => {
    const noCond = branch("b");
    noCond.paths[0].conditions = [];
    reject(save([noCond]), /condición/);
    reject(save([{ ...branch("b"), paths: [] }]), /al menos un camino/);
    const many = branch("b");
    many.paths = Array.from({ length: 11 }, (_, i) => ({ id: `p_${String(i).padStart(6, "0")}`, label: `C${i}`, logic: "and" as const, conditions: [cond], steps: [] }));
    reject(save([many]), /10/);
    const dup = branch("b");
    dup.paths = [dup.paths[0], { ...dup.paths[0], label: "B" }];
    reject(save([dup]), /mismo identificador/);
  });

  it("un camino con un id reservado (else, true)", () => {
    const b = branch("b");
    b.paths[0].id = "else";
    reject(save([b]), /reservado/);
  });

  it("pasos DESPUES de Condiciones (no hay fusion)", () => {
    reject(save([branch("b"), email("despues")]), /adentro/);
  });

  it("mas de 3 niveles", () => {
    const deep = branch("1", [branch("2", [branch("3", [branch("4")])])]);
    reject(save([deep]), /3 niveles/);
  });

  it("ids repetidos", () => {
    reject(save([email("x"), email("x")]), /mismo identificador/);
    reject(save([email("trigger")]), /mismo identificador/);
  });

  it("demasiados pasos", () => {
    reject(save(Array.from({ length: MAX_TREE_STEPS + 1 }, (_, i) => email(`e${i}`))), /pasos/);
  });

  it("basura: un kind que no existe, campos de mas en un paso, un arbol que no es un arbol", () => {
    reject(save([{ kind: "magia", id: "x" } as never]), /datos/);
    reject(save([{ ...email("x"), extra: 1 } as never]), /datos/);
    reject(prepareTreeSave({ screen: "forms", stored: stored(), tree: "hola" }), /datos/);
    reject(prepareTreeSave({ screen: "forms", stored: stored(), tree: null }), /datos/);
  });

  it("un arbol enorme", () => {
    reject(save([email("x", { body: "a".repeat(20000) }), ...Array.from({ length: 30 }, (_, i) => email(`e${i}`, { body: "a".repeat(20000) }))]), /grande/);
  });

  it("lo que devuelve siempre vuelve a abrirse como el mismo arbol", () => {
    const t = treeOf(stored());
    const out = save([...t.steps, branch("b1", [email("e1")])]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(flowToTree(out.graph.nodes, out.graph.edges)).toEqual(out.tree);
    expect(treeToFlow(out.tree)).toEqual(out.graph);
  });
});
