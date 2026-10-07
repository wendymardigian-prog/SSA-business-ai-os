-- ============================================================
-- 00127_content_versions_session.sql  (Contenido v4, C6)
--
-- Agrupar las versiones de una pieza por SESION de edicion, no una por
-- cambio: con el autoguardado (C6 escribe en cada blur/change), la regla
-- vieja (F22) generaria decenas de versiones en una tarde.
--
-- Dos cosas, las dos aditivas:
--
--   1. `updated_at`: para saber si el ultimo cambio de esa version fue hace
--      menos de 10 minutos (la sesion sigue) o mas (se corto). Nace en
--      `now()` para las filas que ya existen: no hay forma de saber cuando
--      se habian tocado de verdad, y tratarlas como "recien tocadas" es el
--      lado seguro (el peor caso es una sesion que no se agrupa, no una que
--      se agrupa de mas).
--   2. El CHECK de `reason` suma 'edit' (el autoguardado de verdad) y
--      'approve' (aprobar corta la sesion con su propio motivo, separado de
--      'status_change'). Los cinco motivos viejos se conservan: el
--      historial no se reescribe.
--
-- Idempotente: `ADD COLUMN IF NOT EXISTS` y el CHECK se reemplaza solo si
-- todavia no incluye los valores nuevos.
--
-- Reversa:
--   ALTER TABLE public.content_post_versions DROP COLUMN IF EXISTS updated_at;
--   ALTER TABLE public.content_post_versions DROP CONSTRAINT IF EXISTS content_post_versions_reason_check;
--   ALTER TABLE public.content_post_versions ADD CONSTRAINT content_post_versions_reason_check
--     CHECK (reason IN ('status_change','manual_save','resume_after_idle','ai_generation','restore'));
--   -- Solo funciona si antes se borran o se reescriben las filas con
--   -- reason IN ('edit','approve').
-- ============================================================

ALTER TABLE public.content_post_versions
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'content_post_versions_reason_check'
      AND pg_get_constraintdef(oid) LIKE '%''edit''%'
  ) THEN
    ALTER TABLE public.content_post_versions DROP CONSTRAINT IF EXISTS content_post_versions_reason_check;
    ALTER TABLE public.content_post_versions ADD CONSTRAINT content_post_versions_reason_check
      CHECK (reason IN ('status_change', 'manual_save', 'resume_after_idle', 'ai_generation', 'restore', 'edit', 'approve'));
  END IF;
END $$;

COMMENT ON COLUMN public.content_post_versions.updated_at IS
  'Cuando se toco por ultima vez esta fila. Con reason=edit y menos de 10 minutos, el proximo cambio del mismo autor actualiza esta misma version en vez de crear otra (Contenido v4, C6).';
