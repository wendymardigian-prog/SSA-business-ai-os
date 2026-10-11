/**
 * Direcciones de Fathom (validadas contra la API real por prevxcrm, plan gratis).
 * Un modulo sin imports: lo usan el adaptador de OAuth, el cliente de la API y
 * los tests.
 */
export const FATHOM_AUTHORIZE_URL = "https://fathom.video/external/v1/oauth2/authorize";
export const FATHOM_TOKEN_URL = "https://api.fathom.ai/external/v1/oauth2/token";
export const FATHOM_API_BASE = "https://api.fathom.ai/external/v1";
export const FATHOM_SCOPE = "public_api";
