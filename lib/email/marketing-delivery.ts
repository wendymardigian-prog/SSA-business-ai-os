/**
 * Lo que necesita la seccion «Entrega de marketing» (la guardia de entrega, 00287): el cupo de hoy, el calentamiento,
 * el freno y las cuentas de las ultimas 24 h. Con el cliente de servicio, DESPUES de que quien llama chequeo el permiso.
 * Nunca lanza: lo que no se puede leer queda en null y la pantalla lo dice.
 *
 * Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { emailSendCapacity } from "./delivery-guard";
import { brakeLimitsFromConfig } from "./brake-limits";
import { brakeStats } from "./marketing-brake";
import { brakeWebhookProblem, type MarketingCapacity, type MarketingDeliveryData } from "./marketing-delivery-view";
import type { ResendConnectionState } from "./resend-config";

export async function loadMarketingDelivery(
  service: SupabaseClient,
  workspaceId: string,
  input: { state: ResendConnectionState; config: Record<string, unknown>; secretSaved: boolean | null },
): Promise<MarketingDeliveryData> {
  const [capacity, stats] = await Promise.all([
    emailSendCapacity(service, workspaceId).catch(() => null),
    brakeStats(service, workspaceId).catch(() => null),
  ]);
  const saved = input.config.warmup_enabled;
  return {
    capacity: (capacity as MarketingCapacity | null) ?? null,
    stats,
    warmupSaved: saved === "true" ? true : saved === "false" ? false : null,
    webhookProblem: brakeWebhookProblem(input.state, { secretSaved: input.secretSaved }),
    brakeLimits: brakeLimitsFromConfig(input.config),
  };
}
