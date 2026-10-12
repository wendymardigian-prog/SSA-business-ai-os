/**
 * Guardar un arbol de pasos: TODA la validacion, antes de tocar la base. PURO.
 * Las dos Server Actions (`saveFormFlowTree`, `saveEventFlowTree`) llaman a esto
 * y despues solo escriben.
 *
 * El navegador manda el arbol entero; el servidor no le cree nada de lo que no
 * tiene que decidir el:
 *  - el disparador sale de lo GUARDADO (solo el "Solo si…" de Formularios es
 *    editable, y se valida aparte);
 *  - un paso que el editor no ofrece en esa pantalla (una llamada HTTP, un A/B)
 *    solo puede venir de algo que YA estaba guardado, con los mismos datos;
 *  - un "Si" plano tampoco se crea ni se edita desde aca (solo se convierte en
 *    Condiciones);
 *  - los caminos de Condiciones pasan por `validateBranchData`;
 *  - el arbol tiene que poder ser un grafo (`treeShapeProblems`).
 *
 * Si el grafo guardado NO es un arbol (una fusion, un A/B...) no se guarda
 * nada: abrirlo en el canvas es la unica forma segura de editarlo.
 */

import { z } from "zod";
import { fillPathLabels } from "./branch-edit";
import { kindOfStep, validateActionData, type EditorScreen } from "./step-catalog";
import {
  InvalidTreeError,
  allSteps,
  flowToTree,
  treeShapeProblems,
  treeToFlow,
  type BranchPathStep,
  type Step,
  type StepTree,
} from "./step-tree";
import { validateBranchData } from "@/lib/flow-engine/branch-paths";
import type { CanvasEdge, CanvasNode } from "@/lib/scheduling/automation/linear-flow";

/** Cuantos pasos como maximo (un flujo con mas de esto ya no se puede leer ni probar). */
export const MAX_TREE_STEPS = 200;
/** El tamaño maximo del arbol, en caracteres de JSON. */
export const MAX_TREE_JSON = 400_000;

const data = z.record(z.string(), z.unknown());
const id = z.string().min(1).max(64);

const condition = z
  .object({
    field: z.string().max(200),
    operator: z.string().min(1).max(40),
    value: z.string().max(500).optional(),
    value2: z.string().max(500).optional(),
    values: z.array(z.string().max(500)).max(100).optional(),
    valueType: z.enum(["text", "number", "single_select", "multi_select", "date", "boolean"]).optional(),
  })
  .passthrough();

// Recursivo: un camino lleva pasos, y un paso puede ser Condiciones con mas caminos.
const stepSchema: z.ZodType<Step> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("action"), id, nodeType: z.string().min(1).max(40), data }).strict(),
    z.object({ kind: z.literal("gate"), id, data, steps: z.array(stepSchema) }).strict(),
    z
      .object({
        kind: z.literal("branch"),
        id,
        data,
        paths: z.array(
          z
            .object({
              id,
              label: z.string().max(200),
              logic: z.enum(["and", "or"]),
              conditions: z.array(condition).max(50),
              steps: z.array(stepSchema),
            })
            .passthrough(),
        ),
        otherwise: z.array(stepSchema),
      })
      .strict(),
  ]),
) as z.ZodType<Step>;

const inputSchema = z.object({ steps: z.array(stepSchema) });

export type PrepareTreeSaveResult = { ok: true; graph: { nodes: CanvasNode[]; edges: CanvasEdge[] }; tree: StepTree } | { ok: false; error: string };

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

/** Los caminos con un nombre vacio pasan a ser "Camino N", en todos los niveles. */
function fillLabels(steps: Step[]): Step[] {
  return steps.map((step): Step => {
    if (step.kind === "action") return step;
    if (step.kind === "gate") return { ...step, steps: fillLabels(step.steps) };
    return {
      ...step,
      paths: fillPathLabels(step.paths).map((p): BranchPathStep => ({ ...p, steps: fillLabels(p.steps) })),
      otherwise: fillLabels(step.otherwise),
    };
  });
}

export interface PrepareTreeSaveInput {
  screen: EditorScreen;
  /** El grafo que hay guardado hoy. */
  stored: { nodes: CanvasNode[]; edges: CanvasEdge[] };
  /** Lo que mando el navegador: `{ steps }` (cualquier otra cosa que traiga, como el disparador, se ignora). */
  tree: unknown;
  /** El disparador final, ya resuelto por quien guarda (lo guardado, con el "Solo si…" nuevo si corresponde). */
  triggerData?: Record<string, unknown>;
}

export function prepareTreeSave(input: PrepareTreeSaveInput): PrepareTreeSaveResult {
  const storedTree = flowToTree(input.stored.nodes, input.stored.edges);
  if (!storedTree) {
    return { ok: false, error: "Esta automatización tiene una estructura que solo se puede editar en el canvas (caminos que se vuelven a juntar, un A/B o un ciclo)." };
  }

  const size = JSON.stringify(input.tree ?? null).length;
  if (size > MAX_TREE_JSON) return { ok: false, error: "La automatización es demasiado grande." };

  const parsed = inputSchema.safeParse(input.tree);
  if (!parsed.success) return { ok: false, error: "La automatización tiene datos que no se pueden guardar. Recargá la página y probá de nuevo." };

  const steps = fillLabels(parsed.data.steps);
  const tree: StepTree = { trigger: { id: storedTree.trigger.id, data: input.triggerData ?? storedTree.trigger.data }, steps };

  const all = allSteps(tree);
  if (all.length > MAX_TREE_STEPS) return { ok: false, error: `Como máximo ${MAX_TREE_STEPS} pasos por automatización.` };

  const shape = treeShapeProblems(tree);
  if (shape.length > 0) return { ok: false, error: shape[0] };

  const before = new Map(allSteps(storedTree).map((s) => [s.id, s]));

  for (const step of all) {
    if (step.kind === "branch") {
      const problems = validateBranchData({ paths: step.paths });
      if (problems.length > 0) return { ok: false, error: problems[0] };
      continue;
    }

    const previous = before.get(step.id);

    if (step.kind === "gate") {
      // Un "Si" plano no se crea ni se edita desde el editor: solo se conserva o se convierte.
      if (!previous || previous.kind !== "gate" || !sameJson(previous.data, step.data)) {
        return { ok: false, error: "Un «Si» no se puede crear ni cambiar desde acá: usá Condiciones." };
      }
      continue;
    }

    const unchanged = previous?.kind === "action" && previous.nodeType === step.nodeType && sameJson(previous.data, step.data);
    if (unchanged) continue; // lo que no se toco no se vuelve a juzgar

    if (!kindOfStep(step, input.screen)) {
      return { ok: false, error: "Hay un paso que no se puede armar en esta pantalla. Si lo necesitás, abrí la automatización en el canvas." };
    }
    const problem = validateActionData(step, input.screen);
    if (problem) return { ok: false, error: problem };
  }

  try {
    const graph = treeToFlow(tree);
    // Lo que se guarda tiene que volver a abrirse como el mismo arbol.
    if (!flowToTree(graph.nodes, graph.edges)) return { ok: false, error: "No pude armar la automatización. Probá de nuevo." };
    return { ok: true, graph, tree };
  } catch (error) {
    if (error instanceof InvalidTreeError) return { ok: false, error: error.message };
    throw error;
  }
}
