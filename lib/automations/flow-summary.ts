/**
 * El resumen de un flujo en una linea, para las listas: "Cuando se envía · 2
 * caminos + si no · 3 emails". PURO.
 *
 * Es el mismo `describeTree` del editor de pasos. Un flujo que no se puede leer
 * como arbol (caminos que se juntan, un A/B, un ciclo, mas de 3 niveles de
 * Condiciones) se arma en el canvas y asi se dice, en vez de inventarle un resumen.
 */

import { describeTree, flowToTree } from "./step-tree";
import type { CanvasEdge, CanvasNode } from "@/lib/scheduling/automation/linear-flow";

export const CANVAS_SUMMARY = "Armado en el canvas";

export function summarizeFlow(nodes: unknown, edges: unknown): string {
  try {
    const tree = flowToTree((Array.isArray(nodes) ? nodes : []) as CanvasNode[], (Array.isArray(edges) ? edges : []) as CanvasEdge[]);
    return tree ? describeTree(tree) : CANVAS_SUMMARY;
  } catch {
    // Datos rotos en la base: el listado no se cae por un solo flujo.
    return CANVAS_SUMMARY;
  }
}
