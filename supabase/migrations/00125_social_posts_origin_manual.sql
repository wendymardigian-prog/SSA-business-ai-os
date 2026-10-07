-- ============================================================
-- 00125_social_posts_origin_manual.sql  (Contenido v4, C3)
--
-- Una publicacion subida A MANO por fuera de la app (una red no conectada, o
-- una que se publico desde el celular) pasa a existir como fila real de
-- social_posts con origin = 'manual'. Sin esto no entraria al calendario, a
-- Social ni a las metricas: un flag cosmetico en la pieza no alcanza.
--
-- Solo AMPLIA la lista permitida. No toca ninguna fila existente.
--
-- Definicion vieja (00083_content_pipeline.sql):
--   CHECK (origin IN ('system', 'external'))
--
-- Reversa (solo funciona si antes se borran o reasignan las filas 'manual'):
--   ALTER TABLE public.social_posts DROP CONSTRAINT IF EXISTS social_posts_origin_check;
--   ALTER TABLE public.social_posts ADD CONSTRAINT social_posts_origin_check
--     CHECK (origin IN ('system', 'external'));
--
-- Idempotente: si el CHECK ya admite 'manual', no hace nada.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'social_posts_origin_check'
      AND pg_get_constraintdef(oid) LIKE '%manual%'
  ) THEN
    ALTER TABLE public.social_posts DROP CONSTRAINT IF EXISTS social_posts_origin_check;
    ALTER TABLE public.social_posts ADD CONSTRAINT social_posts_origin_check
      CHECK (origin IN ('system', 'external', 'manual'));
  END IF;
END $$;

COMMENT ON COLUMN public.social_posts.origin IS
  'system: la publico el sistema. external: la trajo la sincronizacion. manual: la subio una persona por fuera de la app y la marco como publicada (Contenido v4).';
