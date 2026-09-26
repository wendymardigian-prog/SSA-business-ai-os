import type { IntegrationStatus } from "@/lib/integrations/status";
import type { UsageSnapshot } from "@/lib/integrations/usage";

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
}
