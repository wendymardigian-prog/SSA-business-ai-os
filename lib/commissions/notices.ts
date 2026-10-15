/**
 * Los avisos de Comisiones (Extra I, F66). PURO: arma el texto; quien llama (el handler, las acciones) crea la
 * notificación. Todos van a una persona concreta (`recipient_id`) o a Owner/Admin, NUNCA a quien hizo el cambio, y
 * ninguno puede tumbar lo que lo origina.
 */
import { formatUsd } from "@/lib/finance/format";

export interface Notice {
  title: string;
  body: string;
}

/** «Generaste USD 38,82 en comisiones por la venta de Pedro». Va a la persona a la que se le deben. */
export function generatedNotice(args: { totalCents: number; contactName: string | null }): Notice {
  const who = args.contactName?.trim();
  return {
    title: who ? `Generaste ${formatUsd(args.totalCents)} en comisiones por la venta de ${who}` : `Generaste ${formatUsd(args.totalCents)} en comisiones`,
    body: "Cuando el cobro se liquide en un gasto, vas a ver acá cuándo se paga.",
  };
}

/** Una persona cobró lo que se le debía: el gasto que liquidaba sus comisiones se pagó. */
export function payoutPaidNotice(args: { totalCents: number; paidDate: string | null }): Notice {
  return {
    title: `Se pagaron tus comisiones: ${formatUsd(args.totalCents)}`,
    body: args.paidDate ? `El pago figura con fecha ${args.paidDate}.` : "Ya figuran como pagadas.",
  };
}

/** Se revirtió un cobro que tenía comisiones ya liquidadas: nada se toca solo. Va a Owner/Admin. */
export function reviewNeededNotice(args: { count: number }): Notice {
  const n = args.count;
  return {
    title: `Se revirtió un cobro con ${n} ${n === 1 ? "comisión ya liquidada" : "comisiones ya liquidadas"}`,
    body: "Esas comisiones ya están en un gasto y no se anularon solas. Revisá si corresponde un ajuste.",
  };
}
