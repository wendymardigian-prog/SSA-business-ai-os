-- ============================================================================
-- 00154 — Formularios: el tipo de integracion `captcha` (Cloudflare Turnstile)
-- ============================================================================
-- El CHECK de `integration_configs.type` suma 'captcha'. La card de Turnstile
-- guarda la site key (publica) en `config` y la secret key en Vault.
--
-- SOLO SUMA: la lista se leyo de la base viva al escribir esta migracion (no de
-- memoria) y se conservan los 7 valores que ya tenia.
--
-- Definicion VIEJA, para volver atras:
--   CHECK ((type = ANY (ARRAY['channel'::text, 'ai_provider'::text, 'email_provider'::text,
--           'social_network'::text, 'publishing_service'::text, 'google'::text, 'meta'::text])))
--
-- Como volver atras:
--   (antes) DELETE FROM public.integration_configs WHERE type = 'captcha';
--           y borrar el secreto `turnstile_secret_key` de Vault con deleteSecret.
--   ALTER TABLE public.integration_configs DROP CONSTRAINT IF EXISTS integration_configs_type_check;
--   ALTER TABLE public.integration_configs ADD CONSTRAINT integration_configs_type_check
--     CHECK (type = ANY (ARRAY['channel','ai_provider','email_provider','social_network',
--                              'publishing_service','google','meta']));
-- ============================================================================

ALTER TABLE public.integration_configs DROP CONSTRAINT IF EXISTS integration_configs_type_check;
ALTER TABLE public.integration_configs ADD CONSTRAINT integration_configs_type_check
  CHECK (type = ANY (ARRAY[
    'channel'::text,
    'ai_provider'::text,
    'email_provider'::text,
    'social_network'::text,
    'publishing_service'::text,
    'google'::text,
    'meta'::text,
    'captcha'::text
  ]));
