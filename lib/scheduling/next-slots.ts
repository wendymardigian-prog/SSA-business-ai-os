/**
 * Cuando dos personas piden el mismo hueco a la vez, la base deja pasar una sola (la exclusión
 * `bookings_no_overlap`, 23P01). A la que pierde no le basta con «ese horario se acaba de ocupar»: se le proponen
 * los huecos libres siguientes del mismo anfitrión y el mismo evento, para que elija uno y lo confirme. Nada se
 * reserva solo: la propuesta es una lista de horarios, y reservar uno pasa otra vez por toda la comprobación.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { availableSlots } from "@/lib/scheduling/slots";
import { buildSlotsInput } from "@/lib/scheduling/data/slots-input";

type Db = SupabaseClient<Database>;
type EventRow = Database["public"]["Tables"]["event_types"]["Row"];
type ProfileRow = Database["public"]["Tables"]["scheduling_profiles"]["Row"];

/** Cuántos huecos se proponen y hasta dónde se buscan. */
export const NEXT_SLOTS_COUNT = 3;
export const NEXT_SLOTS_WINDOW_DAYS = 14;

/**
 * Regla pura: de los horarios libres, los `count` primeros que empiezan DESPUÉS del pedido (el pedido no, porque es
 * el que se acaba de ocupar), en orden y sin repetir. Sin huecos, una lista vacía: nunca se inventa un horario.
 */
export function pickNextSlots(slotStarts: readonly string[], requestedUtc: string, count = NEXT_SLOTS_COUNT): string[] {
  const after = Date.parse(requestedUtc);
  if (!Number.isFinite(after) || count <= 0) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const s of slotStarts) {
    const t = Date.parse(s);
    if (!Number.isFinite(t) || t <= after || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.sort((a, b) => a - b).slice(0, count).map((t) => new Date(t).toISOString());
}

export interface SuggestNextSlotsOptions {
  requestedUtc: string;
  inviteeTz: string;
  now?: Date;
  ignoreMinimumNotice?: boolean;
  /** Al mover una reunión, la propia no cuenta como ocupada. */
  excludeBookingId?: string;
  /** Una reunión a mano puede durar distinto que su evento. */
  durationMinutes?: number;
}

/**
 * Los huecos siguientes con el mismo motor que ofrece los horarios (disponibilidad, excepciones, margen, Google con
 * cache). Si algo falla, una lista vacía: la propuesta es una ayuda y nunca tumba la respuesta del choque.
 */
export async function suggestNextSlots(service: Db, event: EventRow, profile: ProfileRow, opts: SuggestNextSlotsOptions): Promise<string[]> {
  try {
    const from = new Date(Math.max(Date.parse(opts.requestedUtc), (opts.now ?? new Date()).getTime())).toISOString();
    const to = new Date(Date.parse(from) + NEXT_SLOTS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const ev = opts.durationMinutes && opts.durationMinutes > 0 ? { ...event, duration_minutes: Math.round(opts.durationMinutes) } : event;
    const built = await buildSlotsInput(service, ev, profile, {
      from,
      to,
      inviteeTz: opts.inviteeTz,
      now: opts.now,
      ignoreMinimumNotice: opts.ignoreMinimumNotice,
      excludeBookingId: opts.excludeBookingId,
    });
    if (!built.ok) return [];
    return pickNextSlots(availableSlots(built.input).map((s) => s.startUtc), opts.requestedUtc);
  } catch (e) {
    console.error("[agenda] no pude calcular los huecos siguientes:", e instanceof Error ? e.message : "error");
    return [];
  }
}
