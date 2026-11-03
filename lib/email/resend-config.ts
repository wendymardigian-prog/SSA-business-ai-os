/**
 * La configuracion de la tarjeta Resend (conexion de Resend): lo que no son los remitentes (E8).
 *
 * Vive en `integration_configs.config` de la fila `email_provider/resend`, en claves PLANAS de texto (la pantalla
 * recibe el config como `Record<string, string>`). Volver a guardar la API key no las pisa: estan en
 * `DISCOVERED_CONFIG_KEYS` (lib/actions/integrations.ts).
 *
 * Puro: lo usan el servidor y la pantalla. Nunca hay un secreto aca (el del webhook vive en Vault).
 */

import { RESEND_WEBHOOK_EVENTS_LIST } from "./resend-events";

export const RESEND_CONNECTION_CONFIG_KEYS = [
  /** `full` (acceso completo) o `sending` (solo envio). Lo escribe la prueba de la key. */
  "access",
  /** El id del webhook de SSA en Resend. */
  "webhook_id",
  /** Los eventos que tenia al conectarlo, separados por coma. */
  "webhook_events",
  "webhook_connected_at",
  /** Cuando se guardo el secreto (al conectar o pegado a mano). Que exista lo dice Vault. */
  "webhook_secret_saved_at",
  /** "true": el webhook esta, pero Resend no devolvio su secreto y hay que pegarlo. */
  "webhook_needs_secret",
  /** "true": desactivado en Resend. */
  "webhook_disabled",
  /** "true" con la recepcion prendida. */
  "receiving_enabled",
  "receiving_domain",
  /** Lo de antes del @ de la direccion principal (default `hola`). */
  "receiving_local",
  /** Tope de emails por dia para el aviso de cuota (antes vivia en `resend_inbound`). */
  "daily_quota",
] as const;

export type ResendConnectionKey = (typeof RESEND_CONNECTION_CONFIG_KEYS)[number];

export const DEFAULT_RECEIVING_LOCAL = "hola";

export interface ResendConnectionState {
  access: "full" | "sending" | null;
  webhook: {
    id: string | null;
    events: string[];
    connectedAt: string | null;
    secretSavedAt: string | null;
    needsSecret: boolean;
    disabled: boolean;
  };
  receiving: {
    enabled: boolean;
    domain: string | null;
    local: string;
  };
}

function str(config: Record<string, unknown>, key: string): string | null {
  const value = config[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/** Lee el config de la fila `resend`. Lo que falta, con su default. */
export function readResendConnection(config: unknown): ResendConnectionState {
  const c = (config && typeof config === "object" && !Array.isArray(config) ? config : {}) as Record<string, unknown>;
  const access = str(c, "access");
  return {
    access: access === "full" || access === "sending" ? access : null,
    webhook: {
      id: str(c, "webhook_id"),
      events: (str(c, "webhook_events") ?? "").split(",").map((e) => e.trim()).filter(Boolean),
      connectedAt: str(c, "webhook_connected_at"),
      secretSavedAt: str(c, "webhook_secret_saved_at"),
      needsSecret: str(c, "webhook_needs_secret") === "true",
      disabled: str(c, "webhook_disabled") === "true",
    },
    receiving: {
      enabled: str(c, "receiving_enabled") === "true",
      domain: str(c, "receiving_domain")?.toLowerCase() ?? null,
      local: str(c, "receiving_local")?.toLowerCase() ?? DEFAULT_RECEIVING_LOCAL,
    },
  };
}

/** La direccion principal (para escribir primero desde la bandeja), o null sin dominio. */
export function primaryAddress(state: ResendConnectionState["receiving"]): string | null {
  return state.domain ? `${state.local}@${state.domain}` : null;
}

/** Los eventos de SSA que le faltan al webhook guardado. */
export function storedMissingEvents(state: ResendConnectionState): string[] {
  const have = new Set(state.webhook.events);
  return RESEND_WEBHOOK_EVENTS_LIST.filter((e) => !have.has(e));
}

/**
 * Lo de antes del @ de la direccion principal: letras, numeros, punto, guion y guion bajo. Devuelve el usuario
 * normalizado o un error para la pantalla.
 */
export function validateReceivingLocal(value: string): { ok: true; local: string } | { ok: false; error: string } {
  const local = value.trim().toLowerCase() || DEFAULT_RECEIVING_LOCAL;
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(local) || local.includes("..")) {
    return { ok: false, error: "El usuario de la dirección principal solo puede tener letras, números, punto, guion y guion bajo (ej. hola)." };
  }
  return { ok: true, local };
}

/** Un dominio con forma de dominio (sin @ ni espacios). */
export function normalizeDomain(value: string): string | null {
  const d = value.trim().toLowerCase().replace(/^@/, "");
  return /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(d) ? d : null;
}

/** Lo que la tarjeta Resend necesita al abrir (lo arma el servidor sin llamar a Resend). Nunca un secreto. */
export interface ResendPanelData {
  /** La URL del webhook de este negocio (con `?w=`), o null si la app no tiene dominio publico. */
  webhookUrl: string | null;
  state: ResendConnectionState;
  /** El secreto del webhook esta en Vault (null: no se sabe). */
  secretSaved: boolean | null;
  lastEventAt: string | null;
}
