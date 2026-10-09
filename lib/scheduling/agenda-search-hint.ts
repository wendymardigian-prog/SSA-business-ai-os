/**
 * El cartel del buscador de Agenda: avisa cuando la busqueda esta limitada por
 * una fecha.
 *
 * La busqueda de un contacto se combina (AND) con el periodo elegido, asi que
 * buscar a alguien que reservo fuera del rango devuelve "nada" y parece que no
 * existe. El cartel lo dice. Con "Todo" no hay filtro de fecha y no hace falta.
 *
 * Puro: la pantalla solo lo muestra.
 */

import { isoRangeToCivil, periodButtonLabel } from "@/lib/dashboards/chat/date-range";
import { AGENDA_PERIOD_LABELS, type AgendaPeriod } from "@/lib/scheduling/agenda-period";

export function agendaSearchHint(args: {
  view: "list" | "kanban" | "calendar";
  period: AgendaPeriod;
  /** Un rango a medida, si lo hay: gana sobre `period`. */
  customRange: { from: string; to: string } | null;
  timezone: string;
}): string | null {
  if (args.view === "calendar") return "Se busca solo dentro de lo que muestra el calendario.";

  if (args.customRange) {
    const civil = isoRangeToCivil(args.customRange.from, args.customRange.to, args.timezone);
    return `Se busca solo dentro de: ${periodButtonLabel(null, civil)}. Cambiá el período para buscar en otras fechas.`;
  }

  if (args.period === "todo") return null;
  return `Se busca solo dentro de: ${AGENDA_PERIOD_LABELS[args.period]}. Cambiá el período para buscar en otras fechas.`;
}
