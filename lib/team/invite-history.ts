/**
 * El historial de invitaciones (Equipo y roles, F9): todo lo que ya no está pendiente.
 *
 * Aceptadas (con quién y cuándo), anuladas (quién y cuándo) y vencidas sin usar. Puro: la
 * pantalla le pasa las filas y lo que eligió el usuario.
 */
import { inviteState, type InviteLike, type InviteState } from "./invite-state";

export type HistoryFilter = "all" | "accepted" | "revoked" | "expired";
export const HISTORY_PAGE_SIZE = 20;

export interface HistoryInvite extends InviteLike {
  id: string;
  created_at: string | null;
  accepted_at?: string | null;
  revoked_at?: string | null;
}

export interface HistoryEntry<T extends HistoryInvite> {
  invite: T;
  state: Exclude<InviteState, "pending">;
  /** La fecha que importa de esa fila: cuando se aceptó, se anuló o venció. */
  at: string | null;
}

function dateOf(invite: HistoryInvite, state: Exclude<InviteState, "pending">): string | null {
  if (state === "accepted") return invite.accepted_at ?? invite.created_at;
  if (state === "revoked") return invite.revoked_at ?? invite.created_at;
  return invite.expires_at;
}

/** Las pendientes vigentes (las que van arriba, con acciones). */
export function pendingInvites<T extends InviteLike>(invites: T[], now: Date = new Date()): T[] {
  return invites.filter((i) => inviteState(i, now) === "pending");
}

/** Pendientes + vencidas: lo que la lista de "Invitaciones pendientes" muestra (la vencida con su estado). */
export function openInvites<T extends InviteLike>(invites: T[], now: Date = new Date()): T[] {
  return invites.filter((i) => {
    const s = inviteState(i, now);
    return s === "pending" || s === "expired";
  });
}

export function buildHistory<T extends HistoryInvite>(
  invites: T[],
  options: { filter?: HistoryFilter; page?: number; now?: Date } = {},
): { entries: HistoryEntry<T>[]; total: number; page: number; pages: number } {
  const now = options.now ?? new Date();
  const filter = options.filter ?? "all";
  const all: HistoryEntry<T>[] = [];
  for (const invite of invites) {
    const state = inviteState(invite, now);
    if (state === "pending") continue;
    if (filter !== "all" && state !== filter) continue;
    all.push({ invite, state, at: dateOf(invite, state) });
  }
  all.sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime());

  const pages = Math.max(1, Math.ceil(all.length / HISTORY_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(options.page ?? 1)), pages);
  return { entries: all.slice((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE), total: all.length, page, pages };
}
