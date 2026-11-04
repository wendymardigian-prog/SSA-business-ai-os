/**
 * La lista de estado de la tarjeta Resend (conexion de Resend, R5): ✓ / ✗ y que hacer en cada caso.
 *
 * Pura: la arma la pantalla con lo que vino del servidor al abrir (config, si el secreto esta en Vault, el ultimo
 * aviso) y, despues de "Probar", con lo que contesto Resend (la key, el webhook y los dominios, solo lectura).
 */

import { RESEND_WEBHOOK_EVENTS_LIST } from "./resend-events";
import { primaryAddress, storedMissingEvents, storedMissingOptionalEvents, type ResendConnectionState } from "./resend-config";
import { isVerifiedDomain, receivingState, RECEIVING_STATE_LABELS, type ResendDomain } from "./senders";

export type CheckStatus = "ok" | "fail" | "na";

export interface CheckItem {
  id: "key" | "sender" | "webhook" | "receiving" | "last_event";
  status: CheckStatus;
  title: string;
  /** Que hacer (o el detalle). */
  detail: string | null;
}

export interface LiveResult {
  key: { ok: true; access: "full" | "sending" } | { ok: false; error: string };
  webhook:
    | { checked: false; reason: string }
    | { checked: true; found: false }
    | { checked: true; found: true; missing: string[]; disabled: boolean };
}

export interface ChecklistInput {
  connected: boolean;
  state: ResendConnectionState;
  fromEmail: string | null;
  /** Los dominios de la cuenta, o null si no se pudieron listar (key de solo envio, Resend caido) o no se pidieron. */
  domains: ResendDomain[] | null;
  /** El secreto del webhook esta en Vault (null: no se sabe). */
  secretSaved: boolean | null;
  lastEventAt: string | null;
  /** Lo que dijo "Probar". */
  live?: LiveResult | null;
  now?: Date;
}

/** "hace 5 minutos", "hace 3 horas", "hace 2 días". */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "hace un rato";
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return "hace menos de un minuto";
  if (minutes < 60) return `hace ${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} ${hours === 1 ? "hora" : "horas"}`;
  const days = Math.round(hours / 24);
  return `hace ${days} ${days === 1 ? "día" : "días"}`;
}

export function resendChecklist(input: ChecklistInput): CheckItem[] {
  const { state, live } = input;
  const access = live?.key.ok ? live.key.access : state.access;
  const items: CheckItem[] = [];

  // 1. La key.
  if (!input.connected) {
    items.push({ id: "key", status: "fail", title: "API key de Resend", detail: "Pegá la API key (resend.com/api-keys) y tocá Guardar." });
  } else if (live && !live.key.ok) {
    items.push({ id: "key", status: "fail", title: "API key de Resend", detail: live.key.error });
  } else if (access === "full") {
    items.push({ id: "key", status: "ok", title: "API key conectada · acceso completo", detail: null });
  } else if (access === "sending") {
    items.push({
      id: "key",
      status: "ok",
      title: "API key conectada · solo envío",
      detail: "Manda emails, pero no deja ver dominios ni crear el webhook: esos dos se hacen a mano (abajo).",
    });
  } else {
    items.push({ id: "key", status: "ok", title: "API key conectada", detail: "Tocá «Probar» para saber si es de acceso completo." });
  }

  // 2. El remitente.
  const sender = input.fromEmail?.trim().toLowerCase() ?? "";
  const senderDomain = sender.includes("@") ? sender.split("@")[1] : null;
  if (!sender) {
    items.push({ id: "sender", status: "fail", title: "Remitente", detail: "Elegí desde qué dirección salen los emails (Remitentes, abajo)." });
  } else if (!input.domains) {
    items.push({ id: "sender", status: "na", title: `Remitente: ${sender}`, detail: "No se pudo comprobar el dominio desde acá (miralo en resend.com/domains)." });
  } else {
    const match = input.domains.find((d) => d.name === senderDomain);
    items.push(
      match && isVerifiedDomain(match)
        ? { id: "sender", status: "ok", title: `Remitente con dominio verificado: ${sender}`, detail: null }
        : { id: "sender", status: "fail", title: `Remitente: ${sender}`, detail: `El dominio ${senderDomain} no está verificado en Resend: los emails no salen hasta verificarlo.` },
    );
  }

  // 3. El webhook.
  // Cuantos de los eventos de SSA tiene (sin dato guardado, todos). Los de resultados que falten se sugieren, sin rojo.
  const optionalMissing = storedMissingOptionalEvents(state);
  const total = state.webhook.events.length > 0 ? RESEND_WEBHOOK_EVENTS_LIST.filter((e) => state.webhook.events.includes(e)).length : RESEND_WEBHOOK_EVENTS_LIST.length;
  const liveWebhook = live?.webhook;
  const missing = liveWebhook?.checked && liveWebhook.found ? liveWebhook.missing : storedMissingEvents(state);
  const webhookFail = (detail: string): CheckItem => ({ id: "webhook", status: "fail", title: "Webhook", detail });
  if (liveWebhook?.checked && !liveWebhook.found) {
    items.push(webhookFail("No hay un webhook de SSA en tu cuenta de Resend. Tocá «Conectar webhook automáticamente»."));
  } else if (state.webhook.needsSecret) {
    items.push(webhookFail("El webhook está, pero falta pegar su Signing secret (sección Webhook)."));
  } else if (input.secretSaved === false) {
    items.push(webhookFail("Falta conectar: sin él no se registran rebotes, quejas ni emails entrantes."));
  } else if ((state.webhook.id || (liveWebhook?.checked && liveWebhook.found)) && missing.length > 0) {
    items.push(webhookFail(`Le faltan eventos (${missing.join(", ")}). Tocá «Actualizar webhook».`));
  } else if (liveWebhook?.checked && liveWebhook.found && liveWebhook.disabled) {
    items.push(webhookFail("Está desactivado en Resend: activalo en resend.com/webhooks."));
  } else if (input.secretSaved === null) {
    items.push({ id: "webhook", status: "na", title: "Webhook", detail: "No se pudo comprobar si el secreto está guardado. Probá de nuevo." });
  } else {
    items.push({
      id: "webhook",
      status: "ok",
      title: state.webhook.id || liveWebhook?.checked ? `Webhook conectado · ${total} eventos` : "Webhook con secreto guardado",
      detail:
        state.webhook.id || liveWebhook?.checked
          ? optionalMissing.length > 0 && state.webhook.events.length > 0
            ? "Sumá las entregas, aperturas y clics para ver los resultados de cada envío: tocá «Actualizar webhook»."
            : null
          : "Creado a mano: tocá «Probar» para ver que tenga los eventos de rebotes, quejas y emails entrantes.",
    });
  }

  // 4. La recepcion (opcional).
  if (!state.receiving.enabled) {
    items.push({ id: "receiving", status: "na", title: "Recepción de emails: apagada", detail: "Es opcional: prendela si querés recibir emails en la bandeja." });
  } else {
    const address = primaryAddress(state.receiving);
    const domain = input.domains?.find((d) => d.name === state.receiving.domain) ?? null;
    if (!input.domains || !domain) {
      items.push({
        id: "receiving",
        status: "na",
        title: `Recepción en ${state.receiving.domain}`,
        detail: input.domains ? "Ese dominio ya no aparece en tu cuenta de Resend." : "No se pudo comprobar el dominio desde acá (miralo en resend.com/domains).",
      });
    } else {
      const r = receivingState(domain);
      items.push({
        id: "receiving",
        status: r === "active" ? "ok" : r === "unknown" ? "na" : "fail",
        title: r === "active" ? `Recepción activa en ${state.receiving.domain}${address ? ` (principal: ${address})` : ""}` : `Recepción en ${state.receiving.domain}`,
        detail: r === "active" ? null : RECEIVING_STATE_LABELS[r],
      });
    }
  }

  // 5. El ultimo aviso.
  items.push(
    input.lastEventAt
      ? { id: "last_event", status: "ok", title: `Último aviso recibido ${timeAgo(input.lastEventAt, input.now)}`, detail: null }
      : { id: "last_event", status: "na", title: "Todavía no llegó ningún aviso", detail: "Llega con el primer rebote, queja o email entrante." },
  );

  return items;
}
