-- 00113: comentarios con su publicacion en la red, error de perfil y lectura
-- de metricas por permiso (Contenido v3, B10: F76, F75, F78).
--
-- Aditiva e idempotente: no borra ni modifica datos existentes.
--
-- 1. social_post_comments.external_post_id: el id del post en la red. Sin
--    esto los comentarios que llegaron antes de tener la cuenta social no se
--    pueden vincular despues (F76). Los 167 actuales quedan en null.
-- 2. social_accounts.profile_sync_error: el error de la ultima lectura de
--    perfil. Antes se sellaba profile_synced_at aunque la lectura fallara y
--    el error solo iba al log (F75).
-- 3. Lectura de metricas y comentarios: pasa de "solo admins" a los permisos
--    social.view y dashboards.content.view (F78). has_permission devuelve
--    true para owner y admin, asi que no les quita nada. meta_ads_insights_daily
--    no se toca: sigue con su regla propia.

ALTER TABLE public.social_post_comments
  ADD COLUMN IF NOT EXISTS external_post_id text;

CREATE INDEX IF NOT EXISTS idx_post_comments_external_post
  ON public.social_post_comments (workspace_id, platform, external_post_id)
  WHERE external_post_id IS NOT NULL;

ALTER TABLE public.social_accounts
  ADD COLUMN IF NOT EXISTS profile_sync_error text;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'social_post_metrics_daily',
    'social_account_metrics_daily',
    'social_post_comments'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_select_admin" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_select_permission" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "%1$s_select_permission" ON public.%1$I
         FOR SELECT TO authenticated
         USING (
           public.has_permission(workspace_id, ''social.view'')
           OR public.has_permission(workspace_id, ''dashboards.content.view'')
         )',
      t
    );
  END LOOP;
END $$;
