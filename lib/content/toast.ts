/**
 * Los avisos (toasts) de las acciones del drawer (F95).
 *
 * Cada accion deja un aviso: sin eso, descartar o aprobar una idea y ver
 * aparecer otra en el mismo lugar no dice si paso algo. Aca solo lo que decide
 * cuanto dura y como se apila; el componente lo dibuja.
 */

export type ToastTone = "ok" | "info" | "warning" | "error";

export interface ToastInput {
  tone: ToastTone;
  text: string;
}

export interface ToastItem extends ToastInput {
  id: number;
}

/** Cuanto queda a la vista: lo que hay que leer con calma dura mas. */
export function toastDurationMs(tone: ToastTone): number {
  return tone === "error" ? 9000 : tone === "warning" ? 7000 : 4500;
}

/** Nunca mas de tres a la vez: los mas viejos se van. */
export const MAX_TOASTS = 3;

export function pushToast(list: ToastItem[], input: ToastInput, id: number): ToastItem[] {
  // El mismo aviso dos veces seguidas no se apila: es el doble clic.
  const last = list[list.length - 1];
  if (last && last.text === input.text && last.tone === input.tone) return list;

  return [...list, { ...input, id }].slice(-MAX_TOASTS);
}

export function dismissToast(list: ToastItem[], id: number): ToastItem[] {
  return list.filter((t) => t.id !== id);
}
