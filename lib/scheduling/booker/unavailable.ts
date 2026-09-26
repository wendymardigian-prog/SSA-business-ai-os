/**
 * Mensajes cuando no se puede agendar (F58): textos por defecto, esquema de
 * `event_types.unavailable_messages`, resolución del mensaje de cada caso y
 * el `href` del botón (WhatsApp, email o link).
 *
 * El texto se muestra siempre como texto plano: acá solo se reemplazan
 * `{{event_title}}` y `{{host_name}}`; nada se interpreta como HTML.
 */
import { z } from "zod";
import type { EventType, UnavailableCta, UnavailableKey, UnavailableMessage, UnavailableMessages } from "../types";
import { normalizePhone } from "@/lib/phone";
import { isSafeRedirectUrl } from "../event-validation";

export const UNAVAILABLE_KEYS: UnavailableKey[] = ["no_slots", "unavailable", "load_error"];

export const UNAVAILABLE_KEY_LABELS: Record<UnavailableKey, string> = {
  no_slots: "Sin horarios",
  unavailable: "No disponible",
  load_error: "No carga",
};

export const DEFAULT_UNAVAILABLE_MESSAGES: Record<UnavailableKey, UnavailableMessage> = {
  no_slots: {
    title: "No hay horarios disponibles por ahora",
    body: "Todos los espacios de {{event_title}} están tomados. Escribinos y te buscamos un lugar.",
  },
  unavailable: {
    title: "No podemos mostrar los horarios en este momento",
    body: "Probá de nuevo en unos minutos o escribinos.",
  },
  load_error: {
    title: "No pudimos cargar el calendario",
    body: "Revisá tu conexión y probá de nuevo, o escribinos.",
  },
};

/** Los casos que suman el botón "Reintentar" en el booker. */
export function showsRetry(key: UnavailableKey): boolean {
  return key !== "no_slots";
}

export const TITLE_MAX = 80;
export const BODY_MAX = 500;
export const CTA_LABEL_MAX = 40;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const unavailableCtaSchema = z
  .object({
    label: z.string().trim().min(1, "El botón necesita un texto").max(CTA_LABEL_MAX),
    kind: z.enum(["whatsapp", "email", "link"]),
    value: z.string().trim().min(1, "Completá el destino del botón"),
    prefill: z.string().max(BODY_MAX).optional(),
  })
  .superRefine((cta, ctx) => {
    if (cta.kind === "whatsapp" && !normalizePhone(cta.value)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Escribí el número en formato internacional (+506 8888-1234)" });
    }
    if (cta.kind === "email" && !EMAIL_RE.test(cta.value)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Email inválido" });
    }
    if (cta.kind === "link" && !isSafeRedirectUrl(cta.value)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "El link tiene que empezar con https://" });
    }
  });

export const unavailableMessageSchema = z.object({
  title: z.string().trim().min(1, "El título es obligatorio").max(TITLE_MAX),
  body: z.string().trim().min(1, "El texto es obligatorio").max(BODY_MAX),
  cta: unavailableCtaSchema.optional(),
});

export const unavailableMessagesSchema = z
  .object({
    same_for_all: z.boolean(),
    no_slots: unavailableMessageSchema.optional(),
    unavailable: unavailableMessageSchema.optional(),
    load_error: unavailableMessageSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.same_for_all && !v.no_slots && !v.unavailable && !v.load_error) {
      ctx.addIssue({ code: "custom", path: [], message: "Cargá el mensaje que se usa para los tres casos" });
    }
  });

export type MessagesValidation =
  | { ok: true; data: UnavailableMessages }
  | { ok: false; errors: { path: string; message: string }[] };

export function validateUnavailableMessages(input: unknown): MessagesValidation {
  const parsed = unavailableMessagesSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data as UnavailableMessages };
  return { ok: false, errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
}

export interface MessageVars {
  event_title: string;
  host_name: string;
}

/** Reemplaza solo las dos variables permitidas; lo demás queda tal cual. */
export function replaceMessageVars(text: string, vars: MessageVars): string {
  return text.replace(/\{\{\s*(event_title|host_name)\s*\}\}/g, (_, k: keyof MessageVars) => vars[k] ?? "");
}

export interface ResolvedMessage extends UnavailableMessage {
  key: UnavailableKey;
  /** Verdadero si salió de la configuración del evento y no del texto por defecto. */
  custom: boolean;
  showRetry: boolean;
}

/**
 * El mensaje del caso: el configurado para ese caso; si `same_for_all`, el
 * único cargado; si no hay nada, el texto por defecto. Con las variables
 * reemplazadas en título, texto y precarga del botón.
 */
export function resolveUnavailableMessage(
  eventType: Pick<EventType, "unavailable_messages">,
  key: UnavailableKey,
  vars: MessageVars,
): ResolvedMessage {
  const cfg = eventType.unavailable_messages;
  let source: UnavailableMessage | undefined;
  if (cfg) {
    source = cfg.same_for_all ? (cfg.no_slots ?? cfg.unavailable ?? cfg.load_error) : cfg[key];
  }
  const custom = !!source;
  const msg = source ?? DEFAULT_UNAVAILABLE_MESSAGES[key];

  return {
    key,
    custom,
    showRetry: showsRetry(key),
    title: replaceMessageVars(msg.title, vars),
    body: replaceMessageVars(msg.body, vars),
    cta: msg.cta
      ? { ...msg.cta, prefill: msg.cta.prefill ? replaceMessageVars(msg.cta.prefill, vars) : undefined }
      : undefined,
  };
}

/**
 * El destino del botón:
 * - whatsapp: `https://wa.me/50688881234?text=<mensaje codificado>`
 * - email: `mailto:direccion?subject=<asunto codificado>`
 * - link: la URL tal cual (ya validada como https).
 * Devuelve null si el valor no sirve.
 */
export function buildCtaHref(cta: UnavailableCta, vars: MessageVars): string | null {
  const prefill = cta.prefill ? replaceMessageVars(cta.prefill, vars) : "";
  switch (cta.kind) {
    case "whatsapp": {
      const phone = normalizePhone(cta.value);
      if (!phone) return null;
      const base = `https://wa.me/${phone.slice(1)}`;
      return prefill ? `${base}?text=${encodeURIComponent(prefill)}` : base;
    }
    case "email": {
      if (!EMAIL_RE.test(cta.value.trim())) return null;
      const base = `mailto:${cta.value.trim()}`;
      return prefill ? `${base}?subject=${encodeURIComponent(prefill)}` : base;
    }
    case "link":
      return isSafeRedirectUrl(cta.value) ? cta.value : null;
    default:
      return null;
  }
}

/** Lo que viaja en `data-ssa-fallback` del snippet (F40/F58): el `load_error` ya resuelto, sin variables pendientes. */
export interface FallbackPayload {
  title: string;
  body: string;
  cta?: { label: string; href: string };
}

export function fallbackPayload(eventType: Pick<EventType, "unavailable_messages">, vars: MessageVars): FallbackPayload {
  const msg = resolveUnavailableMessage(eventType, "load_error", vars);
  const href = msg.cta ? buildCtaHref(msg.cta, vars) : null;
  return {
    title: msg.title,
    body: msg.body,
    ...(msg.cta && href ? { cta: { label: msg.cta.label, href } } : {}),
  };
}
