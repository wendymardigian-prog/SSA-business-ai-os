/**
 * La configuración de la API de Conversiones de un negocio: la fila `integration_configs` de tipo `meta` y proveedor
 * `meta_capi` (la tarjeta «Meta: API de Conversiones»). El token vive en Vault (`meta_capi_token`), nunca acá.
 *
 * Puro: lo usan el servidor y los tests. Las claves están en un solo lugar para que «Probar y guardar» las conserve.
 */

export const META_CAPI_PROVIDER_ID = "meta_capi";

/** Lo que se guarda en `config` además de lo que se escribe en el formulario genérico (se edita en su propia sección). */
export const META_CAPI_OWN_CONFIG_KEYS = ["purchase_enabled", "pixel_name"] as const;

export interface CapiConfig {
  pixelId: string;
  testEventCode: string | null;
  purchaseEnabled: boolean;
}

/** La configuración guardada, o `null` si la integración no está activa o le falta el Pixel. */
export function parseCapiConfig(row: { is_active?: boolean | null; config?: unknown } | null | undefined): CapiConfig | null {
  if (!row?.is_active) return null;
  const config = (row.config && typeof row.config === "object" && !Array.isArray(row.config) ? row.config : {}) as Record<string, unknown>;
  const pixelId = typeof config.pixel_id === "string" ? config.pixel_id.trim() : "";
  if (!/^\d{5,25}$/.test(pixelId)) return null;
  const testEventCode = typeof config.test_event_code === "string" && config.test_event_code.trim() ? config.test_event_code.trim() : null;
  return { pixelId, testEventCode, purchaseEnabled: config.purchase_enabled === "true" };
}
