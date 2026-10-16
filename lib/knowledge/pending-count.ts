/** Cuantos documentos esperan indexarse (para "Indexar pendientes (N)"). Puro: lo usa el navegador. */
export function countPending(documents: ReadonlyArray<{ status: string }>): number {
  return documents.filter((d) => d.status === "pending").length;
}
