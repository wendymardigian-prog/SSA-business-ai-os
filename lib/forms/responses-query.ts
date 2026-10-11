/**
 * Los filtros de la tabla de respuestas, aplicados EN LA CONSULTA (F13).
 *
 * La visibilidad NO se arma acá: la decide la RLS (`can_see_form_submission`).
 * Así un Member con filtros inventados en la URL sigue viendo solo lo suyo.
 */
import { endOfDay, startOfDay } from "@/lib/dates";
import type { ResponseFilters } from "./responses";

export interface FilterableQuery<Q> {
  eq(column: string, value: unknown): Q;
  not(column: string, operator: string, value: unknown): Q;
  is(column: string, value: null): Q;
  gte(column: string, value: unknown): Q;
  lte(column: string, value: unknown): Q;
}

export function applyResponseFilters<Q extends FilterableQuery<Q>>(query: Q, filters: ResponseFilters, timeZone: string): Q {
  let q = query;
  if (filters.status && filters.status !== "all") q = q.eq("status", filters.status);
  if (filters.contact === "with") q = q.not("contact_id", "is", null);
  if (filters.contact === "without") q = q.is("contact_id", null);
  if (filters.from) {
    const [y, m, d] = filters.from.split("-").map(Number);
    q = q.gte("created_at", startOfDay(y, m, d, timeZone).toISOString());
  }
  if (filters.to) {
    const [y, m, d] = filters.to.split("-").map(Number);
    q = q.lte("created_at", endOfDay(y, m, d, timeZone).toISOString());
  }
  return q;
}

/** Fecha y hora en la zona dada, para tablas y CSV. */
export function formatInZone(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });
}
