/**
 * Leer las tareas de la pantalla de Tareas de a páginas. Solo servidor.
 *
 * PostgREST corta cada respuesta en 1.000 filas sin avisar: un `.limit(5000)` devolvía solo las 1.000 más nuevas y las
 * más viejas no se podían filtrar ni abrir por un link («No encontramos esta tarea»). La primera página trae también el
 * total; las que faltan se piden todas juntas (no una detrás de otra). Con la SESIÓN: la RLS decide qué tareas ve cada
 * persona.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient<any, any, any>;

export const TASKS_PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null; count?: number | null };

export async function loadAllTasks<T>(
  supabase: Db,
  workspaceId: string,
  columns: string,
  maxRows: number,
): Promise<{ rows: T[]; error: string | null }> {
  const page = (from: number, withCount: boolean) =>
    supabase
      .from("tasks")
      .select(columns, withCount ? { count: "exact" } : undefined)
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, Math.min(from + TASKS_PAGE_SIZE, maxRows) - 1) as unknown as PromiseLike<PageResult<T>>;

  const first = await page(0, true);
  if (first.error) return { rows: [], error: first.error.message };
  const firstRows = first.data ?? [];
  // Sin total (no debería pasar con `count: "exact"`): si la primera vino llena, se piden las páginas hasta el tope.
  const total = Math.min(first.count ?? (firstRows.length < TASKS_PAGE_SIZE ? firstRows.length : maxRows), maxRows);
  const rest: Array<PromiseLike<PageResult<T>>> = [];
  for (let from = TASKS_PAGE_SIZE; from < total; from += TASKS_PAGE_SIZE) rest.push(page(from, false));
  const pages = await Promise.all(rest);
  const rows = [...firstRows];
  for (const p of pages) {
    if (p.error) return { rows, error: p.error.message };
    rows.push(...(p.data ?? []));
  }
  // Por si entre una página y otra se creó una tarea y otra se corrió de página: sin repetidas.
  const seen = new Set<string>();
  return {
    rows: rows.filter((r) => {
      const id = (r as { id?: string }).id;
      if (!id) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }),
    error: null,
  };
}

/** Pedir `.in(ids)` en tandas (miles de ids pasan el largo máximo de la URL). Las tandas van en paralelo. */
export async function inChunks<R>(ids: string[], size: number, run: (slice: string[]) => PromiseLike<{ data: R[] | null }>): Promise<R[]> {
  const slices: string[][] = [];
  for (let i = 0; i < ids.length; i += size) slices.push(ids.slice(i, i + size));
  const results = await Promise.all(slices.map((s) => run(s)));
  return results.flatMap((r) => r.data ?? []);
}
