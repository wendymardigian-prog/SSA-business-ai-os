/**
 * Estado de cada clave de IA del negocio (traído de RER).
 *
 * Una clave por proveedor y por negocio, nunca de cada persona: vive en Vault
 * (`ws:<workspace>:<proveedor>_api_key`) y la fila de `integration_configs`
 * (`type = 'ai_provider'`) solo dice si está conectada y si falló.
 *
 * Tres estados, sin más: conectada, sin conectar o con error. «Con error» sale
 * de `last_error`, que se escribe cuando el proveedor rechaza la clave (401/403)
 * y se limpia al volver a guardarla. Usa la misma regla que las tarjetas de
 * Integraciones (`integrationStatus`), así las dos pantallas dicen lo mismo.
 *
 * Es puro: recibe las filas ya leídas y no consulta nada.
 */

import { integrationStatus } from "@/lib/integrations/status";

/** Los tres proveedores de las claves de IA del negocio, en el orden en que se muestran. */
export const AI_KEY_PROVIDERS = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "google_ai", label: "Google" },
] as const;

export type AiKeyProviderId = (typeof AI_KEY_PROVIDERS)[number]["id"];

export type AiKeyState = "connected" | "not_connected" | "error";

export const AI_KEY_STATE_LABELS: Record<AiKeyState, string> = {
  connected: "Conectada",
  not_connected: "Sin conectar",
  error: "Con error",
};

export interface AiKeyRow {
  provider: string;
  is_active: boolean;
  last_error?: string | null;
  updated_at?: string | null;
}

export interface AiKeyProviderState {
  id: AiKeyProviderId;
  label: string;
  state: AiKeyState;
  /** Por qué, en palabras. Vacío si está conectada. */
  reason: string | null;
}

export function aiKeyProviderStates(rows: ReadonlyArray<AiKeyRow>, now: Date = new Date()): AiKeyProviderState[] {
  return AI_KEY_PROVIDERS.map(({ id, label }) => {
    const row = rows.find((r) => r.provider === id) ?? null;
    const { status, reasons } = integrationStatus({
      config: row ? { is_active: row.is_active, last_error: row.last_error ?? null, updated_at: row.updated_at ?? null } : null,
      now,
    });
    // Sin conexión OAuth ni uso, `integrationStatus` no devuelve «attention»; si algún día lo hiciera, la clave
    // funciona: cuenta como conectada.
    const state: AiKeyState = status === "not_connected" ? "not_connected" : status === "error" ? "error" : "connected";
    const reason =
      state === "not_connected"
        ? "Todavía no se guardó una clave."
        : state === "error"
          ? (reasons[0] ?? "El proveedor rechazó la clave.")
          : null;
    return { id, label, state, reason };
  });
}

/** El texto que se guarda en `last_error` cuando el proveedor rechaza la clave. Nunca lleva la clave ni el pedido. */
export function aiKeyRejectedMessage(label: string, status: number): string {
  return `${label} rechazó la clave (HTTP ${status}). Reemplazala en Ajustes › Integraciones.`;
}

/** Un fallo de la clave (y no del modelo ni de la red): 401 o 403. */
export function isAiKeyRejection(status: number | null | undefined): boolean {
  return status === 401 || status === 403;
}

/** El código de intento de las tareas de IA (`api_401:...`) dice si fue la clave. */
export function rejectionStatusFromAttempt(problem: string): number | null {
  const m = /^api_(401|403)\b/.exec(problem);
  return m ? Number(m[1]) : null;
}
