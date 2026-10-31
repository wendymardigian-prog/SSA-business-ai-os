/**
 * Como se cuenta la revision del historial de WhatsApp en la pantalla. Puro.
 */

import type { HistoryReview } from "./review";

export interface ReviewText {
  /** La conclusion, en una frase. */
  headline: string;
  /** El detalle, en frases cortas. */
  lines: string[];
  /** Si hay algo que una importacion traeria a la bandeja. */
  worthImporting: boolean;
}

function n(value: number): string {
  return value.toLocaleString("es-AR");
}

function conversations(value: number): string {
  return `${n(value)} ${value === 1 ? "conversación" : "conversaciones"}`;
}

export function reviewText(review: HistoryReview, formatDate: (iso: string) => string): ReviewText {
  if (review.people === 0 && review.messages === 0) {
    return {
      headline: "Evolution no tiene conversaciones guardadas de este número.",
      lines: ["No hay nada para importar."],
      worthImporting: false,
    };
  }

  const lines: string[] = [];
  const more = review.truncated ? " (o más)" : "";
  lines.push(
    `${conversations(review.people)}${more} con personas guardadas en Evolution` +
      (review.peopleWithoutNumber > 0 ? `, ${n(review.peopleWithoutNumber)} de alguien que no compartió su número.` : "."),
  );
  if (review.groups > 0) {
    lines.push(review.groups === 1 ? "1 grupo: los grupos no se importan." : `${n(review.groups)} grupos: los grupos no se importan.`);
  }
  if (review.oldestMessageAt && review.newestMessageAt) {
    lines.push(
      `${n(review.messages)} mensajes guardados, del ${formatDate(review.oldestMessageAt)} al ${formatDate(review.newestMessageAt)}.`,
    );
  }
  lines.push(
    review.hasHistoryBeforeConnection
      ? "Hay mensajes de antes de conectar el número al sistema."
      : "No hay mensajes de antes de conectar el número: Evolution no guardó historial previo (o WhatsApp no lo mandó).",
  );

  const worthImporting = review.missingInInbox > 0;
  return {
    headline: worthImporting
      ? `${conversations(review.missingInInbox)}${more} de WhatsApp no ${review.missingInInbox === 1 ? "está" : "están"} en la bandeja y se ${review.missingInInbox === 1 ? "podría" : "podrían"} traer.`
      : "Todas las conversaciones guardadas en Evolution ya están en la bandeja.",
    lines,
    worthImporting,
  };
}
