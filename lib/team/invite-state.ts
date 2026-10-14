/**
 * El estado de una invitación, derivado (Equipo y roles, F8).
 *
 * `workspace_invites.status` guarda tres valores (pending | accepted | revoked): "vencida" NO se
 * guarda, se deduce de `expires_at`. Un módulo puro para que la lista, el historial, el link y las
 * acciones digan siempre lo mismo.
 */

export type InviteState = "pending" | "expired" | "accepted" | "revoked";

export interface InviteLike {
  status: string;
  expires_at: string | null;
}

export function inviteState(invite: InviteLike, now: Date = new Date()): InviteState {
  if (invite.status === "accepted") return "accepted";
  if (invite.status === "revoked") return "revoked";
  if (invite.expires_at && new Date(invite.expires_at).getTime() < now.getTime()) return "expired";
  return "pending";
}

/** Se puede abrir y aceptar solo mientras está pendiente y no venció. */
export function inviteIsOpen(invite: InviteLike, now: Date = new Date()): boolean {
  return inviteState(invite, now) === "pending";
}

// ── Reenviar y renovar ───────────────────────────────────────────────────

/** Entre un envío y el siguiente tienen que pasar al menos estos segundos. */
export const RESEND_COOLDOWN_SECONDS = 60;
/** Tope de envíos por invitación (el primero cuenta). */
export const MAX_SENDS = 5;
/** Una invitación vale 7 días desde que se crea o se renueva. */
export const INVITE_TTL_DAYS = 7;

export type ResendCheck =
  | { ok: true }
  | { ok: false; reason: "not_open" | "too_soon" | "limit"; error: string; waitSeconds?: number };

/** Si se puede volver a mandar el email de esta invitación ahora. */
export function canResend(
  invite: InviteLike & { send_count: number | null; last_sent_at: string | null },
  now: Date = new Date(),
): ResendCheck {
  const state = inviteState(invite, now);
  if (state === "accepted" || state === "revoked") {
    return { ok: false, reason: "not_open", error: "Esta invitación ya no es válida." };
  }
  if ((invite.send_count ?? 0) >= MAX_SENDS) {
    return { ok: false, reason: "limit", error: `Ya se mandó ${MAX_SENDS} veces. Pasale el link por otro medio.` };
  }
  if (invite.last_sent_at) {
    const elapsed = (now.getTime() - new Date(invite.last_sent_at).getTime()) / 1000;
    if (elapsed < RESEND_COOLDOWN_SECONDS) {
      const waitSeconds = Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed);
      return { ok: false, reason: "too_soon", waitSeconds, error: `Esperá ${waitSeconds} segundos antes de volver a mandarla.` };
    }
  }
  return { ok: true };
}

/** El nuevo vencimiento al renovar: 7 días desde ahora. */
export function renewedExpiry(now: Date = new Date()): string {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

// ── Qué se muestra ───────────────────────────────────────────────────────

export interface InviteDeliveryLike {
  delivery: string | null;
  email_status: string | null;
}

/** El chip de envío de la fila: cómo se mandó y cómo salió. */
export function deliveryChip(invite: InviteDeliveryLike): { label: string; tone: "ok" | "warn" | "neutral" } {
  if (invite.delivery === "link") return { label: "Solo link", tone: "neutral" };
  switch (invite.email_status) {
    case "sent":
      return { label: "Email enviado", tone: "ok" };
    case "failed":
      return { label: "Email falló", tone: "warn" };
    case "not_configured":
      return { label: "Email sin configurar", tone: "warn" };
    default:
      // Invitaciones de antes de esta función: se mandaron por email y no quedó el resultado.
      return { label: "Email", tone: "neutral" };
  }
}

/** El mensaje cuando alguien abre un link que ya no sirve. */
export function invalidInviteMessage(state: InviteState): { title: string; hint: string | null } {
  if (state === "expired") {
    return { title: "Esta invitación ya no es válida", hint: "Venció. Pedile a quien te invitó que la renueve." };
  }
  return { title: "Esta invitación ya no es válida", hint: null };
}
