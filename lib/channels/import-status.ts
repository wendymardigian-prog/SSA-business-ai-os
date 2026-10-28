/**
 * Que mostrar en la tarjeta de un canal sobre la importacion de conversaciones (00267).
 *
 * Puro: recibe lo guardado en `channels.inbox_import` y devuelve el texto. La fecha
 * la formatea quien llama (la pantalla, en la zona de quien mira).
 */

import { parseImportState } from "@/lib/inbox-import/state";

export interface ImportStatusView {
  tone: "progress" | "ok" | "warning";
  text: string;
  /** El motivo, si quedo incompleta. */
  detail: string | null;
  /** Se ofrece "Reintentar". */
  canRetry: boolean;
  /** Mientras corre, la pantalla vuelve a mirar cada tanto. */
  running: boolean;
}

function plural(n: number, uno: string, varios: string): string {
  return `${n.toLocaleString("es-AR")} ${n === 1 ? uno : varios}`;
}

export function importStatusView(
  raw: unknown,
  formatDate: (iso: string) => string,
): ImportStatusView | null {
  const state = parseImportState(raw);
  if (!state) return null;

  if (state.status === "running") {
    const waiting = state.retries > 0;
    return {
      tone: "progress",
      text: waiting
        ? `Importando conversaciones: Zernio pidió esperar, sigue sola. ${plural(state.imported, "nueva", "nuevas")} hasta ahora.`
        : `Importando conversaciones… ${plural(state.imported, "nueva", "nuevas")} hasta ahora.`,
      detail: null,
      canRetry: false,
      running: true,
    };
  }

  if (state.status === "done") {
    const base =
      state.imported > 0
        ? `${plural(state.imported, "conversación importada", "conversaciones importadas")}.`
        : "Conversaciones al día.";
    return {
      tone: "ok",
      text: state.next_pass_at ? `${base} Vuelve a revisar el ${formatDate(state.next_pass_at)}.` : base,
      detail: null,
      canRetry: false,
      running: false,
    };
  }

  // partial o error: lo importado queda, y se puede volver a intentar.
  return {
    tone: "warning",
    text:
      state.imported > 0
        ? `La importación quedó incompleta (${plural(state.imported, "conversación importada", "conversaciones importadas")}).`
        : "No se pudieron importar las conversaciones.",
    detail: state.last_error,
    canRetry: true,
    running: false,
  };
}
