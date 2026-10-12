/**
 * Caracterizacion del editor lineal y del recorrido del motor ANTES de las
 * automatizaciones con caminos condicionales (nodo `branch` + editor de arbol).
 *
 * Fija, tal cual esta hoy:
 *  - los 7 flujos precreados de la Agenda y las 4 plantillas de Formularios:
 *    grafo -> `flowToLinear` -> `linearToFlow`, y el recorrido REAL del motor
 *    (los tipos de nodo siguiendo las aristas) antes y despues de esa ida y vuelta;
 *  - las formas que el editor lineal acepta o rechaza (condicion con una o dos
 *    salidas, A/B, ciclo, nodo suelto);
 *  - lo que hoy se PIERDE o se escribe mal al guardar (anotado abajo como
 *    "hoy"): el editor nuevo lo tiene que arreglar, y al hacerlo estos tests
 *    se actualizan a proposito, no por accidente;
 *  - quien importa `flowToLinear`/`linearToFlow`.
 *
 * Sin Supabase real y sin fetch: el motor corre sobre la base en memoria, con
 * los nodos reemplazados por uno que no hace nada (aca importa POR DONDE pasa
 * el motor, no lo que hace cada nodo).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { FLOW_TEMPLATES, templateGraph } from "@/lib/scheduling/automation/templates";
import { FORM_FLOW_TEMPLATES, formTemplateGraph, blankFormFlowGraph } from "@/lib/forms/automation/templates";
import * as linearModule from "@/lib/scheduling/automation/linear-flow";
import { flowToLinear, linearToFlow, type CanvasEdge, type CanvasNode } from "@/lib/scheduling/automation/linear-flow";
import { resolveNodeType } from "@/lib/flow-engine/registry";
import { executeFlow } from "@/lib/flow-engine/engine";

// El motor pide los nodos al registro. Aca cada nodo REGISTRADO se vuelve un
// "no hace nada" y uno desconocido sigue siendo desconocido (el motor lo
// saltea, igual que en produccion): lo que se mide es el recorrido.
vi.mock("@/lib/flow-engine/registry", async () => {
  const actual = await vi.importActual<typeof import("@/lib/flow-engine/registry")>("@/lib/flow-engine/registry");
  return {
    ...actual,
    getNode: (node: { type: string; data?: unknown }) =>
      actual.getNode(node as never) ? { type: "noop", label: "noop", execute: async () => undefined } : undefined,
  };
});

interface Graph {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

const FORM = { id: "11111111-1111-4111-8111-111111111111", name: "Aplicacion", type: "custom" as const };
const SURVEY = { ...FORM, type: "survey" as const };

/** Los 11 grafos de partida, con el nombre con el que se reconocen. */
const GRAPHS: Array<{ name: string; graph: Graph }> = [
  ...FLOW_TEMPLATES.map((t) => ({ name: `agenda/${t.key}`, graph: templateGraph(t, "ev-1") })),
  ...FORM_FLOW_TEMPLATES.map((t) => ({
    name: `formularios/${t.key}`,
    graph: formTemplateGraph(t.key, { form: t.key === "detractor_alert" ? SURVEY : FORM, userEmail: "yo@ejemplo.com", tagName: "calificado" }),
  })),
];

/** El tipo canonico (el del registro) de cada nodo, siguiendo la unica arista desde el trigger. */
function walkedTypes(graph: Graph): string[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  let current = graph.nodes.find((n) => n.type === "trigger");
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    out.push(current.type === "trigger" ? "trigger" : (resolveNodeType(current as never) ?? `?${current.type}`));
    const edge = graph.edges.find((e) => e.source === current!.id);
    current = edge ? byId.get(edge.target) : undefined;
  }
  return out;
}

/** El recorrido REAL del motor: los `node_executed` que deja, en orden. */
async function engineTrail(graph: Graph): Promise<string[]> {
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

describe("recorrido del motor sobre las plantillas (Agenda y Formularios)", () => {
  const EXPECTED: Record<string, string[]> = {
    "agenda/confirmation": ["trigger", "send_email"],
    "agenda/reminder_24h": ["trigger", "send_email"],
    "agenda/reminder_1h": ["trigger", "send_email", "sendMessage"],
    "agenda/rescheduled": ["trigger", "send_email"],
    "agenda/cancelled": ["trigger", "send_email"],
    "agenda/no_show": ["trigger", "send_email"],
    "agenda/thank_you": ["trigger", "delay", "send_email"],
    "formularios/notify_me_email": ["trigger", "send_email"],
    "formularios/thank_you_message": ["trigger", "sendMessage", "send_email"],
    "formularios/add_tag": ["trigger", "addTag"],
    "formularios/detractor_alert": ["trigger", "send_email"],
  };

  it("hay exactamente 11 grafos de partida (7 de la Agenda + 4 de Formularios)", () => {
    expect(GRAPHS.map((g) => g.name).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(GRAPHS.map((g) => [g.name, g.graph] as const))("%s: los tipos de nodo siguiendo las aristas", (name, graph) => {
    expect(walkedTypes(graph)).toEqual(EXPECTED[name]);
  });

  it.each(GRAPHS.map((g) => [g.name, g.graph] as const))("%s: el motor pasa por todos los nodos, en orden, sin cortarse", async (name, graph) => {
    // Los ids de las plantillas son legibles ("email", "whatsapp", "delay"): el
    // motor tiene que pasar por todos, de principio a fin.
    const expectedIds = (() => {
      const ids: string[] = [];
      let current = graph.nodes.find((n) => n.type === "trigger");
      // El motor arranca por el nodo DESPUES del trigger: el trigger no deja node_executed.
      while (current) {
        const edge = graph.edges.find((e) => e.source === current!.id);
        current = edge ? graph.nodes.find((n) => n.id === edge.target) : undefined;
        if (current) ids.push(current.id);
      }
      return ids;
    })();
    expect(expectedIds.length).toBeGreaterThan(0);
    expect(await engineTrail(graph), name).toEqual(expectedIds);
  });
});

describe("grafo -> flowToLinear -> linearToFlow (tal cual hoy)", () => {
  it.each(GRAPHS.map((g) => [g.name, g.graph] as const))("%s: ida y vuelta conserva el recorrido del motor", async (name, graph) => {
    const linear = flowToLinear(graph.nodes, graph.edges);
    expect(linear, `${name} tiene que verse como lista`).not.toBeNull();
    const back = linearToFlow(linear!);

    // Mismos tipos canonicos, en el mismo orden...
    expect(walkedTypes(back)).toEqual(walkedTypes(graph));
    // ...y el motor pasa por la misma cantidad de nodos.
    expect(await engineTrail(back)).toHaveLength((await engineTrail(graph)).length);
  });

  it.each(GRAPHS.map((g) => [g.name, g.graph] as const))("%s: la vuelta renombra los ids a step-N y las posiciones bajan de a 160", (_name, graph) => {
    const back = linearToFlow(flowToLinear(graph.nodes, graph.edges)!);
    const steps = back.nodes.filter((n) => n.type !== "trigger");
    expect(back.nodes[0]).toMatchObject({ id: "trigger", type: "trigger", position: { x: 0, y: 0 } });
    expect(steps.map((n) => n.id)).toEqual(steps.map((_n, i) => `step-${i + 1}`));
    expect(steps.map((n) => n.position)).toEqual(steps.map((_n, i) => ({ x: 0, y: 160 * (i + 1) })));
    expect(back.edges.map((e) => [e.source, e.target])).toEqual(
      back.nodes.slice(0, -1).map((n, i) => [n.id, back.nodes[i + 1].id]),
    );
  });

  it("el trigger vuelve con su config entera mas el triggerType (la de Agenda trae `config` anidada)", () => {
    const g = templateGraph(FLOW_TEMPLATES[0], "ev-1");
    const linear = flowToLinear(g.nodes, g.edges)!;
    expect(linear.trigger.type).toBe("booking_created");
    // Hoy `trigger.config` es TODO el `data` del nodo, triggerType incluido.
    expect(linear.trigger.config).toEqual(g.nodes[0].data);
    const back = linearToFlow(linear);
    expect(back.nodes[0].data).toEqual(g.nodes[0].data);
  });

  it("HOY se pierde `onlyIfPhone` del mensaje al guardar desde el editor lineal", () => {
    // reminder_1h (Agenda) y thank_you_message (Formularios) lo traen en true:
    // el editor lineal solo conserva el texto del primer mensaje. El editor de
    // arbol guarda los datos del nodo tal cual y lo arregla.
    for (const { name, graph } of GRAPHS) {
      const original = graph.nodes.find((n) => n.type === "sendMessage");
      if (!original) continue;
      expect((original.data as { onlyIfPhone?: boolean }).onlyIfPhone, name).toBe(true);
      const back = linearToFlow(flowToLinear(graph.nodes, graph.edges)!);
      const sent = back.nodes.find((n) => n.type === "sendMessage")!;
      expect(sent.data, name).toEqual({ messages: [{ text: (original.data as { messages: Array<{ text: string }> }).messages[0].text }] });
    }
  });

  it("el email a una direccion fija conserva `fixedEmail` (arreglado en Formularios)", () => {
    const g = formTemplateGraph("notify_me_email", { form: FORM, userEmail: "yo@ejemplo.com" });
    const back = linearToFlow(flowToLinear(g.nodes, g.edges)!);
    expect(back.nodes.find((n) => n.id === "step-1")?.data).toMatchObject({ actionType: "send_email", to: "fixed", fixedEmail: "yo@ejemplo.com" });
  });

  it("el flujo en blanco de Formularios es solo el trigger y vuelve igual", () => {
    const g = blankFormFlowGraph(FORM);
    const linear = flowToLinear(g.nodes, g.edges);
    expect(linear).toMatchObject({ conditions: [], steps: [] });
    const back = linearToFlow(linear!);
    expect(back.nodes).toHaveLength(1);
    expect(back.edges).toEqual([]);
  });
});

describe("flowToLinear: que formas acepta y cuales no", () => {
  const trigger: CanvasNode = { id: "t", type: "trigger", data: { triggerType: "form_submitted" } };
  const tag = (id: string): CanvasNode => ({ id, type: "action", data: { actionType: "addTag", tagName: id } });
  const edge = (source: string, target: string, sourceHandle?: string): CanvasEdge => ({ id: `${source}-${target}-${sourceHandle ?? ""}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) });
  const cond = (conditions: unknown[]): CanvasNode => ({ id: "c", type: "condition", data: { conditions, logic: "and" } });

  it("sin trigger no es una lista", () => {
    expect(flowToLinear([tag("a")], [])).toBeNull();
  });

  it("un Condition con una salida `true` entra como condicion, y las condiciones pasan a texto JSON", () => {
    const c = { field: "tag:vip", operator: "equals", value: "true" };
    const linear = flowToLinear([trigger, cond([c]), tag("a")], [edge("t", "c"), edge("c", "a", "true")]);
    expect(linear!.conditions).toEqual([JSON.stringify(c)]);
    expect(linear!.steps).toHaveLength(1);
  });

  it("HOY un Condition cuya UNICA salida es `false` tambien entra y se muestra como si fuera el `Si` (al reves)", () => {
    const c = { field: "tag:vip", operator: "equals", value: "true" };
    const linear = flowToLinear([trigger, cond([c]), tag("a")], [edge("t", "c"), edge("c", "a", "false")]);
    expect(linear).not.toBeNull();
    expect(linear!.conditions).toHaveLength(1);
  });

  it("un Condition con dos salidas es una rama: no es una lista", () => {
    expect(flowToLinear([trigger, cond([]), tag("a"), tag("b")], [edge("t", "c"), edge("c", "a", "true"), edge("c", "b", "false")])).toBeNull();
  });

  it("un A/B split no es una lista", () => {
    const ab: CanvasNode = { id: "ab", type: "action", data: { actionType: "abSplit" } };
    expect(flowToLinear([trigger, ab, tag("a")], [edge("t", "ab"), edge("ab", "a")])).toBeNull();
  });

  it("un ciclo no es una lista", () => {
    expect(flowToLinear([trigger, tag("a"), tag("b")], [edge("t", "a"), edge("a", "b"), edge("b", "a")])).toBeNull();
  });

  it("un nodo suelto (sin camino desde el trigger) no es una lista", () => {
    expect(flowToLinear([trigger, tag("a"), tag("huerfano")], [edge("t", "a")])).toBeNull();
  });

  it("un nodo que el editor no sabe editar se ve como `other` con su nombre", () => {
    const http: CanvasNode = { id: "h", type: "action", data: { actionType: "httpRequest", label: "Avisar al CRM" } };
    const linear = flowToLinear([trigger, http], [edge("t", "h")]);
    expect(linear!.steps).toEqual([{ kind: "other", type: "httpRequest", label: "Avisar al CRM" }]);
  });
});

describe("linearToFlow: las condiciones (tal cual hoy)", () => {
  it("HOY escribe el `Si` sin `sourceHandle: true` y con las condiciones como TEXTO, sin `logic`", () => {
    // Un flujo con "Si" guardado desde el editor lineal se corta en la condicion:
    // el motor sigue `handle:true` y la arista no declara ninguno. El editor de
    // arbol guarda los datos del nodo tal cual y lo arregla.
    const back = linearToFlow({
      trigger: { type: "form_submitted", config: { form_ids: ["f1"] } },
      conditions: ['{"field":"tag:vip","operator":"equals","value":"true"}'],
      steps: [{ kind: "tag", action: "add", tagName: "x" }],
    });
    const condition = back.nodes.find((n) => n.id === "condition")!;
    expect(condition).toMatchObject({ type: "condition", data: { conditions: ['{"field":"tag:vip","operator":"equals","value":"true"}'] } });
    expect(condition.data).not.toHaveProperty("logic");
    const out = back.edges.find((e) => e.source === "condition")!;
    expect(out.sourceHandle).toBeUndefined();
  });

  it("sin condiciones no se agrega nodo Condition", () => {
    const back = linearToFlow({ trigger: { type: "x", config: {} }, conditions: [], steps: [{ kind: "delay", duration: 1, unit: "hours" }] });
    expect(back.nodes.map((n) => n.id)).toEqual(["trigger", "step-1"]);
  });
});

describe("quien importa el editor lineal", () => {
  it("siguen exportados `flowToLinear`, `linearToFlow` y `describeStep`", () => {
    expect(typeof linearModule.flowToLinear).toBe("function");
    expect(typeof linearModule.linearToFlow).toBe("function");
    expect(typeof linearModule.describeStep).toBe("function");
  });

  // Si alguien mueve el modulo o lo renombra, esta lista dice a quien avisarle.
  const IMPORTERS = [
    "lib/actions/forms/flows.ts",
    "lib/actions/scheduling/event-flows.ts",
    "app/(dashboard)/dashboard/formularios/[id]/automatizaciones/[flowId]/page.tsx",
    "app/(dashboard)/dashboard/agenda/configuracion/eventos/[id]/flujos/[flowId]/page.tsx",
  ];
  it.each(IMPORTERS)("%s sigue importando de linear-flow", (file) => {
    const text = readFileSync(resolve(__dirname, "../..", file), "utf8");
    expect(text).toMatch(/scheduling\/automation\/linear-flow/);
    expect(text).toMatch(/flowToLinear|linearToFlow/);
  });
});
