/**
 * El resumen de «Eliminar seleccionadas» (Ventas, Pagos): «8 eliminadas · 1 no se pudo: motivo». PURO.
 * Los motivos iguales se agrupan, así diez filas frenadas por lo mismo no repiten diez veces el texto.
 */

export interface BulkNoun {
  /** «venta», «pago». */
  one: string;
  /** «ventas», «pagos». */
  many: string;
  /** Para el participio: «eliminadas» / «eliminados». */
  feminine: boolean;
}

export const BULK_NOUNS = {
  sale: { one: "venta", many: "ventas", feminine: true },
  payment: { one: "pago", many: "pagos", feminine: false },
} as const satisfies Record<string, BulkNoun>;

export function bulkCountLabel(count: number, noun: BulkNoun): string {
  return `${count} ${count === 1 ? noun.one : noun.many}`;
}

export function bulkDeleteSummary(deleted: number, failures: ReadonlyArray<{ error: string }>, noun: BulkNoun): string {
  const parts: string[] = [];
  const ending = noun.feminine ? "a" : "o";
  if (deleted > 0 || failures.length === 0) parts.push(`${deleted} ${deleted === 1 ? `eliminad${ending}` : `eliminad${ending}s`}`);
  if (failures.length > 0) {
    const reasons = new Map<string, number>();
    for (const f of failures) reasons.set(f.error, (reasons.get(f.error) ?? 0) + 1);
    const detail = [...reasons.entries()].map(([reason, n]) => (reasons.size > 1 ? `${reason} (${n})` : reason)).join("; ");
    parts.push(`${failures.length} no se ${failures.length === 1 ? "pudo" : "pudieron"}: ${detail}`);
  }
  return parts.join(" · ");
}
