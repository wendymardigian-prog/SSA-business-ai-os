import type { IntegrationStatus } from "@/lib/integrations/status";
import type { UsageSnapshot } from "@/lib/integrations/usage";

/**
 * Lo que una conexion OAuth tiene para mostrar en la card (G3). Puro display:
 * la decision de que fecha cuenta para el ESTADO la toma `toConnectionRef`
 * (lib/integrations/connection-ref.ts), no esto.
 */
export interface OAuthConnectionSummary {
  tokenExpiresAt: string | null;
  lastRefreshedAt: string | null;
  grantedScopes: string[];
}

/**
 * Lo que el servidor le pasa a una card. Todo serializable y sin un solo valor
 * de secreto: de los secretos viaja unicamente QUE campos ya estan guardados.
 */
export interface IntegrationCardData {
  providerId: string;
  status: IntegrationStatus;
  /** Por que esta en ese estado, en palabras. Vacio si esta todo bien. */
  reasons: string[];
  /** La cuenta conectada, como se muestra ("@minegocio", "hola@dominio.com"). */
  account: string | null;
  usage: UsageSnapshot | null;
  /** Claves de `secretFields` que ya tienen un valor en Vault. */
  storedSecretKeys: string[];
  /** Los campos no secretos guardados (remitente, modelo, direccion). */
  config: Record<string, string>;
  /** Desde cuando esta conectada (`integration_configs.connected_at`), o null. */
  connectedAt: string | null;
  /**
   * La conexion OAuth del workspace (google, linkedin, threads), cuando
   * existe. `null`/ausente en una integracion que no es OAuth, o que tiene
   * Client ID y Secret guardados pero todavia nadie autorizo la cuenta (G3,
   * hallazgo preexistente: eso igual cuenta como "Conectada").
   */
  oauth?: OAuthConnectionSummary | null;
  /**
   * Solo para `google`: cuantas personas distintas tienen su propio Google
   * Calendar conectado (G4). Es por persona, asi que un sí/no mentiria.
   */
  calendarPeople?: number;
}
