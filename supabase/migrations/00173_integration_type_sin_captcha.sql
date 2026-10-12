-- ============================================================================
-- 00173 — integration_configs.type sin 'captcha' (Formularios, correccion R1)
-- ============================================================================
-- Se saca la card de Cloudflare Turnstile de Integraciones: el tipo 'captcha' deja de existir.
-- Riesgo: medio. La lista del CHECK se LEE de la base (no se asume) y la migracion ABORTA si queda
-- alguna fila con type = 'captcha' (al 12/10/2026 no habia ninguna). Un secreto `turnstile_secret_key`
-- en Vault, si existiera, NO se borra: se anota en docs/PENDIENTE-formularios.md (al 12/10 no habia ninguno).
--
-- Definicion anterior (viva el 12/10/2026, la de la 00154), para volver atras:
--   ALTER TABLE public.integration_configs DROP CONSTRAINT integration_configs_type_check;
--   ALTER TABLE public.integration_configs ADD CONSTRAINT integration_configs_type_check
--     CHECK ((type = ANY (ARRAY['channel'::text, 'ai_provider'::text, 'email_provider'::text, 'social_network'::text,
--                              'publishing_service'::text, 'google'::text, 'meta'::text, 'captcha'::text])));
-- ============================================================================

DO $$
DECLARE
  v_def  text;
  v_rows integer;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
  FROM pg_constraint c
  WHERE c.conrelid = 'public.integration_configs'::regclass AND c.conname = 'integration_configs_type_check';

  -- Ya aplicada (o el CHECK no existe): nada que hacer.
  IF v_def IS NULL OR position('''captcha''' IN v_def) = 0 THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_rows FROM public.integration_configs WHERE type = 'captcha';
  IF v_rows > 0 THEN
    RAISE EXCEPTION 'Hay % fila(s) de integration_configs con type = captcha: no se saca el tipo', v_rows;
  END IF;

  ALTER TABLE public.integration_configs DROP CONSTRAINT integration_configs_type_check;
  ALTER TABLE public.integration_configs ADD CONSTRAINT integration_configs_type_check
    CHECK (type = ANY (ARRAY['channel'::text, 'ai_provider'::text, 'email_provider'::text, 'social_network'::text,
                             'publishing_service'::text, 'google'::text, 'meta'::text]));
END $$;
