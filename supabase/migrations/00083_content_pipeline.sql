-- ============================================================================
-- 00083 — Pipeline de contenido (Etapa 2, Bloque 3)
-- ============================================================================
-- Cuatro tablas, un bucket y un cron.
--
--  1. content_ideas: la idea antes de ser post. Tiene su propio estado
--     (nueva / aprobada / descartada) porque aprobarla es una decision, y una
--     idea puede originar varios posts.
--
--  2. content_posts: la PIEZA. Un copy (el guion para grabar), un caption
--     base, la media, y `networks jsonb` con lo propio de cada red: su fecha
--     tentativa, su caption, su CTA y sus opciones. El estado del post se
--     deriva de sus publicaciones a partir de "programado" (§9.4).
--
--  3. content_post_versions: el historial. Nada se pisa sin dejar version.
--
--  4. social_posts: UNA FILA POR RED Y POST, creada al PROGRAMAR esa red.
--     Es la frontera entre "planeado" y "en la cola": mientras la fecha vive
--     en el jsonb es tentativa y no hay nada agendado. Tambien entran aca las
--     publicaciones hechas a mano fuera del sistema (`origin = 'external'`),
--     que aparecen en metricas y en la pagina Social pero no en el kanban.
--     Las columnas de engagement a 7 dias se crean desde ahora para no volver
--     a tocar la tabla en el bloque 5.
--
--  5. Bucket `content-media` CON policies por workspace. Es el primer bucket
--     del proyecto que las tiene, y hace falta: la subida va directo del
--     navegador a Storage con el JWT de la persona (un video de 1 GB no puede
--     pasar por una Server Action), asi que la base tiene que decidir quien
--     escribe donde. La regla es el primer segmento del path: <workspace_id>/…
--
--  6. Cron diario de limpieza de media publicada.
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Ideas
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.content_ideas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title             text NOT NULL,
  hook              text,
  angle             text,
  format            text,
  pillar            text,
  reference         text,
  notes             text,
  status            text NOT NULL DEFAULT 'nueva',
  source            text NOT NULL DEFAULT 'manual',
  position          integer NOT NULL DEFAULT 0,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at       timestamptz,
  discarded_reason  text,
  -- Reservados para la etapa 3 (agentes): se crean vacios para no migrar
  -- despues una tabla con datos.
  score             numeric,
  target_audience   text,
  awareness_level   text,
  embedding         vector(1024),
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.content_ideas IS
  'Ideas de contenido. Aprobar una crea un post; una idea puede originar varios.';
COMMENT ON COLUMN public.content_ideas.source IS
  'manual: la escribio una persona. agent: la propuso un agente (etapa 3).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_ideas_status_check') THEN
    ALTER TABLE public.content_ideas ADD CONSTRAINT content_ideas_status_check
      CHECK (status IN ('nueva', 'aprobada', 'descartada'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_ideas_source_check') THEN
    ALTER TABLE public.content_ideas ADD CONSTRAINT content_ideas_source_check
      CHECK (source IN ('manual', 'agent'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_content_ideas_board
  ON public.content_ideas (workspace_id, status, position)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------
-- 2. Posts
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.content_posts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  idea_id          uuid REFERENCES public.content_ideas(id) ON DELETE SET NULL,
  title            text NOT NULL,
  format           text,
  copy             jsonb NOT NULL DEFAULT '{}'::jsonb,
  caption          text,
  networks         jsonb NOT NULL DEFAULT '[]'::jsonb,
  media            jsonb NOT NULL DEFAULT '[]'::jsonb,
  material_status  text NOT NULL DEFAULT 'pendiente',
  copy_source      text NOT NULL DEFAULT 'manual',
  ai_unreviewed    boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'draft',
  current_version  integer NOT NULL DEFAULT 0,
  position         integer NOT NULL DEFAULT 0,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at      timestamptz,
  review_note      text,
  source           text NOT NULL DEFAULT 'manual',
  archived_at      timestamptz,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.content_posts IS
  'Una pieza de contenido: un copy, un caption y las redes donde va. El estado desde "scheduled" se deriva de sus filas en social_posts.';
COMMENT ON COLUMN public.content_posts.copy IS
  'El guion para grabar: { hook, body, cta, recording_notes }.';
COMMENT ON COLUMN public.content_posts.networks IS
  'Lo propio de cada red: [{ platform, planned_at, caption, media, cta, options, publisher, youtube_title }]. planned_at es TENTATIVA: mientras viva solo aca, no hay nada en la cola.';
COMMENT ON COLUMN public.content_posts.media IS
  'La media base: [{ storage_path, mime_type, kind, size_bytes, ... , deleted_at }].';
COMMENT ON COLUMN public.content_posts.material_status IS
  'Como viene la grabacion: pendiente, grabado, editado, listo. Marcar "grabado" mueve el post a En produccion.';
COMMENT ON COLUMN public.content_posts.copy_source IS
  'Quien escribio el copy: manual, ai, o mixed (la IA lo escribio y una persona lo edito).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_posts_status_check') THEN
    ALTER TABLE public.content_posts ADD CONSTRAINT content_posts_status_check
      CHECK (status IN (
        'draft', 'in_production', 'in_review', 'approved',
        'scheduled', 'publishing', 'published', 'partially_published', 'failed'
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_posts_material_check') THEN
    ALTER TABLE public.content_posts ADD CONSTRAINT content_posts_material_check
      CHECK (material_status IN ('pendiente', 'grabado', 'editado', 'listo'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_posts_copy_source_check') THEN
    ALTER TABLE public.content_posts ADD CONSTRAINT content_posts_copy_source_check
      CHECK (copy_source IN ('manual', 'ai', 'mixed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_posts_source_check') THEN
    ALTER TABLE public.content_posts ADD CONSTRAINT content_posts_source_check
      CHECK (source IN ('manual', 'agent'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_posts_networks_array') THEN
    ALTER TABLE public.content_posts ADD CONSTRAINT content_posts_networks_array
      CHECK (jsonb_typeof(networks) = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_posts_media_array') THEN
    ALTER TABLE public.content_posts ADD CONSTRAINT content_posts_media_array
      CHECK (jsonb_typeof(media) = 'array');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_content_posts_board
  ON public.content_posts (workspace_id, status, position)
  WHERE deleted_at IS NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_content_posts_idea
  ON public.content_posts (idea_id)
  WHERE idea_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3. Versiones
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.content_post_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  post_id      uuid NOT NULL REFERENCES public.content_posts(id) ON DELETE CASCADE,
  version_no   integer NOT NULL,
  snapshot     jsonb NOT NULL,
  author_kind  text NOT NULL DEFAULT 'human',
  author_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.content_post_versions IS
  'Historial del post. Restaurar crea una version nueva: nunca se borra una.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_post_versions_author_check') THEN
    ALTER TABLE public.content_post_versions ADD CONSTRAINT content_post_versions_author_check
      CHECK (author_kind IN ('human', 'ai', 'system'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_post_versions_reason_check') THEN
    ALTER TABLE public.content_post_versions ADD CONSTRAINT content_post_versions_reason_check
      CHECK (reason IN ('status_change', 'manual_save', 'resume_after_idle', 'ai_generation', 'restore'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_post_versions_no
  ON public.content_post_versions (post_id, version_no);

-- ------------------------------------------------------------
-- 4. Publicaciones por red
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.social_posts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  content_post_id      uuid REFERENCES public.content_posts(id) ON DELETE CASCADE,
  social_account_id    uuid REFERENCES public.social_accounts(id) ON DELETE SET NULL,
  platform             text NOT NULL,
  publisher            text,
  publisher_ref        text,
  origin               text NOT NULL DEFAULT 'system',
  status               text,
  scheduled_at         timestamptz,
  attempts             integer NOT NULL DEFAULT 0,
  last_error           text,
  last_error_kind      text,
  requested_visibility text,
  actual_visibility    text,
  warning              text,
  external_post_id     text,
  url                  text,
  published_at         timestamptz,
  caption              text,
  media_type           text,
  thumbnail_url        text,
  last_synced_at       timestamptz,
  sync_error           text,
  -- Engagement comparable a 7 dias (F45). Se crean ahora para no volver a
  -- tocar la tabla en el bloque 5.
  engagement_d7        numeric,
  interactions_d7      integer,
  reach_d7             integer,
  views_d7             integer,
  d7_computed_at       timestamptz,
  deleted_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.social_posts IS
  'Una fila por red y post, creada al PROGRAMAR esa red. Tambien entran las publicaciones hechas a mano (origin = external), que aparecen en metricas y en Social pero no en el kanban. Solo la escribe el servidor.';
COMMENT ON COLUMN public.social_posts.status IS
  'scheduled, publishing, published, failed, cancelled. NULL en las externas: nunca pasaron por nuestra cola.';
COMMENT ON COLUMN public.social_posts.last_error_kind IS
  'temporary: reintentar tiene sentido. permanent: no va a mejorar solo.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_posts_platform_check') THEN
    ALTER TABLE public.social_posts ADD CONSTRAINT social_posts_platform_check
      CHECK (platform IN ('instagram', 'tiktok', 'youtube', 'linkedin', 'threads'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_posts_origin_check') THEN
    ALTER TABLE public.social_posts ADD CONSTRAINT social_posts_origin_check
      CHECK (origin IN ('system', 'external'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_posts_status_check') THEN
    ALTER TABLE public.social_posts ADD CONSTRAINT social_posts_status_check
      CHECK (status IS NULL OR status IN ('scheduled', 'publishing', 'published', 'failed', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_posts_error_kind_check') THEN
    ALTER TABLE public.social_posts ADD CONSTRAINT social_posts_error_kind_check
      CHECK (last_error_kind IS NULL OR last_error_kind IN ('temporary', 'permanent'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_posts_media_type_check') THEN
    ALTER TABLE public.social_posts ADD CONSTRAINT social_posts_media_type_check
      CHECK (media_type IS NULL OR media_type IN ('image', 'carousel', 'reel', 'story', 'video', 'short', 'text', 'document'));
  END IF;
END $$;

-- Una pieza no puede tener dos publicaciones en la misma red. Parcial: las
-- externas no tienen content_post_id, y varias con NULL no deben chocar.
CREATE UNIQUE INDEX IF NOT EXISTS uq_social_posts_content_platform
  ON public.social_posts (content_post_id, platform)
  WHERE content_post_id IS NOT NULL AND deleted_at IS NULL;

-- El mismo post de la red no se guarda dos veces (lo escribe la recoleccion
-- de metricas y tambien el webhook).
CREATE UNIQUE INDEX IF NOT EXISTS uq_social_posts_account_external
  ON public.social_posts (social_account_id, external_post_id)
  WHERE external_post_id IS NOT NULL;

-- Para contar cuotas por publicador y mes.
CREATE INDEX IF NOT EXISTS idx_social_posts_publisher
  ON public.social_posts (workspace_id, publisher, published_at);

CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled
  ON public.social_posts (workspace_id, status, scheduled_at)
  WHERE status IN ('scheduled', 'publishing');

-- ------------------------------------------------------------
-- 5. Retencion de media y triggers de updated_at
-- ------------------------------------------------------------

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS content_media_retention_days integer NOT NULL DEFAULT 30;

COMMENT ON COLUMN public.workspaces.content_media_retention_days IS
  'Dias que se conserva la media despues de publicada. 0 = no se borra nunca.';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['content_ideas', 'content_posts', 'social_posts'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()',
      t
    );
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 6. RLS
-- ------------------------------------------------------------
-- El contenido NO tiene scope de leads: una pieza es del negocio, no de un
-- contacto. Todos los miembros la ven. Lo que cambia por rol es quien puede
-- APROBAR y PROGRAMAR, que es donde se decide que sale publicado.
--
-- Un Member crea y edita LO SUYO mientras esta en borrador, en produccion o
-- en revision. Desde aprobado en adelante es de Owner/Admin: si pudiera
-- editar un post aprobado, la aprobacion no querria decir nada.

ALTER TABLE public.content_ideas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "content_ideas_select" ON public.content_ideas;
CREATE POLICY "content_ideas_select" ON public.content_ideas
  FOR SELECT USING (public.is_workspace_member(workspace_id) AND deleted_at IS NULL);

DROP POLICY IF EXISTS "content_ideas_insert" ON public.content_ideas;
CREATE POLICY "content_ideas_insert" ON public.content_ideas
  FOR INSERT WITH CHECK (
    public.is_workspace_member(workspace_id)
    -- Una idea nace 'nueva'. Nadie crea una ya aprobada saltandose el paso.
    AND status = 'nueva'
    AND (public.is_workspace_admin(workspace_id) OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS "content_ideas_update" ON public.content_ideas;
CREATE POLICY "content_ideas_update" ON public.content_ideas
  FOR UPDATE USING (
    public.is_workspace_admin(workspace_id)
    OR (public.is_workspace_member(workspace_id) AND created_by = auth.uid() AND status = 'nueva')
  )
  WITH CHECK (
    -- Aprobar o descartar es de Owner/Admin: es la decision, no la edicion.
    public.is_workspace_admin(workspace_id)
    OR (created_by = auth.uid() AND status = 'nueva')
  );

DROP POLICY IF EXISTS "content_ideas_delete" ON public.content_ideas;
CREATE POLICY "content_ideas_delete" ON public.content_ideas
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

ALTER TABLE public.content_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "content_posts_select" ON public.content_posts;
CREATE POLICY "content_posts_select" ON public.content_posts
  FOR SELECT USING (public.is_workspace_member(workspace_id) AND deleted_at IS NULL);

DROP POLICY IF EXISTS "content_posts_insert" ON public.content_posts;
CREATE POLICY "content_posts_insert" ON public.content_posts
  FOR INSERT WITH CHECK (
    public.is_workspace_member(workspace_id)
    AND (
      public.is_workspace_admin(workspace_id)
      OR (created_by = auth.uid() AND status IN ('draft', 'in_production', 'in_review'))
    )
  );

DROP POLICY IF EXISTS "content_posts_update" ON public.content_posts;
CREATE POLICY "content_posts_update" ON public.content_posts
  FOR UPDATE USING (
    public.is_workspace_admin(workspace_id)
    OR (
      public.is_workspace_member(workspace_id)
      AND created_by = auth.uid()
      AND status IN ('draft', 'in_production', 'in_review')
    )
  )
  WITH CHECK (
    public.is_workspace_admin(workspace_id)
    OR (
      created_by = auth.uid()
      -- El Member puede mover su post entre esos tres estados, y nada mas.
      -- Pasar a 'approved' o 'scheduled' por la API directa se rechaza aca,
      -- no solo en la pantalla.
      AND status IN ('draft', 'in_production', 'in_review')
    )
  );

DROP POLICY IF EXISTS "content_posts_delete" ON public.content_posts;
CREATE POLICY "content_posts_delete" ON public.content_posts
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

ALTER TABLE public.content_post_versions ENABLE ROW LEVEL SECURITY;

-- Las versiones se leen pero no se escriben desde el navegador: las crea el
-- servidor cuando corresponde, y el recorte a 50 tambien.
DROP POLICY IF EXISTS "content_post_versions_select" ON public.content_post_versions;
CREATE POLICY "content_post_versions_select" ON public.content_post_versions
  FOR SELECT USING (public.is_workspace_member(workspace_id));

-- social_posts: RLS activa y SELECT para miembros. Escribir es solo del
-- servidor (deny-all sin policy), porque una fila aca es una publicacion
-- agendada de verdad.
ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "social_posts_select" ON public.social_posts;
CREATE POLICY "social_posts_select" ON public.social_posts
  FOR SELECT USING (public.is_workspace_member(workspace_id) AND deleted_at IS NULL);

-- ------------------------------------------------------------
-- 7. Bucket de media, con policies por workspace
-- ------------------------------------------------------------
-- A diferencia de `knowledge`, este bucket SI tiene policies. La razon es
-- concreta: la media se sube directo del navegador a Storage (un video de
-- 1 GB no puede pasar por una Server Action, y con TUS va en partes), asi que
-- quien autoriza la escritura es la base y no nuestro codigo.
--
-- La regla es el PRIMER SEGMENTO del path: <workspace_id>/<post_id>/<archivo>.
-- storage.foldername(name) devuelve los segmentos; el primero tiene que ser un
-- workspace del que la persona sea miembro.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'content-media',
  'content-media',
  false,
  1073741824,  -- 1 GB
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/quicktime',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Si ya existia, se fuerzan las tres cosas que no son negociables.
UPDATE storage.buckets
SET
  public = false,
  file_size_limit = 1073741824,
  allowed_mime_types = ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/quicktime',
    'application/pdf'
  ]
WHERE id = 'content-media';

DROP POLICY IF EXISTS "content_media_select" ON storage.objects;
CREATE POLICY "content_media_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'content-media'
    AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "content_media_insert" ON storage.objects;
CREATE POLICY "content_media_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'content-media'
    AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "content_media_update" ON storage.objects;
CREATE POLICY "content_media_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'content-media'
    AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );

-- Borrar es de Owner/Admin: sacar la media de un post publicado rompe lo que
-- se ve en la red.
DROP POLICY IF EXISTS "content_media_delete" ON storage.objects;
CREATE POLICY "content_media_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'content-media'
    AND public.is_workspace_admin(((storage.foldername(name))[1])::uuid)
  );

-- ------------------------------------------------------------
-- 8. Cron diario de limpieza de media
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.call_app_cron(p_path text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_base text; v_secret text;
BEGIN
  IF p_path NOT IN (
    'jobs', 'sequences', 'whatsapp-health', 'inactivity', 'automation-events',
    'agent-bursts', 'drafts-refresh', 'bg-dispatch', 'bg-collect',
    'social-token-refresh', 'content-media-cleanup'
  ) THEN
    RAISE EXCEPTION 'ruta de cron no permitida: %', p_path;
  END IF;
  SELECT value INTO v_base FROM private.system_config WHERE key = 'app_url';
  SELECT value INTO v_secret FROM private.system_config WHERE key = 'cron_secret';
  IF v_base IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'private.system_config sin app_url o cron_secret: el cron "%" no se ejecuto', p_path;
    RETURN NULL;
  END IF;
  RETURN net.http_get(
    url => rtrim(v_base, '/') || '/api/cron/' || p_path,
    headers => jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    timeout_milliseconds => 60000
  );
END; $function$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ssa-cron-content-media-cleanup') THEN
    PERFORM cron.unschedule('ssa-cron-content-media-cleanup');
  END IF;
  PERFORM cron.schedule(
    'ssa-cron-content-media-cleanup',
    '50 5 * * *',
    $cron$SELECT private.call_app_cron('content-media-cleanup')$cron$
  );
END $$;
