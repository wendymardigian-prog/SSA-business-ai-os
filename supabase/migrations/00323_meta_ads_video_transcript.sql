-- ============================================================
-- 00323_meta_ads_video_transcript
-- ============================================================
-- El video y la transcripcion de cada anuncio (noviembre 2026).
--
-- Hasta ahora el catalogo guardaba titulo, texto, CTA y una miniatura, pero no el id
-- del video: sin el no hay forma de pedirle a Meta el archivo. Y no habia donde
-- guardar lo que se dice en el video.
--
-- Esta migracion suma a `meta_ads`:
--   - `video_id`: el id del video del creativo en Meta. Lo escribe el sync.
--   - `transcript`: lo que se dice en el video. Por ahora se carga A MANO desde el
--     detalle del anuncio; la transcripcion automatica queda para mas adelante y
--     va a usar estas mismas columnas.
--   - `transcript_status`: none | pending | ready | failed (mismo patron que
--     `messages` y `response_assets`). `pending` y `failed` quedan reservados para
--     la transcripcion automatica.
--   - `transcript_source`: auto | manual. Una correccion a mano nunca la pisa la
--     automatica.
--   - `transcript_updated_at` / `transcript_updated_by`: cuando y quien la cargo.
--
-- El sync NO manda ninguna columna de transcripcion en su upsert: un sync no puede
-- borrar lo que una persona escribio.
--
-- Aditiva. Puede ir antes o despues de desplegar el codigo, pero conviene ANTES:
-- el sync nuevo escribe `video_id` y el detalle del anuncio lee las columnas.
-- `meta_ads` ya tiene SELECT para `authenticated` y todo para `service_role` a
-- nivel de tabla: las columnas nuevas lo heredan. Sin politicas nuevas: la app
-- sigue sin escribir `meta_ads` (lo hace el servidor con el cliente de servicio).
--
-- Como volver atras:
--   DROP INDEX IF EXISTS public.idx_meta_ads_video;
--   ALTER TABLE public.meta_ads
--     DROP CONSTRAINT IF EXISTS meta_ads_transcript_shape,
--     DROP CONSTRAINT IF EXISTS meta_ads_transcript_source_check,
--     DROP CONSTRAINT IF EXISTS meta_ads_transcript_status_check,
--     DROP COLUMN IF EXISTS transcript_updated_by,
--     DROP COLUMN IF EXISTS transcript_updated_at,
--     DROP COLUMN IF EXISTS transcript_source,
--     DROP COLUMN IF EXISTS transcript_status,
--     DROP COLUMN IF EXISTS transcript,
--     DROP COLUMN IF EXISTS video_id;
-- ============================================================

ALTER TABLE public.meta_ads
  ADD COLUMN IF NOT EXISTS video_id text,
  ADD COLUMN IF NOT EXISTS transcript text,
  ADD COLUMN IF NOT EXISTS transcript_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS transcript_source text,
  ADD COLUMN IF NOT EXISTS transcript_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS transcript_updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_ads_transcript_status_check') THEN
    ALTER TABLE public.meta_ads
      ADD CONSTRAINT meta_ads_transcript_status_check
      CHECK (transcript_status IN ('none', 'pending', 'ready', 'failed'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_ads_transcript_source_check') THEN
    ALTER TABLE public.meta_ads
      ADD CONSTRAINT meta_ads_transcript_source_check
      CHECK (transcript_source IS NULL OR transcript_source IN ('auto', 'manual'));
  END IF;

  -- Lista = hay texto y se sabe de donde vino; ninguna = no hay texto. Asi una fila
  -- nunca dice "lista" sin transcripcion, ni guarda un texto con estado "ninguna".
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_ads_transcript_shape') THEN
    ALTER TABLE public.meta_ads
      ADD CONSTRAINT meta_ads_transcript_shape
      CHECK (
        (transcript_status = 'ready' AND transcript IS NOT NULL AND btrim(transcript) <> '' AND transcript_source IS NOT NULL)
        OR (transcript_status = 'none' AND transcript IS NULL)
        OR transcript_status IN ('pending', 'failed')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.meta_ads.video_id IS
  'El id del video del creativo en Meta (creative.video_id, object_story_spec.video_data o asset_feed_spec). Lo escribe el sync.';
COMMENT ON COLUMN public.meta_ads.transcript IS
  'Lo que se dice en el video. Hoy se carga a mano desde el detalle del anuncio.';
COMMENT ON COLUMN public.meta_ads.transcript_status IS
  'none | pending | ready | failed. pending y failed quedan para la transcripcion automatica.';
COMMENT ON COLUMN public.meta_ads.transcript_source IS
  'auto | manual. La automatica nunca pisa una manual.';

-- Un mismo video suele correr en varios anuncios: se busca por video para no
-- transcribirlo dos veces el dia que sea automatico.
CREATE INDEX IF NOT EXISTS idx_meta_ads_video
  ON public.meta_ads (workspace_id, video_id)
  WHERE video_id IS NOT NULL;
