-- 00093 · Instagram y TikTok se programan del lado de Zernio (grupo D)
--
-- Hasta ahora el sistema guardaba la fecha y, a esa hora, le pedia a Zernio
-- "publica ahora". Eso ata la publicacion a que nuestro cron corra en el
-- momento justo, y de ahi salen casi todos los problemas del grupo A: el job
-- viejo que sobrevive al reprogramar, las filas trabadas, los reintentos
-- propios.
--
-- Zernio sabe programar: se le pasa la fecha y la zona, y publica el. Eso es
-- lo que hace LateWiz, su cliente de referencia.
--
-- Dos cosas hacen falta:
--
-- 1. Un estado nuevo, `uploading`. Para que Zernio publique un video dias
--    despues, el archivo tiene que estar en Zernio, no detras de un link
--    firmado nuestro que vence en 24 horas. La subida corre en un job y la
--    fila espera ahi mientras tanto. No es `publishing`: nadie esta
--    publicando todavia, y el barrido de publicaciones trabadas no tiene que
--    tocarla.
--
-- 2. `provider_media`, que recuerda que archivo nuestro corresponde a que URL
--    de Zernio. Sin esto, programar tres redes con el mismo video lo sube
--    tres veces.
--
-- Aditiva. No borra ni modifica datos.

-- ------------------------------------------------------------
-- 1. El estado `uploading`
-- ------------------------------------------------------------

DO $$
BEGIN
  ALTER TABLE public.social_posts DROP CONSTRAINT IF EXISTS social_posts_status_check;
  ALTER TABLE public.social_posts
    ADD CONSTRAINT social_posts_status_check
    CHECK (
      status IS NULL OR status IN (
        'uploading', 'scheduled', 'publishing', 'published', 'failed', 'cancelled'
      )
    );
END $$;

COMMENT ON COLUMN public.social_posts.status IS
  'uploading = subiendo la media al proveedor; scheduled = agendado (nuestro o de Zernio); publishing = el proveedor la esta publicando.';

-- ------------------------------------------------------------
-- 2. La media que ya vive en el proveedor
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.provider_media (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Que proveedor tiene la copia: 'zernio' hoy, otro manana.
  publisher     text NOT NULL,
  -- La ruta en nuestro bucket content-media.
  storage_path  text NOT NULL,
  -- Cuanto pesaba cuando se subio: si el archivo cambia, hay que volver a
  -- subirlo, y el tamano es la senal mas barata de que cambio.
  size_bytes    bigint,
  -- La direccion publica que devolvio el proveedor.
  provider_url  text NOT NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_media_unique
  ON public.provider_media (workspace_id, publisher, storage_path);

CREATE INDEX IF NOT EXISTS provider_media_workspace_idx
  ON public.provider_media (workspace_id);

COMMENT ON TABLE public.provider_media IS
  'Que archivo de content-media corresponde a que URL del proveedor, para no subirlo dos veces (D5).';

ALTER TABLE public.provider_media ENABLE ROW LEVEL SECURITY;

-- Solo el servidor la escribe (la sube un job con service role). Los
-- miembros del workspace pueden leerla: no hay nada sensible y sirve para
-- diagnosticar por que una publicacion no encuentra su media.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'provider_media'
      AND policyname = 'provider_media_select'
  ) THEN
    CREATE POLICY provider_media_select ON public.provider_media
      FOR SELECT TO authenticated
      USING (public.is_workspace_member(workspace_id));
  END IF;
END $$;
