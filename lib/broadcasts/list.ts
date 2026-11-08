/**
 * Reglas de la lista de Broadcasts: el filtro por estado (`?estado=`) y cuándo
 * se ofrece "Eliminar". Puro.
 */
import type { BroadcastStatus } from "@/lib/types/database";

/** El orden de las píldoras y la palabra que va en la URL. */
export const STATUS_FILTERS: { param: string; status: BroadcastStatus }[] = [
  { param: "borrador", status: "draft" },
  { param: "programado", status: "scheduled" },
  { param: "enviando", status: "sending" },
  { param: "pausado", status: "paused" },
  { param: "terminado", status: "completed" },
  { param: "cancelado", status: "cancelled" },
];

/** El estado que pide `?estado=`; cualquier otra cosa (o nada) es "Todos". */
export function parseStatusFilter(param: string | null | undefined): BroadcastStatus | null {
  if (!param) return null;
  return STATUS_FILTERS.find((f) => f.param === param)?.status ?? null;
}

export function statusFilterParam(status: BroadcastStatus): string {
  return STATUS_FILTERS.find((f) => f.status === status)?.param ?? "";
}

/**
 * Si se muestra "Eliminar": nunca salió nada y no se está enviando. Es solo la
 * pista para la pantalla; la que decide es la base (`delete_unsent_broadcast`,
 * 00347), que además mira si hay un envío a mitad de camino.
 */
export function canDeleteBroadcast(b: { status: BroadcastStatus; sent: number; failed: number }): boolean {
  return b.status !== "sending" && b.sent === 0 && b.failed === 0;
}
