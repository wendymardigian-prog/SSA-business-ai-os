/**
 * Suscripcion a emails: la UNICA puerta del estado de email de un contacto.
 *
 * Cuatro estados (`contacts.email_status`, 00270): `subscribed`, `unsubscribed`,
 * `bounced` y `complained`. Valen para las dos direcciones del contacto (email y
 * secundario). `is_subscribed` es otra cosa: las difusiones por chat, y no se toca.
 *
 * Dos reglas que no se pueden romper:
 *
 * 1. **El estado solo cambia con `set_email_status` / `set_email_status_by_address`**
 *    (00271), y desde el codigo solo con `setEmailStatus` / `setEmailStatusByAddress`
 *    de este modulo. La base lo exige con la guardia `contacts_email_status_guard`
 *    y `subscription-single-entry.test.ts` lo exige en el codigo.
 * 2. **Todo email a un contacto pasa por `canSendEmailTo`**: mira la DIRECCION en
 *    todos los contactos del workspace (vivos y borrados) en el momento de enviar.
 *    Marketing a una direccion dada de baja o con queja no sale; a una que rebota no
 *    sale nada, ni transaccional.
 *
 * "La baja gana": un proceso automatico (modo `system`) nunca vuelve a suscribir.
 * Solo la propia persona (`person`, desde la pagina de baja) o alguien del equipo
 * (`admin`) pueden, y sacar un rebote o una queja pide motivo.
 *
 * Sin imports de servidor: las funciones que hablan con la base reciben el
 * cliente (siempre el de SERVICIO: las RPC solo las ejecuta `service_role`). La
 * parte pura (gravedad, transiciones, importacion, etiquetas) se usa tambien desde
 * la pantalla.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const EMAIL_STATUSES = ["subscribed", "unsubscribed", "bounced", "complained"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

/** Quien pide el cambio: un proceso automatico, la propia persona o alguien del equipo. */
export type EmailStatusMode = "system" | "person" | "admin";

/** Marketing respeta la baja; transaccional (agenda, contratos, respuestas) solo frena un rebote. */
export type EmailCategory = "marketing" | "transactional";

export function isEmailStatus(value: unknown): value is EmailStatus {
  return typeof value === "string" && (EMAIL_STATUSES as readonly string[]).includes(value);
}

/** Gravedad: complained > bounced > unsubscribed > subscribed. Desconocido = 0. */
export function emailStatusRank(status: string | null | undefined): number {
  switch (status) {
    case "complained":
      return 4;
    case "bounced":
      return 3;
    case "unsubscribed":
      return 2;
    case "subscribed":
      return 1;
    default:
      return 0;
  }
}

/** El peor de varios estados (sin ninguno, `subscribed`). */
export function worstEmailStatus(statuses: Array<string | null | undefined>): EmailStatus {
  let worst: EmailStatus = "subscribed";
  for (const s of statuses) if (isEmailStatus(s) && emailStatusRank(s) > emailStatusRank(worst)) worst = s;
  return worst;
}

/** Igual que `public.normalize_email`: sin espacios en las puntas y en minusculas. */
export function normalizeEmailAddress(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "" ? null : v;
}

export type EmailStatusDecision = "apply" | "noop" | "kept" | "reason_required" | "invalid";

/**
 * La tabla de transiciones. Gemela de `private.email_status_decide` (00271), con los
 * casos de `subscription-transitions.cases.json`.
 */
export function decideEmailStatus(from: string, to: string, mode: string, reason?: string | null): EmailStatusDecision {
  if (mode !== "system" && mode !== "person" && mode !== "admin") return "invalid";
  if (emailStatusRank(to) === 0 || emailStatusRank(from) === 0) return "invalid";
  if (from === to) return "noop";

  if (mode === "system") {
    return to !== "subscribed" && emailStatusRank(to) > emailStatusRank(from) ? "apply" : "kept";
  }
  if (mode === "person") {
    if (from === "bounced" || from === "complained") return "kept";
    return to === "subscribed" || to === "unsubscribed" ? "apply" : "kept";
  }
  if (to === "subscribed" && (from === "bounced" || from === "complained") && !(reason ?? "").trim()) {
    return "reason_required";
  }
  return "apply";
}

// ------------------------------------------------------------
// Lo que se muestra
// ------------------------------------------------------------

export const EMAIL_STATUS_LABELS: Record<EmailStatus, string> = {
  subscribed: "Suscripto",
  unsubscribed: "Dado de baja",
  bounced: "Rebota",
  complained: "Marcó spam",
};

/** El origen del cambio, en palabras. `import:<origen>` se lee "importación (<origen>)". */
export function emailStatusSourceLabel(source: string | null | undefined): string {
  if (!source) return "alta del contacto";
  if (source.startsWith("import:")) {
    const origin = source.slice("import:".length).trim();
    return origin ? `importación (${origin})` : "importación";
  }
  const labels: Record<string, string> = {
    backfill: "estado inicial",
    unsubscribe_page: "la persona, desde el link de baja",
    one_click: "la persona, con la baja en un clic de su correo",
    admin: "alguien del equipo",
    flow: "una automatización",
    resend_bounce: "un rebote del email",
    resend_complaint: "una queja de spam",
    inherit: "la misma dirección, dada de baja en otro contacto",
    merge: "una fusión de contactos",
  };
  return labels[source] ?? source;
}

/** Los motivos de pausa de una inscripcion por la suscripcion a emails. */
export const EMAIL_PAUSE_REASONS = ["email_unsubscribed", "email_bounced", "email_complained"] as const;
export type EmailPauseReason = (typeof EMAIL_PAUSE_REASONS)[number];

export function isEmailPauseReason(reason: string | null | undefined): reason is EmailPauseReason {
  return typeof reason === "string" && (EMAIL_PAUSE_REASONS as readonly string[]).includes(reason);
}

export const EMAIL_PAUSE_LABELS: Record<EmailPauseReason, string> = {
  email_unsubscribed: "Se dio de baja de los emails",
  email_bounced: "El email rebota",
  email_complained: "Marcó el email como spam",
};

/** `****@gmail.com` → `w***@gmail.com`: lo unico que muestra la pagina publica de baja. */
export function maskEmailAddress(address: string | null | undefined): string {
  const v = (address ?? "").trim();
  const at = v.lastIndexOf("@");
  if (at < 1) return "***";
  return `${v[0]}***${v.slice(at)}`;
}

// ------------------------------------------------------------
// Importacion (E6)
// ------------------------------------------------------------

function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const IMPORT_STATUS_VALUES: Record<string, EmailStatus> = {
  true: "subscribed",
  si: "subscribed",
  "1": "subscribed",
  yes: "subscribed",
  subscribed: "subscribed",
  suscripto: "subscribed",
  suscrito: "subscribed",
  suscripta: "subscribed",
  suscrita: "subscribed",
  false: "unsubscribed",
  no: "unsubscribed",
  "0": "unsubscribed",
  unsubscribed: "unsubscribed",
  "dado de baja": "unsubscribed",
  "dada de baja": "unsubscribed",
  baja: "unsubscribed",
  bounced: "bounced",
  bounce: "bounced",
  rebota: "bounced",
  rebotado: "bounced",
  complained: "complained",
  complaint: "complained",
  spam: "complained",
};

/**
 * El valor de la columna "Suscripcion a emails" de una planilla. Sin importar
 * mayusculas ni acentos. `null` = vacio o no reconocido (es un error de fila).
 */
export function parseImportSubscription(raw: string | null | undefined): EmailStatus | null {
  const key = fold(raw ?? "");
  if (!key) return null;
  return IMPORT_STATUS_VALUES[key] ?? null;
}

/**
 * El "motivo de la baja" de otro sistema. `bounce` → rebota, `complaint` → spam;
 * cualquier otro (`email_footer`, `one_click_header`, `admin_manual`...) es una
 * baja comun. El valor original se guarda en el evento (`original_source`).
 */
export function mapUnsubscribeSource(raw: string | null | undefined): { status: EmailStatus; original: string } | null {
  const original = (raw ?? "").trim();
  if (!original) return null;
  const key = fold(original);
  if (key === "bounce" || key === "bounced" || key === "hard bounce") return { status: "bounced", original };
  if (key === "complaint" || key === "complained" || key === "spam") return { status: "complained", original };
  return { status: "unsubscribed", original };
}

// ------------------------------------------------------------
// Hablar con la base (siempre con el cliente de servicio)
// ------------------------------------------------------------

type Rpc = Pick<SupabaseClient, "rpc">;

export interface SetEmailStatusResult {
  status: EmailStatus | null;
  previousStatus: EmailStatus | null;
  changed: boolean;
  keptExisting: boolean;
  contactsChanged: number;
  enrollmentsPaused: number;
  notFound: boolean;
}

export interface SetEmailStatusInput {
  status: EmailStatus;
  /** De donde viene: unsubscribe_page, one_click, admin, flow, resend_bounce, resend_complaint, import:<origen>. */
  source: string;
  mode: EmailStatusMode;
  /** La fecha real del hecho (una importacion: la original). Nunca queda en el futuro. */
  occurredAt?: string | null;
  reason?: string | null;
  /** Quien lo hizo. Null = el sistema o la propia persona. */
  performedBy?: string | null;
  /** Fecha del consentimiento original (importacion). */
  subscribedAt?: string | null;
  /** Datos extra para el historial (por ejemplo `original_source`). Sin datos sensibles. */
  extra?: Record<string, unknown>;
}

/** Un error de la base con su codigo (EM001 invalido, EM002 falta motivo). */
export class EmailStatusError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message);
    this.name = "EmailStatusError";
  }
}

function toResult(data: unknown): SetEmailStatusResult {
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    status: isEmailStatus(d.status) ? d.status : null,
    previousStatus: isEmailStatus(d.previous_status) ? d.previous_status : null,
    changed: d.changed === true,
    keptExisting: d.kept_existing === true,
    contactsChanged: typeof d.contacts_changed === "number" ? d.contacts_changed : 0,
    enrollmentsPaused: typeof d.enrollments_paused === "number" ? d.enrollments_paused : 0,
    notFound: d.not_found === true,
  };
}

function rpcArgs(input: SetEmailStatusInput) {
  return {
    p_status: input.status,
    p_source: input.source,
    p_occurred_at: input.occurredAt ?? null,
    p_reason: input.reason ?? null,
    p_performed_by: input.performedBy ?? null,
    p_mode: input.mode,
    p_subscribed_at: input.subscribedAt ?? null,
    p_extra: input.extra ?? {},
  };
}

/** Cambia el estado de un contacto (y de todos los del workspace que comparten su direccion). */
export async function setEmailStatus(
  service: Rpc,
  contactId: string,
  input: SetEmailStatusInput & { address?: string | null },
): Promise<SetEmailStatusResult> {
  const { data, error } = await service.rpc("set_email_status", {
    p_contact_id: contactId,
    p_address: input.address ?? null,
    ...rpcArgs(input),
  });
  if (error) throw new EmailStatusError(error.message, (error as { code?: string }).code ?? null);
  return toResult(data);
}

/** Cambia el estado de una direccion en todos los contactos del workspace que la tienen. */
export async function setEmailStatusByAddress(
  service: Rpc,
  workspaceId: string,
  address: string,
  input: SetEmailStatusInput,
): Promise<SetEmailStatusResult> {
  const { data, error } = await service.rpc("set_email_status_by_address", {
    p_workspace_id: workspaceId,
    p_email: address,
    ...rpcArgs(input),
  });
  if (error) throw new EmailStatusError(error.message, (error as { code?: string }).code ?? null);
  return toResult(data);
}

// ------------------------------------------------------------
// La puerta de envio
// ------------------------------------------------------------

export type EmailSkipReason = "unsubscribed" | "bounced" | "complained" | "do_not_contact" | "unverifiable";

export type EmailGate =
  | { ok: true; status: EmailStatus; matched: boolean; token: string | null }
  | { ok: false; reason: EmailSkipReason; status: EmailStatus | null; message: string };

/** El estado que queda en `email_log` cuando se saltea un envio (00272). */
export const EMAIL_SKIP_LOG_STATUS: Record<EmailSkipReason, string> = {
  unsubscribed: "skipped_unsubscribed",
  bounced: "skipped_bounced",
  complained: "skipped_complained",
  do_not_contact: "skipped_do_not_contact",
  unverifiable: "skipped_unverifiable",
};

export const EMAIL_SKIP_MESSAGES: Record<EmailSkipReason, string> = {
  unsubscribed: "No se mandó: la persona se dio de baja de los emails.",
  bounced: "No se mandó: el email de esta persona rebota.",
  complained: "No se mandó: la persona marcó un email como spam.",
  do_not_contact: "No se mandó: el contacto está marcado «no contactar».",
  unverifiable: "No se mandó: no pude comprobar si la persona se dio de baja.",
};

export interface CanSendInput {
  workspaceId: string;
  address: string;
  category: EmailCategory;
  /** El contacto del envio, si hay uno (para el token del pie). */
  contactId?: string | null;
  /**
   * `true` = respeta "no contactar" de cualquier contacto VIVO con esa direccion.
   * Lo pasan los caminos que hoy lo respetan; los transaccionales que la persona
   * pidio (agenda, contratos) no lo pasan.
   */
  honorDoNotContact?: boolean;
}

/**
 * El estado efectivo de una direccion (el peor entre todos los contactos que la
 * tienen, vivos y borrados). Para avisar ANTES de mandar (la bandeja). `null` si
 * la base no contesto: quien llama decide.
 */
export async function addressEmailStatus(service: Rpc, workspaceId: string, address: string): Promise<EmailStatus | null> {
  const normalized = normalizeEmailAddress(address);
  if (!normalized) return "subscribed";
  const { data, error } = await service.rpc("email_address_status", { p_workspace_id: workspaceId, p_email: normalized });
  if (error) return null;
  return isEmailStatus(data) ? data : "subscribed";
}

/**
 * La regla pura, a partir del estado de la direccion. Separada para testearla sin base.
 */
export function decideSend(input: {
  status: EmailStatus;
  category: EmailCategory;
  doNotContact: boolean;
  honorDoNotContact: boolean;
}): EmailSkipReason | null {
  if (input.status === "bounced") return "bounced";
  if (input.honorDoNotContact && input.doNotContact) return "do_not_contact";
  if (input.category === "marketing" && input.status === "unsubscribed") return "unsubscribed";
  if (input.category === "marketing" && input.status === "complained") return "complained";
  return null;
}

/**
 * Se puede mandar este email a esta direccion?
 *
 * Mira la direccion en TODOS los contactos del workspace (vivos y borrados), en el
 * momento de enviar (`email_address_send_state`). Si la base no contesta: un
 * marketing NO sale (preferimos no mandar a mandarle a alguien dado de baja); un
 * transaccional sale (no dejamos a alguien sin su confirmacion por un error nuestro).
 */
export async function canSendEmailTo(service: Rpc, input: CanSendInput): Promise<EmailGate> {
  const address = normalizeEmailAddress(input.address);
  if (!address) return { ok: true, status: "subscribed", matched: false, token: null };

  const { data, error } = await service.rpc("email_address_send_state", {
    p_workspace_id: input.workspaceId,
    p_email: address,
    p_contact_id: input.contactId ?? null,
  });

  if (error || !data) {
    console.error(`[email] no pude comprobar el estado de la direccion (code=${(error as { code?: string } | null)?.code ?? "?"})`);
    if (input.category === "marketing") {
      return { ok: false, reason: "unverifiable", status: null, message: EMAIL_SKIP_MESSAGES.unverifiable };
    }
    return { ok: true, status: "subscribed", matched: false, token: null };
  }

  const d = data as { status?: unknown; do_not_contact?: unknown; token?: unknown; matched?: unknown };
  const status: EmailStatus = isEmailStatus(d.status) ? d.status : "subscribed";
  const skip = decideSend({
    status,
    category: input.category,
    doNotContact: d.do_not_contact === true,
    honorDoNotContact: input.honorDoNotContact === true,
  });
  if (skip) return { ok: false, reason: skip, status, message: EMAIL_SKIP_MESSAGES[skip] };
  return { ok: true, status, matched: d.matched === true, token: typeof d.token === "string" ? d.token : null };
}
