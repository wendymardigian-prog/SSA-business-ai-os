/**
 * Nombres de los secretos que guarda el sistema en Supabase Vault.
 *
 * Vive aparte de lib/vault.ts a proposito. El catalogo de integraciones
 * (lib/integrations/providers.ts) necesita los nombres, y ese catalogo lo
 * importa tambien la pantalla, que es un Client Component: mientras los nombres
 * estaban dentro de lib/vault.ts, el modulo que habla con Vault terminaba en el
 * bundle del navegador. Los nombres no son secretos; las funciones que leen y
 * escriben, si.
 *
 * Lo garantiza `lib/vault-boundary.test.ts`: ningun archivo "use client" puede
 * llegar a lib/vault.ts siguiendo imports.
 *
 * Un nombre es un identificador estable: se guarda en
 * `integration_configs.vault_secret_name` y la RPC lo usa para armar la clave
 * real (`ws:<workspace>:<nombre>`). Renombrar uno deja el secreto viejo
 * huerfano, asi que no se renombran: se suma el nuevo y se migra.
 */

export const SECRET_NAMES = {
  // ── Canales (etapa 1) ────────────────────────────────────────────────────
  zernioApiKey: "zernio_api_key",
  /** Secreto con el que se firma el webhook de Zernio (F5: hoy vive en columnas). */
  zernioWebhookSecret: "zernio_webhook_secret",
  evolutionApiKey: "evolution_api_key",
  /** Token que Evolution manda en x-webhook-token (F4: hoy es una variable de entorno). */
  evolutionWebhookToken: "evolution_webhook_token",

  // ── Email ────────────────────────────────────────────────────────────────
  resendApiKey: "resend_api_key",
  /** Firma Svix del webhook de email entrante (B8). */
  resendInboundWebhookSecret: "resend_inbound_webhook_secret",

  // ── Proveedores de IA (BYOK) ─────────────────────────────────────────────
  openaiApiKey: "openai_api_key",
  anthropicApiKey: "anthropic_api_key",
  googleAiApiKey: "google_ai_api_key",
  voyageApiKey: "voyage_api_key",

  // ── OAuth: la app propia de cada proveedor ───────────────────────────────
  /** Clave con la que se firma el `state` del OAuth. Se genera la primera vez (F9). */
  oauthStateSecret: "oauth_state_secret",
  googleClientId: "google_client_id",
  googleClientSecret: "google_client_secret",
  linkedinClientId: "linkedin_client_id",
  linkedinClientSecret: "linkedin_client_secret",
  threadsAppId: "threads_app_id",
  threadsAppSecret: "threads_app_secret",

  // ── Servicios de publicacion y metricas ──────────────────────────────────
  postproxyApiKey: "postproxy_api_key",
  postproxyWebhookSecret: "postproxy_webhook_secret",
  /** Token de system user de Meta, para Ads y los insights de Instagram (B5). */
  metaSystemUserToken: "meta_system_user_token",
} as const;

export type SecretName = (typeof SECRET_NAMES)[keyof typeof SECRET_NAMES] | (string & {});

/** Todos los nombres, para validar que una definicion no invente uno. */
export const ALL_SECRET_NAMES: readonly string[] = Object.values(SECRET_NAMES);

/**
 * Nombre del secreto de un token de OAuth.
 *
 * Los tokens no son una lista fija: hay uno por conexion y por tipo, y
 * `oauth_connections.vault_secret_prefix` guarda el prefijo. Se arman aca para
 * que el formato viva en un solo lugar (B2).
 */
export function oauthSecretName(prefix: string, kind: "access_token" | "refresh_token"): string {
  return `${prefix}_${kind}`;
}
