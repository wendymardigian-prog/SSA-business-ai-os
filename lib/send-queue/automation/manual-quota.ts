/**
 * El aviso de cupo gastado al escribir a mano (bandeja y grupos). PURO.
 *
 * Lo manual nunca se frena: el mensaje sale igual. Solo se avisa a quien escribe cuando el número ya gastó su cupo de la
 * hora o del día (el completo, con la reserva de urgentes incluida: es el límite que pone en riesgo el número), porque
 * seguir escribiendo mucho más puede hacer que WhatsApp lo bloquee. El del día manda sobre el de la hora.
 */
import type { LaneCounts } from "@/lib/send-queue/pace";
import type { QueuePolicy } from "./policy";

export type ManualQuotaWarning = { reason: "hour" | "day"; used: number; limit: number };

export function manualQuotaWarning(policy: Pick<QueuePolicy, "perHour" | "perDay">, counts: Pick<LaneCounts, "lastHour" | "today">): ManualQuotaWarning | null {
  if (policy.perDay !== null && policy.perDay > 0 && counts.today >= policy.perDay) {
    return { reason: "day", used: counts.today, limit: policy.perDay };
  }
  if (policy.perHour !== null && policy.perHour > 0 && counts.lastHour >= policy.perHour) {
    return { reason: "hour", used: counts.lastHour, limit: policy.perHour };
  }
  return null;
}

/** El texto del aviso: qué pasa, que el mensaje sale igual y el riesgo. */
export function manualQuotaText(w: ManualQuotaWarning): { title: string; detail: string } {
  const span = w.reason === "day" ? "del día" : "de la hora";
  return {
    title: `Este número ya gastó su cupo ${span} (${w.used} de ${w.limit}).`,
    detail: "Tu mensaje sale igual, pero si seguís mandando muchos más, WhatsApp puede bloquear el número.",
  };
}
