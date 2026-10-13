/**
 * Proyectos por texto (Extra A, F9). PURO.
 *
 * No hay tabla de proyectos: `tasks.project` guarda el texto como se escribio la primera vez y
 * `tasks.project_key` su forma normalizada. "Lanzamiento  Q4" y "lanzamiento q4" son el mismo.
 */

import { TASK_LIMITS } from "./types";

/** Minusculas, sin acentos, espacios colapsados y recortados. Vacio -> null. */
export function normalizeProjectKey(value: string | null | undefined): string | null {
  if (value == null) return null;
  const key = value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return key === "" ? null : key;
}

/** El texto limpio de un proyecto (espacios colapsados), o un error si no entra. */
export function cleanProjectName(value: string | null | undefined):
  | { ok: true; project: string | null; key: string | null }
  | { ok: false; error: string } {
  const key = normalizeProjectKey(value);
  if (key === null) return { ok: true, project: null, key: null };
  const project = (value as string).replace(/\s+/g, " ").trim();
  if (project.length > TASK_LIMITS.project) {
    return { ok: false, error: `El proyecto no puede pasar de ${TASK_LIMITS.project} caracteres.` };
  }
  return { ok: true, project, key };
}

export interface ProjectSummary {
  key: string;
  name: string;
  /** Tareas abiertas (no completadas). */
  openCount: number;
}

interface ProjectTask {
  project: string | null;
  project_key: string | null;
  status: string;
  created_at?: string;
}

/**
 * Los proyectos que existen, agrupados por clave. El nombre mostrado es la variante mas usada
 * (en empate, la mas antigua), ordenados alfabeticamente.
 */
export function listProjects(tasks: readonly ProjectTask[]): ProjectSummary[] {
  const groups = new Map<string, { variants: Map<string, { n: number; first: string }>; open: number }>();
  for (const t of tasks) {
    const key = t.project_key ?? normalizeProjectKey(t.project);
    if (!key || !t.project) continue;
    const g = groups.get(key) ?? { variants: new Map(), open: 0 };
    const v = g.variants.get(t.project) ?? { n: 0, first: t.created_at ?? "" };
    v.n += 1;
    if (t.created_at && (v.first === "" || t.created_at < v.first)) v.first = t.created_at;
    g.variants.set(t.project, v);
    if (t.status !== "completed") g.open += 1;
    groups.set(key, g);
  }

  const out: ProjectSummary[] = [];
  for (const [key, g] of groups) {
    const [name] = [...g.variants.entries()].sort(
      (a, b) => b[1].n - a[1].n || a[1].first.localeCompare(b[1].first) || a[0].localeCompare(b[0]),
    )[0];
    out.push({ key, name, openCount: g.open });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** ¿Ofrecer «Crear "..."»? Solo si lo escrito no vacio y su clave todavia no existe. */
export function shouldOfferCreate(input: string, projects: readonly { key: string }[]): boolean {
  const key = normalizeProjectKey(input);
  if (key === null) return false;
  return !projects.some((p) => p.key === key);
}
