/**
 * Interfaz de proveedor por lote (F24, §21.2). El AI SDK v6 en uso NO expone
 * modo batch para ningún proveedor, así que la implementación por defecto usa
 * pedidos agrupados (el helper único de IA, uno por grupo). Esta interfaz deja
 * el asiento listo para sumar la API por lote real (fetch a los endpoints del
 * proveedor) sin tocar el despacho ni la recolección.
 */
export interface BatchRequest {
  id: string;
  prompt: string;
}
export interface BatchResult {
  id: string;
  text: string | null;
  error?: string;
}

export interface BatchProvider {
  /** true si el proveedor soporta la API por lote asíncrona real. */
  supportsBatch: boolean;
  /** Envía un lote; devuelve un id de lote para consultar después (o null si es síncrono/agrupado). */
  submit(requests: BatchRequest[]): Promise<{ batchId: string | null; results?: BatchResult[] }>;
  /** Consulta un lote pendiente. */
  poll?(batchId: string): Promise<{ done: boolean; results?: BatchResult[] }>;
}

/**
 * Implementación por pedidos agrupados: no hay lote real, se resuelve en el
 * momento con el runner que se le pasa. `submit` devuelve los resultados
 * directamente (batchId null). El seam para el lote real es reemplazar esto.
 */
export function groupedRequestsProvider(run: (r: BatchRequest) => Promise<BatchResult>): BatchProvider {
  return {
    supportsBatch: false,
    async submit(requests) {
      const results: BatchResult[] = [];
      for (const r of requests) results.push(await run(r));
      return { batchId: null, results };
    },
  };
}
