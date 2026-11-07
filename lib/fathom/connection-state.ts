/**
 * Que muestra la tarjeta de "Mi Fathom" (F6). Puro: la pantalla solo compone.
 *
 * Cuatro estados, en este orden de prioridad:
 *  1. `missing_app`   — el negocio todavia no cargo la app de Fathom (Client ID y Secret).
 *  2. `error`         — la conexion cayo: hay que reconectar.
 *  3. `connected`     — todo andando.
 *  4. `not_connected` — nunca conecto (o desconecto).
 */

import type { FathomMode } from "./settings";

const MODE_MESSAGE: Record<FathomMode, string> = {
  auto: "Las llamadas que grabes entran solas: se consulta Fathom cada 10 minutos.",
  rules: "Las llamadas que cumplen tus reglas entran solas: se consulta Fathom cada 10 minutos.",
  manual: "Está en manual: no entra nada solo. Traés las llamadas con Importar historial.",
};

export type FathomCardState = "missing_app" | "error" | "connected" | "not_connected";

export interface FathomConnectionInfo {
  status: string;
  account_label: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  sync_last_error: string | null;
}

export interface FathomCardInput {
  /** Hay Client ID y Secret de Fathom guardados. */
  hasApp: boolean;
  /** La conexion VIGENTE de la persona (la no revocada), o null. */
  connection: FathomConnectionInfo | null;
  /** Cuantas llamadas de Fathom trajo en los ultimos 7 dias. */
  callsLast7d: number;
  /** Que importa la conexion. Sin esto, automatico. */
  mode?: FathomMode;
}

export interface FathomCardView {
  state: FathomCardState;
  title: string;
  message: string;
  /** Hay una conexion que sirve (activa o con atencion). */
  connected: boolean;
  accountLabel: string | null;
  lastSyncedAt: string | null;
  callsLast7d: number;
  /** Un problema de la ultima consulta que NO tumbo la conexion ("Fathom pidió esperar"). */
  syncWarning: string | null;
  actions: { connect: boolean; reconnect: boolean; syncNow: boolean; disconnect: boolean };
}

const isLive = (c: FathomConnectionInfo | null): c is FathomConnectionInfo => !!c && (c.status === "active" || c.status === "attention");

/** La conexion que cuenta de una lista: la viva mas reciente, o la caida si no hay viva. */
export function pickConnection<T extends FathomConnectionInfo>(connections: T[]): T | null {
  const live = connections.find((c) => isLive(c));
  if (live) return live;
  return connections.find((c) => c.status === "error") ?? null;
}

export function fathomCardView(input: FathomCardInput): FathomCardView {
  const { hasApp, connection, callsLast7d } = input;
  const live = isLive(connection);
  const base = {
    connected: live,
    accountLabel: connection?.account_label ?? null,
    lastSyncedAt: connection?.last_synced_at ?? null,
    callsLast7d,
    syncWarning: live ? connection.sync_last_error : null,
  };

  if (!hasApp) {
    return {
      ...base, state: "missing_app", title: "Falta la app de Fathom",
      message: "Pedile a un admin que cargue la app de Fathom en Integraciones.",
      actions: { connect: false, reconnect: false, syncNow: false, disconnect: false },
    };
  }
  if (connection?.status === "error") {
    return {
      ...base, state: "error", title: "Tu Fathom dejó de funcionar",
      message: connection.last_error || "Fathom dejó de dar acceso. Tus llamadas no se pierden: al reconectar se traen las pendientes.",
      actions: { connect: false, reconnect: true, syncNow: false, disconnect: true },
    };
  }
  if (live) {
    return {
      ...base, state: "connected", title: connection.account_label ? `Conectado como ${connection.account_label}` : "Conectado",
      message: MODE_MESSAGE[input.mode ?? "auto"],
      actions: { connect: false, reconnect: false, syncNow: input.mode !== "manual", disconnect: true },
    };
  }
  return {
    ...base, state: "not_connected", title: "Conectá tu Fathom",
    message: "Así tus llamadas de venta entran solas al sistema, vinculadas a tu lead y a tu agenda.",
    actions: { connect: true, reconnect: false, syncNow: false, disconnect: false },
  };
}

/** El aviso de la lista de grabaciones: quien la ve y todavia no conecto. */
export function shouldNudgeToConnect(input: { hasLiveConnection: boolean; hasApp: boolean }): boolean {
  return !input.hasLiveConnection && input.hasApp;
}
