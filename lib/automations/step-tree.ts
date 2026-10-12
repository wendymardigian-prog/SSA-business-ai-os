/**
 * Un flujo visto como un ARBOL DE PASOS: el modelo del editor de pasos
 * (`components/automations/step-tree-editor.tsx`). PURO: el grafo del canvas
 * entra, el arbol sale, y al reves.
 *
 *   Cuando <disparador>
 *   paso 1
 *   paso 2
 *   Condiciones ─┬ camino A: pasos...
 *                ├ camino B: pasos...
 *                └ Si no:    pasos...
 *
 * Reemplaza a `linear-flow.ts` (la lista Cuando / Si / Entonces) y es un
 * superconjunto: un flujo lineal es un arbol sin ramas. Lo que no entra en un
 * arbol (dos caminos que se vuelven a juntar, un ciclo, un A/B) devuelve `null`
 * y la pantalla lo muestra en solo lectura con "Abrir en el canvas": guardar
 * desde una vista simplificada borraria lo que no se ve.
 *
 * Reglas que no se discuten:
 *  - Ida y vuelta EXACTA: `flowToTree(treeToFlow(t))` es `t`. Y un grafo que ya
 *    es arbol conserva ids, tipos, datos y a donde lleva cada salida.
 *  - Los ids de los nodos se CONSERVAN. Una sesion pausada en un "Esperar" sigue
 *    apuntando al mismo nodo despues de guardar. Solo lo nuevo recibe un id nuevo.
 *  - `node.data` se guarda ENTERO (nada de rearmarlo a partir de unos pocos
 *    campos: asi no se pierde `onlyIfPhone`, `fixedEmail` ni lo que sume un nodo).
 *  - Un nodo Condiciones (`branch`) termina el camino en el que esta: no hay
 *    fusion. Cada camino y "Si no" siguen por su lado hasta el final.
 *  - Hasta 3 niveles de Condiciones anidadas.
 *  - Las posiciones NO son parte del arbol: `treeToFlow` las recalcula con un
 *    layout prolijo (los caminos de izquierda a derecha, en orden; "Si no" a la
 *    derecha del todo). Lo que alguien acomodo a mano en el canvas se reordena.
 */

import type { CanvasEdge, CanvasNode } from "@/lib/scheduling/automation/linear-flow";
import type { BranchPath } from "@/lib/flow-engine/condition-eval";
import { BRANCH_ELSE_HANDLE, BRANCH_ELSE_LABEL, isReservedPathId, newPathId } from "@/lib/flow-engine/branch-paths";
import { canonicalNodeType, type RawFlowNode } from "@/lib/flow-engine/node-outputs";

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

/** Cuantos niveles de Condiciones se pueden anidar en el editor de pasos. */
export const MAX_BRANCH_DEPTH = 3;

export type NodeData = Record<string, unknown>;

/** El disparador. El editor no lo edita (en Formularios, solo su "Solo si…"). */
export interface TriggerStep {
  id: string;
  data: NodeData;
}

/** Cualquier paso que hace algo y sigue al siguiente: un email, un mensaje, una espera, un tag... */
export interface ActionStep {
  kind: "action";
  id: string;
  /** El `type` del nodo en el canvas (`action`, `sendMessage`, `delay`, `aiResponse`...). */
  nodeType: string;
  /** Los datos del nodo, ENTEROS. */
  data: NodeData;
}

/**
 * El "Si" plano de siempre: un nodo `condition` con UNA sola salida (la `true`)
 * a lo que sigue. Lo que viene despues solo corre si se cumple. Se puede
 * convertir en Condiciones (`gateToBranch`).
 */
export interface GateStep {
  kind: "gate";
  id: string;
  data: NodeData;
  /** Lo que corre si se cumple. */
  steps: Step[];
}

/** Un camino de Condiciones con sus pasos. */
export interface BranchPathStep extends BranchPath {
  steps: Step[];
}

/** El nodo Condiciones: varios caminos en orden y "Si no" al final. */
export interface BranchStep {
  kind: "branch";
  id: string;
  /** Los datos del nodo menos `paths` (el nombre del nodo, por ejemplo). */
  data: NodeData;
  paths: BranchPathStep[];
  /** Lo que corre por "Si no". Puede estar vacio. */
  otherwise: Step[];
}

export type Step = ActionStep | GateStep | BranchStep;

export interface StepTree {
  trigger: TriggerStep;
  steps: Step[];
}

// ------------------------------------------------------------
// Ids nuevos
// ------------------------------------------------------------

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** `s_` + 8 caracteres. Sin repetir ninguno de `taken`. `random` entra por parametro para los tests. */
export function newStepId(taken: Iterable<string> = [], random: () => number = Math.random): string {
  const used = new Set(taken);
  for (let attempt = 0; attempt < 50; attempt++) {
    let id = "s_";
    for (let i = 0; i < 8; i++) id += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length) % ID_ALPHABET.length];
    if (!used.has(id)) return id;
  }
  return `s_${(used.size + 1).toString(36).padStart(8, "0")}`;
}

// ------------------------------------------------------------
// Recorrer
// ------------------------------------------------------------

/** Los hijos de un paso, en orden de lectura: los pasos de un Si, o los de cada camino y los de "Si no". */
export function childLists(step: Step): Step[][] {
  switch (step.kind) {
    case "action":
      return [];
    case "gate":
      return [step.steps];
    case "branch":
      return [...step.paths.map((p) => p.steps), step.otherwise];
  }
}

/** Todos los pasos del arbol en orden de lectura (primero el paso, despues lo que tiene adentro). */
export function allSteps(tree: StepTree): Step[] {
  const out: Step[] = [];
  const visit = (steps: Step[]) => {
    for (const step of steps) {
      out.push(step);
      for (const list of childLists(step)) visit(list);
    }
  };
  visit(tree.steps);
  return out;
}

export function findStep(tree: StepTree, id: string): Step | undefined {
  return allSteps(tree).find((s) => s.id === id);
}

/** Todos los ids del arbol, el del disparador incluido. */
export function allIds(tree: StepTree): string[] {
  return [tree.trigger.id, ...allSteps(tree).map((s) => s.id)];
}

/** Cuantos niveles de Condiciones hay anidados en esta lista (0 si no hay ninguna). */
export function branchDepth(steps: Step[]): number {
  let max = 0;
  for (const step of steps) {
    if (step.kind === "branch") {
      const inner = Math.max(0, ...step.paths.map((p) => branchDepth(p.steps)), branchDepth(step.otherwise));
      max = Math.max(max, 1 + inner);
    } else if (step.kind === "gate") {
      max = Math.max(max, branchDepth(step.steps));
    }
  }
  return max;
}

/** El tipo de accion de un paso (`send_email`, `addTag`...), o su tipo de nodo si no es una accion con `actionType`. */
export function actionTypeOf(step: ActionStep): string {
  return canonicalNodeType({ type: step.nodeType, data: step.data });
}

/** El primer email en orden de lectura (el que manda "Enviarme una prueba"). */
export function firstEmailStep(tree: StepTree): ActionStep | undefined {
  return allSteps(tree).find((s): s is ActionStep => s.kind === "action" && actionTypeOf(s) === "send_email");
}

/** Los pasos que corren ANTES de `stepId` en su mismo camino, del mas cercano al disparador al mas cercano al paso. Solo acciones (lo que deja variables). */
export function upstreamNodesOf(tree: StepTree, stepId: string): Array<RawFlowNode & { id: string }> {
  const out: Array<RawFlowNode & { id: string }> = [];
  const search = (steps: Step[], trail: Array<RawFlowNode & { id: string }>): boolean => {
    const before = [...trail];
    for (const step of steps) {
      if (step.id === stepId) {
        out.push(...before);
        return true;
      }
      for (const list of childLists(step)) if (search(list, before)) return true;
      if (step.kind === "action") before.push({ id: step.id, type: step.nodeType, data: step.data });
    }
    return false;
  };
  search(tree.steps, []);
  return out;
}

// ------------------------------------------------------------
// Del grafo al arbol
// ------------------------------------------------------------

const TRUE_HANDLES = new Set(["true", "yes"]);

function dataOf(node: CanvasNode): NodeData {
  const data = node.data;
  return data && typeof data === "object" && !Array.isArray(data) ? (structuredClone(data) as NodeData) : {};
}

/**
 * El grafo como arbol, o `null` si no lo es:
 *  - dos caminos que se juntan (un nodo con dos entradas), un ciclo, un nodo
 *    suelto o una conexion a un nodo que no existe;
 *  - un A/B split (el editor no sabe mostrarlo);
 *  - una condicion con dos salidas, o cuya unica salida es la de "No";
 *  - un nodo comun con mas de una salida (el motor solo sigue la primera);
 *  - un nodo Condiciones con una salida que no es suya;
 *  - mas de `MAX_BRANCH_DEPTH` niveles de Condiciones.
 *
 * Una condicion con UNA salida sin declarar (como las dejaba el editor lineal
 * viejo) se lee como un "Si" normal: el motor nunca la seguia, y al guardar se
 * escribe bien (`true`).
 */
export function flowToTree(nodes: CanvasNode[], edges: CanvasEdge[]): StepTree | null {
  const trigger = nodes.find((n) => n.type === "trigger");
  if (!trigger) return null;

  const byId = new Map<string, CanvasNode>();
  for (const node of nodes) {
    if (byId.has(node.id)) return null; // dos nodos con el mismo id
    byId.set(node.id, node);
  }

  const outgoing = new Map<string, CanvasEdge[]>();
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) return null;
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge);
    outgoing.set(edge.source, list);
  }

  const visited = new Set<string>([trigger.id]);
  let usedEdges = 0;

  function walk(startId: string, depth: number): Step[] | null {
    const steps: Step[] = [];
    let currentId: string | null = startId;

    while (currentId) {
      // Un nodo al que se llega dos veces: una fusion o un ciclo.
      if (visited.has(currentId)) return null;
      visited.add(currentId);

      const node: CanvasNode = byId.get(currentId)!;
      const outs: CanvasEdge[] = outgoing.get(node.id) ?? [];
      const data = dataOf(node);

      if (node.type === "trigger") return null; // un segundo disparador

      if (node.type === "branch") {
        if (depth >= MAX_BRANCH_DEPTH) return null;
        const { paths: rawPaths, ...rest } = data as NodeData & { paths?: unknown };
        if (!Array.isArray(rawPaths)) return null;
        const ids = new Set<string>();
        for (const raw of rawPaths) {
          const id = (raw as { id?: unknown } | null)?.id;
          if (typeof id !== "string" || id === "" || isReservedPathId(id) || ids.has(id)) return null;
          ids.add(id);
        }
        const handles = new Set<string>([...ids, BRANCH_ELSE_HANDLE]);
        const byHandle = new Map<string, CanvasEdge>();
        for (const edge of outs) {
          if (!edge.sourceHandle || !handles.has(edge.sourceHandle) || byHandle.has(edge.sourceHandle)) return null;
          byHandle.set(edge.sourceHandle, edge);
        }
        usedEdges += outs.length;

        const paths: BranchPathStep[] = [];
        for (const raw of rawPaths as BranchPath[]) {
          const target = byHandle.get(raw.id)?.target;
          const inner = target ? walk(target, depth + 1) : [];
          if (inner === null) return null;
          paths.push({ ...raw, steps: inner });
        }
        const elseTarget = byHandle.get(BRANCH_ELSE_HANDLE)?.target;
        const otherwise = elseTarget ? walk(elseTarget, depth + 1) : [];
        if (otherwise === null) return null;

        steps.push({ kind: "branch", id: node.id, data: rest, paths, otherwise });
        return steps; // Condiciones termina el camino: no hay fusion
      }

      if (node.type === "condition") {
        if (outs.length > 1) return null;
        const handle = outs[0]?.sourceHandle;
        // La salida "No" sola no es un "Si": mostrarla asi seria mentir.
        if (handle && !TRUE_HANDLES.has(handle)) return null;
        usedEdges += outs.length;
        const inner = outs[0] ? walk(outs[0].target, depth) : [];
        if (inner === null) return null;
        steps.push({ kind: "gate", id: node.id, data, steps: inner });
        return steps;
      }

      // Un condition o un branch escondido adentro de un `action` no se reconoce: mejor no abrirlo.
      const canonical = canonicalNodeType({ type: node.type, data });
      if (canonical === "abSplit" || canonical === "condition" || canonical === "branch") return null;

      if (outs.length > 1) return null;
      usedEdges += outs.length;
      steps.push({ kind: "action", id: node.id, nodeType: node.type, data });
      currentId = outs[0]?.target ?? null;
    }
    return steps;
  }

  const fromTrigger = outgoing.get(trigger.id) ?? [];
  if (fromTrigger.length > 1) return null;
  usedEdges += fromTrigger.length;
  const steps = fromTrigger[0] ? walk(fromTrigger[0].target, 0) : [];
  if (steps === null) return null;

  // Un nodo suelto, o una conexion que no se recorrio, es algo que el arbol no mostraria.
  if (visited.size !== nodes.length || usedEdges !== edges.length) return null;

  return { trigger: { id: trigger.id, data: dataOf(trigger) }, steps };
}

// ------------------------------------------------------------
// Del arbol al grafo
// ------------------------------------------------------------

/** El arbol no respeta la forma que el grafo puede tener (por ejemplo, pasos despues de un nodo Condiciones). */
export class InvalidTreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTreeError";
  }
}

/** Un camino sin los pasos que lleva adentro: lo que se guarda en `node.data.paths`. */
function withoutSteps(path: BranchPathStep): BranchPath {
  const copy: Partial<BranchPathStep> = structuredClone(path);
  delete copy.steps;
  return copy as BranchPath;
}

const COL = 320;
const ROW = 160;
const BRANCH_ROW = 220;

function widthOfList(steps: Step[]): number {
  return Math.max(1, ...steps.map(widthOfStep));
}

function widthOfStep(step: Step): number {
  switch (step.kind) {
    case "action":
      return 1;
    case "gate":
      return widthOfList(step.steps);
    case "branch":
      return [...step.paths.map((p) => widthOfList(p.steps)), widthOfList(step.otherwise)].reduce((a, b) => a + b, 0);
  }
}

/**
 * Las formas que el grafo no puede tener y por eso el arbol tampoco: un paso
 * despues de un Si o de Condiciones (no hay fusion, lo que sigue va ADENTRO),
 * mas niveles de los permitidos, un id repetido. Lista vacia = el arbol es valido.
 */
export function treeShapeProblems(tree: StepTree): string[] {
  const problems: string[] = [];
  const seen = new Set<string>([tree.trigger.id]);

  const visit = (steps: Step[], depth: number) => {
    steps.forEach((step, index) => {
      if (typeof step.id !== "string" || step.id === "") problems.push("Hay un paso sin identificador.");
      else if (seen.has(step.id)) problems.push(`Hay dos pasos con el mismo identificador (${step.id}).`);
      else seen.add(step.id);

      if ((step.kind === "gate" || step.kind === "branch") && index !== steps.length - 1) {
        problems.push("Después de un Si o de Condiciones no puede haber más pasos: tienen que ir adentro.");
      }
      if (step.kind === "branch") {
        if (depth >= MAX_BRANCH_DEPTH) problems.push(`Se pueden anidar hasta ${MAX_BRANCH_DEPTH} niveles de Condiciones.`);
        for (const path of step.paths) visit(path.steps, depth + 1);
        visit(step.otherwise, depth + 1);
      } else if (step.kind === "gate") {
        visit(step.steps, depth);
      }
    });
  };
  visit(tree.steps, 0);
  return [...new Set(problems)];
}

/**
 * El arbol como grafo del canvas. Conserva el id de cada paso (los ids en
 * blanco o repetidos reciben uno nuevo: solo lo nuevo se renombra), guarda los
 * datos de cada nodo enteros y arma un layout prolijo.
 *
 * Lanza `InvalidTreeError` si el arbol no tiene una forma posible
 * (`treeShapeProblems`): quien guarda tiene que haberlo revisado antes.
 */
export function treeToFlow(tree: StepTree, random?: () => number): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const problems = treeShapeProblems(tree).filter((p) => !p.startsWith("Hay un paso sin") && !p.startsWith("Hay dos pasos"));
  if (problems.length > 0) throw new InvalidTreeError(problems[0]);

  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];

  // Los ids que el arbol ya trae se respetan; solo un id en blanco o repetido recibe uno nuevo,
  // y nunca uno que ya usa otro paso (aunque venga mas adelante).
  const reserved = new Set<string>([tree.trigger.id]);
  for (const step of allSteps(tree)) if (step.id) reserved.add(step.id);
  const assigned = new Set<string>([tree.trigger.id]);
  const idFor = (wanted: string): string => {
    if (wanted && !assigned.has(wanted)) {
      assigned.add(wanted);
      return wanted;
    }
    const id = newStepId([...reserved, ...assigned], random);
    assigned.add(id);
    return id;
  };

  const link = (from: { id: string; handle?: string }, to: string) => {
    edges.push({ id: `${from.id}-${to}`, source: from.id, target: to, ...(from.handle ? { sourceHandle: from.handle } : {}) });
  };

  const rootWidth = widthOfList(tree.steps);
  nodes.push({ id: tree.trigger.id, type: "trigger", position: { x: ((rootWidth - 1) / 2) * COL, y: 0 }, data: structuredClone(tree.trigger.data) });

  function place(steps: Step[], left: number, width: number, startY: number, from: { id: string; handle?: string }) {
    const center = left + (width - 1) / 2;
    let y = startY;
    let prev = from;
    for (const step of steps) {
      const id = idFor(step.id);
      const position = { x: center * COL, y };
      link(prev, id);

      if (step.kind === "action") {
        nodes.push({ id, type: step.nodeType, position, data: structuredClone(step.data) });
        prev = { id };
        y += ROW;
      } else if (step.kind === "gate") {
        nodes.push({ id, type: "condition", position, data: structuredClone(step.data) });
        // El "Si" siempre sale por `true`: sin salida declarada el motor nunca lo sigue.
        place(step.steps, left, width, y + ROW, { id, handle: "true" });
        return;
      } else {
        nodes.push({
          id,
          type: "branch",
          position,
          data: { ...structuredClone(step.data), paths: step.paths.map(withoutSteps) },
        });
        const total = widthOfStep(step);
        let x = left + (width - total) / 2;
        for (const path of step.paths) {
          const w = widthOfList(path.steps);
          place(path.steps, x, w, y + BRANCH_ROW, { id, handle: path.id });
          x += w;
        }
        place(step.otherwise, x, widthOfList(step.otherwise), y + BRANCH_ROW, { id, handle: BRANCH_ELSE_HANDLE });
        return;
      }
    }
  }

  place(tree.steps, 0, rootWidth, ROW, { id: tree.trigger.id });
  return { nodes, edges };
}

// ------------------------------------------------------------
// Convertir un "Si" en Condiciones
// ------------------------------------------------------------

/** Las condiciones de un `condition`, tambien las que el editor lineal viejo guardo como texto JSON. */
export function gateConditions(data: NodeData): Array<Record<string, unknown>> {
  const raw = Array.isArray(data.conditions) ? data.conditions : [];
  const out: Array<Record<string, unknown>> = [];
  for (const item of raw) {
    if (item && typeof item === "object") out.push({ ...(item as Record<string, unknown>) });
    else if (typeof item === "string") {
      try {
        const parsed: unknown = JSON.parse(item);
        if (parsed && typeof parsed === "object") out.push(parsed as Record<string, unknown>);
      } catch {
        // Un texto que no es una condicion nunca se pudo evaluar: no se arrastra.
      }
    }
  }
  return out;
}

export const GATE_PATH_LABEL = "Si";

/**
 * "Convertir a Condiciones": el "Si" pasa a ser un nodo Condiciones con UN camino
 * ("Si") que lleva los mismos pasos, y un "Si no" vacio. Conserva el id del nodo,
 * las condiciones tal cual (con el operador viejo) y el "y / o" de siempre
 * (cualquier cosa que no sea "and" se comporta como "o", igual que el nodo viejo).
 */
export function gateToBranch(gate: GateStep, options: { pathId?: string; random?: () => number } = {}): BranchStep {
  const { conditions: _conditions, logic, ...rest } = gate.data as NodeData & { conditions?: unknown; logic?: unknown };
  void _conditions;
  const pathId = options.pathId ?? newPathId([], options.random);
  return {
    kind: "branch",
    id: gate.id,
    data: rest,
    paths: [
      {
        id: pathId,
        label: GATE_PATH_LABEL,
        logic: logic === "and" ? "and" : "or",
        conditions: gateConditions(gate.data) as unknown as BranchPath["conditions"],
        steps: gate.steps,
      },
    ],
    otherwise: [],
  };
}

// ------------------------------------------------------------
// Resumen
// ------------------------------------------------------------

const SHORT_WHEN: Record<string, string> = {
  form_submitted: "Cuando se envía",
  survey_answered: "Cuando se responde",
  contract_signed: "Cuando se firma",
  booking_created: "Cuando se agenda",
  booking_rescheduled: "Cuando se reagenda",
  booking_cancelled: "Cuando se cancela",
  booking_before_start: "Antes de la reunión",
  booking_status_changed: "Cuando cambia el estado",
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * El flujo en una linea, para la lista: "Cuando se envía · 2 caminos + si no · 3 emails".
 * `when` pisa el "Cuando…" cuando la pantalla tiene uno mejor.
 */
export function describeTree(tree: StepTree, options: { when?: string } = {}): string {
  const steps = allSteps(tree);
  const when = options.when ?? SHORT_WHEN[String(tree.trigger.data.triggerType ?? "")] ?? "Cuando se dispara";

  const branches = steps.filter((s): s is BranchStep => s.kind === "branch");
  const pathCount = branches.reduce((n, b) => n + b.paths.length, 0);
  const actions = steps.filter((s): s is ActionStep => s.kind === "action");
  const emails = actions.filter((a) => actionTypeOf(a) === "send_email").length;
  const messages = actions.filter((a) => actionTypeOf(a) === "sendMessage").length;
  const others = actions.length - emails - messages;

  const parts: string[] = [when];
  if (branches.length > 0) parts.push(`${plural(pathCount, "camino", "caminos")} + ${BRANCH_ELSE_LABEL.toLowerCase()}`);
  if (emails > 0) parts.push(plural(emails, "email", "emails"));
  if (messages > 0) parts.push(plural(messages, "mensaje", "mensajes"));
  if (emails === 0 && messages === 0 && others > 0) parts.push(plural(others, "paso", "pasos"));
  if (actions.length === 0 && branches.length === 0) parts.push("sin pasos");
  return parts.join(" · ");
}
