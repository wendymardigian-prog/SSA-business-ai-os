/**
 * Lee TODAS las filas de una consulta que devuelve de a páginas (PostgREST corta cada respuesta en 1.000).
 * Pura: recibe la función que pide un rango, así se prueba sin base. Sirve para los totales por proveedor y por
 * categoría, que suman en el servidor y en céntimos.
 */
export interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export async function fetchAllPages<T>(
  fetchRange: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: { pageSize?: number; maxRows?: number } = {},
): Promise<{ rows: T[]; truncated: boolean; error: string | null }> {
  const pageSize = options.pageSize ?? 1000;
  const maxRows = options.maxRows ?? 20_000;
  const rows: T[] = [];
  while (rows.length < maxRows) {
    const from = rows.length;
    const { data, error } = await fetchRange(from, from + pageSize - 1);
    if (error) return { rows, truncated: false, error: error.message };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return { rows, truncated: false, error: null };
  }
  return { rows, truncated: true, error: null };
}
