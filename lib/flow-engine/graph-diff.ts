/**
 * «Qué cambió» entre lo publicado y el borrador de una automatización. PURO (lo usa el lienzo).
 *
 * Compara los pasos por su id: agregados, borrados y cambiados (su configuración, no su lugar en el lienzo), y las
 * conexiones entre pasos. Devuelve frases para la persona («Se agregó Enviar email») y la marca de cada paso para
 * pintarlo en el lienzo (verde lo nuevo, ámbar lo cambiado). Lo borrado solo puede estar en la lista: ya no está en el
 * lienzo.
 */

export interface DiffNode {
  id: string;
  type?: string;
  data?: Record<string, unknown> | null;
}

export interface DiffEdge {
  source: string;
  target: string;
  sourceHandle?: string | null;
}

export interface GraphLike {
  nodes: readonly unknown[];
  edges: readonly unknown[];
}

export type NodeMark = "added" | "changed";

export interface GraphDiffItem {
  kind: "added" | "removed" | "changed" | "connected" | "disconnected";
  /** El paso que hay que mostrar al tocar la línea (null si ya no existe). */
  nodeId: string | null;
  text: string;
}

export interface GraphDiff {
  items: GraphDiffItem[];
  marks: Record<string, NodeMark>;
  /** No hay nada distinto (sin contar mover pasos en el lienzo). */
  empty: boolean;
}

/** Lo que es del lienzo y no de lo que hace el paso: moverlo o seleccionarlo no es un cambio. */
const CANVAS_ONLY_DATA_KEYS = new Set(["selected", "dragging", "measured", "width", "height", "position", "positionAbsolute", "deletable"]);

/** JSON con las claves ordenadas: dos datos iguales dan el mismo texto. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

function asNodes(list: readonly unknown[]): DiffNode[] {
  return list.filter((n): n is DiffNode => !!n && typeof n === "object" && typeof (n as { id?: unknown }).id === "string");
}

function asEdges(list: readonly unknown[]): DiffEdge[] {
  return list.filter(
    (e): e is DiffEdge => !!e && typeof e === "object" && typeof (e as { source?: unknown }).source === "string" && typeof (e as { target?: unknown }).target === "string",
  );
}

function meaningfulData(node: DiffNode): string {
  const data = { ...(node.data ?? {}) };
  for (const key of CANVAS_ONLY_DATA_KEYS) delete data[key];
  return stableStringify({ type: node.type ?? null, data });
}

const edgeKey = (e: DiffEdge) => `${e.source}|${e.sourceHandle ?? ""}|${e.target}`;

/** Lo que cambió dentro de un paso, en palabras (sin valores: pueden ser largos o personales). */
function changedWhat(before: DiffNode, after: DiffNode): string {
  if ((before.type ?? null) !== (after.type ?? null)) return "cambió de tipo";
  const a = before.data ?? {};
  const b = after.data ?? {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => !CANVAS_ONLY_DATA_KEYS.has(k)));
  const changed = [...keys].filter((k) => stableStringify(a[k]) !== stableStringify(b[k]));
  if (changed.some((k) => k === "onlyIf")) return "cambió el «Solo si…»";
  if (changed.some((k) => /^(text|message|body|html|content|prompt|subject|caption|label)$/i.test(k))) return "cambió el texto";
  return "cambió su configuración";
}

/**
 * Las diferencias entre lo publicado (`before`) y el borrador (`after`). `labelOf` da el nombre de cada paso (el del
 * catálogo del lienzo, con su nombre propio si lo tiene).
 */
export function diffGraphs(before: GraphLike, after: GraphLike, labelOf: (node: DiffNode) => string): GraphDiff {
  const beforeNodes = asNodes(before.nodes);
  const afterNodes = asNodes(after.nodes);
  const byIdBefore = new Map(beforeNodes.map((n) => [n.id, n]));
  const byIdAfter = new Map(afterNodes.map((n) => [n.id, n]));
  const label = (n: DiffNode | undefined) => (n ? labelOf(n) : "un paso");
  const items: GraphDiffItem[] = [];
  const marks: Record<string, NodeMark> = {};

  for (const node of afterNodes) {
    const old = byIdBefore.get(node.id);
    if (!old) {
      marks[node.id] = "added";
      items.push({ kind: "added", nodeId: node.id, text: `Se agregó «${label(node)}»` });
    } else if (meaningfulData(old) !== meaningfulData(node)) {
      marks[node.id] = "changed";
      const what = changedWhat(old, node);
      items.push({ kind: "changed", nodeId: node.id, text: node.type === "trigger" ? `Cambió el disparador (${what.replace(/^cambió /, "")})` : `«${label(node)}»: ${what}` });
    }
  }
  for (const node of beforeNodes) {
    if (!byIdAfter.has(node.id)) items.push({ kind: "removed", nodeId: null, text: `Se borró «${label(node)}»` });
  }

  const beforeEdges = new Map(asEdges(before.edges).map((e) => [edgeKey(e), e]));
  const afterEdges = new Map(asEdges(after.edges).map((e) => [edgeKey(e), e]));
  const nameOf = (id: string) => label(byIdAfter.get(id) ?? byIdBefore.get(id));
  for (const [key, e] of afterEdges) {
    if (beforeEdges.has(key)) continue;
    // Una conexión hacia un paso nuevo ya se entiende con «Se agregó…»: no se repite.
    if (marks[e.target] === "added") continue;
    items.push({ kind: "connected", nodeId: e.target, text: `Se conectó «${nameOf(e.source)}» con «${nameOf(e.target)}»` });
  }
  for (const [key, e] of beforeEdges) {
    if (afterEdges.has(key)) continue;
    // Si se borró uno de los dos pasos, la conexión se fue con él.
    if (!byIdAfter.has(e.source) || !byIdAfter.has(e.target)) continue;
    items.push({ kind: "disconnected", nodeId: e.target, text: `Se quitó la conexión de «${nameOf(e.source)}» a «${nameOf(e.target)}»` });
  }

  return { items, marks, empty: items.length === 0 };
}
