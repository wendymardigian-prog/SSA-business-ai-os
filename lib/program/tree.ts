// @plantilla-quitar(servicios)
/**
 * El árbol de Contenido (F45, F102), puro: arma módulos → submódulos → clases desde las filas, en orden, con la
 * herencia de Activo / Inactivo (lo inactivo de un padre apaga a sus hijos en el editor), y reordena un nivel.
 */
export type ProgramKind = "module" | "submodule" | "lesson";
export type ProgramStatus = "inactive" | "active" | "archived";

export interface ProgramRow {
  id: string;
  parent_id: string | null;
  kind: ProgramKind;
  lesson_type: string | null;
  title: string;
  position: number;
  status: ProgramStatus;
  unlock_rule?: Record<string, unknown> | null;
  video_url?: string | null;
  thumbnail_path?: string | null;
  thumbnail_url?: string | null;
  cover_path?: string | null;
}

export interface TreeNode extends ProgramRow {
  depth: number;
  /** Oculto porque un padre está inactivo o archivado. */
  hiddenByParent: boolean;
  children: TreeNode[];
}

export function buildTree(rows: ProgramRow[], opts: { includeArchived?: boolean } = {}): TreeNode[] {
  const visible = opts.includeArchived ? rows : rows.filter((r) => r.status !== "archived");
  const byParent = new Map<string | null, ProgramRow[]>();
  for (const r of visible) byParent.set(r.parent_id, [...(byParent.get(r.parent_id) ?? []), r]);
  const build = (parent: string | null, depth: number, parentOff: boolean): TreeNode[] =>
    (byParent.get(parent) ?? [])
      .slice()
      .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title, "es"))
      .map((r) => ({ ...r, depth, hiddenByParent: parentOff, children: build(r.id, depth + 1, parentOff || r.status !== "active") }));
  return build(null, 0, false);
}

/** Aplana el árbol en el orden en que se dibuja. */
export function flattenTree(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((n) => [n, ...flattenTree(n.children)]);
}

/** Mueve un ítem dentro de su nivel (arriba o abajo) y devuelve los ids del nivel en el orden nuevo. */
export function reorderTree(siblings: Array<{ id: string; position: number }>, move: { id: string; to: number }): string[] {
  const ordered = siblings.slice().sort((a, b) => a.position - b.position).map((s) => s.id);
  const from = ordered.indexOf(move.id);
  if (from < 0) return ordered;
  const to = Math.max(0, Math.min(ordered.length - 1, move.to));
  ordered.splice(from, 1);
  ordered.splice(to, 0, move.id);
  return ordered;
}

/** Cuántas clases inactivas hay debajo (para «¿Prender también sus N clases inactivas?»). */
export function inactiveDescendants(node: TreeNode): number {
  return node.children.reduce((n, c) => n + (c.status === "inactive" ? 1 : 0) + inactiveDescendants(c), 0);
}

/** El avance de una persona en un módulo: solo cuenta lo ACTIVO y obligatorio (F102). */
export function moduleProgress(lessons: Array<{ id: string; status: ProgramStatus; required?: boolean }>, completedIds: Set<string>): { done: number; total: number; pct: number } {
  const counted = lessons.filter((l) => l.status === "active" && l.required !== false);
  const done = counted.filter((l) => completedIds.has(l.id)).length;
  return { done, total: counted.length, pct: counted.length === 0 ? 0 : Math.round((done / counted.length) * 100) };
}
