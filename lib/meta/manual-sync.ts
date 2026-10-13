/**
 * "Sincronizar ahora" del dashboard de Ads (Extra L, AT2, F23).
 *
 * El boton encola el mismo job que el cron (`meta_ads_sync`). La clave de dedupe lleva un
 * BLOQUE de 10 minutos: apretar el boton cinco veces seguidas encola un solo job, y el que ya
 * estaba pendiente (del cron o de otro clic) cuenta como "ya esta en camino".
 */

const BLOCK_MS = 10 * 60 * 1000;

export function manualSyncKey(adAccountId: string, now: Date): string {
  return `meta-ads-manual:${adAccountId}:${Math.floor(now.getTime() / BLOCK_MS)}`;
}
