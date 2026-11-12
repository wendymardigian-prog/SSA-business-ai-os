-- ============================================================
-- 00365_slack.sql
-- ============================================================
-- Servicios A4, F133 y F158 (plano: A4-M9): Slack como canal de avisos y destino de la accion «Enviar a Slack».
--
--   * `user_profiles.slack_user_id`: el ID de Slack de cada persona (U… o W…), cargado en Mi cuenta. NULL = sin cargar.
--     Solo su propia fila, con la RLS de siempre de `user_profiles` (00273).
--   * `integration_configs.type` suma 'slack' (el token del bot va en Vault, como el resto). El CHECK se arma desde
--     el que esta EN LA BASE (`pg_get_constraintdef`), sin sacar ningun valor.
--
-- Aditiva + amplia un CHECK. Como volver atras (si no hay filas con type = 'slack'; si las hay, borrarlas antes):
--   ALTER TABLE public.user_profiles DROP COLUMN IF EXISTS slack_user_id;
--   ALTER TABLE public.integration_configs DROP CONSTRAINT IF EXISTS integration_configs_type_check;
--   ALTER TABLE public.integration_configs ADD CONSTRAINT integration_configs_type_check
--     CHECK (type IN ('channel','ai_provider','email_provider','social_network','publishing_service','google','meta'));

ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS slack_user_id text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_slack_user_id_check') THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_slack_user_id_check CHECK (slack_user_id IS NULL OR slack_user_id ~ '^[UW][A-Z0-9]{2,}$');
  END IF;
END $$;

COMMENT ON COLUMN public.user_profiles.slack_user_id IS
  'El ID de Slack de la persona (U… o W…) para los avisos por mensaje directo (Servicios A4, F133). NULL = sin cargar.';

-- El CHECK de integration_configs.type, ampliado desde el vigente (nunca se achica).
DO $$
DECLARE
  v_def text;
  v_vals text[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
  FROM pg_constraint c
  WHERE c.conrelid = 'public.integration_configs'::regclass AND c.conname = 'integration_configs_type_check';

  IF v_def IS NULL THEN
    v_vals := ARRAY['channel','ai_provider','email_provider','social_network','publishing_service','google','meta'];
  ELSE
    SELECT array_agg(m[1] ORDER BY ord) INTO v_vals
    FROM regexp_matches(v_def, '''([^'']+)''', 'g') WITH ORDINALITY AS t(m, ord);
  END IF;

  IF 'slack' = ANY (v_vals) THEN
    RETURN;
  END IF;
  v_vals := array_append(v_vals, 'slack');

  ALTER TABLE public.integration_configs DROP CONSTRAINT IF EXISTS integration_configs_type_check;
  EXECUTE format(
    'ALTER TABLE public.integration_configs ADD CONSTRAINT integration_configs_type_check CHECK (type = ANY (ARRAY[%s]))',
    (SELECT string_agg(quote_literal(v) || '::text', ', ') FROM unnest(v_vals) AS v)
  );
END $$;
