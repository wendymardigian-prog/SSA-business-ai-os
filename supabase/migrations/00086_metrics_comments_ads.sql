-- ============================================================
-- 00086: metricas, comentarios y anuncios (F41, bloque 5)
-- ============================================================
--
-- Cuatro tablas de SOLO LECTURA para la aplicacion: las escribe el servidor
-- desde los lectores de cada red, y nadie las edita a mano.
--
-- Tres decisiones que se repiten en las cuatro:
--
--  1. **Una fila por dia y objeto, con valores ACUMULADOS a ese dia.** Asi una
--     recoleccion repetida del mismo dia corrige la fila en vez de sumar dos
--     veces. El unico `(objeto, date)` es lo que lo hace posible.
--  2. **Un dia sin dato NO tiene fila.** Si una red falla, no se escribe un
--     cero: el grafico muestra el hueco. Un cero inventado se lee como
--     "ese dia no paso nada", que es una afirmacion distinta y falsa.
--  3. **`extra jsonb`** para lo propio de cada red (alcance por seguidores,
--     audiencia). Sumar una metrica de una sola red no puede costar una
--     migracion ni una columna vacia para las otras cuatro.
--
-- RLS: leen Owner/Admin (en el bloque 9 pasa a `dashboards.content.view` y
-- `dashboards.ads.view`); escribe solo el servidor, como `social_posts`.

-- ------------------------------------------------------------
-- 1. Metricas por publicacion y dia
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.social_post_metrics_daily (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  social_post_id            uuid NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
  -- La fecha en la zona del workspace, no en UTC: "el lunes" tiene que ser
  -- el lunes de quien mira el dashboard.
  date                      date NOT NULL,
  views                     integer,
  impressions               integer,
  reach                     integer,
  likes                     integer,
  comments                  integer,
  shares                    integer,
  saves                     integer,
  watch_time_seconds        integer,
  avg_view_duration_seconds numeric,
  engagement_rate           numeric,
  extra                     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.social_post_metrics_daily IS
  'Metricas de una publicacion, acumuladas a cada dia. Un dia sin dato no tiene fila: el grafico muestra el hueco en vez de un cero inventado.';
COMMENT ON COLUMN public.social_post_metrics_daily.extra IS
  'Lo propio de cada red: reach_followers, reach_non_followers, creatorContentType, etc.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_post_metrics_daily
  ON public.social_post_metrics_daily (social_post_id, date);

CREATE INDEX IF NOT EXISTS idx_post_metrics_workspace_date
  ON public.social_post_metrics_daily (workspace_id, date DESC);

-- ------------------------------------------------------------
-- 2. Metricas por cuenta y dia
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.social_account_metrics_daily (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  social_account_id uuid NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  date              date NOT NULL,
  followers         integer,
  followers_gained  integer,
  followers_lost    integer,
  impressions       integer,
  reach             integer,
  profile_views     integer,
  extra             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.social_account_metrics_daily IS
  'Seguidores y alcance de una cuenta, por dia. Es la base del grafico de crecimiento y del salto de seguidores por post (F52).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_account_metrics_daily
  ON public.social_account_metrics_daily (social_account_id, date);

CREATE INDEX IF NOT EXISTS idx_account_metrics_workspace_date
  ON public.social_account_metrics_daily (workspace_id, date DESC);

-- ------------------------------------------------------------
-- 3. Comentarios
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.social_post_comments (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Nullable: un comentario puede llegar por webhook antes de que la
  -- publicacion exista de nuestro lado. La sincronizacion la completa.
  social_post_id            uuid REFERENCES public.social_posts(id) ON DELETE CASCADE,
  platform                  text NOT NULL,
  external_comment_id       text NOT NULL,
  parent_external_comment_id text,
  author_external_id        text,
  author_username           text,
  author_name               text,
  author_avatar_url         text,
  -- Un comentario nuestro (la respuesta publica del flow, o una a mano).
  -- Se guarda para que el hilo se lea completo, pero nunca dispara nada.
  is_own                    boolean NOT NULL DEFAULT false,
  text                      text,
  commented_at              timestamptz,
  like_count                integer,
  hidden                    boolean NOT NULL DEFAULT false,
  -- Si el autor resulta ser un contacto conocido, queda vinculado.
  contact_id                uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  source                    text NOT NULL DEFAULT 'sync',
  deleted_at                timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.social_post_comments IS
  'Comentarios de las publicaciones. Entran por el webhook en el momento y se vuelven a leer en la sincronizacion. Los propios se guardan y nunca disparan automatizaciones.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_post_comments_source_check') THEN
    ALTER TABLE public.social_post_comments ADD CONSTRAINT social_post_comments_source_check
      CHECK (source IN ('webhook', 'sync'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_post_comments_platform_check') THEN
    ALTER TABLE public.social_post_comments ADD CONSTRAINT social_post_comments_platform_check
      CHECK (platform IN ('instagram', 'tiktok', 'youtube', 'linkedin', 'threads'));
  END IF;
END $$;

-- El mismo comentario no se guarda dos veces, venga del webhook o de la
-- relectura. Es lo que hace que los dos caminos puedan convivir.
CREATE UNIQUE INDEX IF NOT EXISTS uq_post_comments_external
  ON public.social_post_comments (workspace_id, platform, external_comment_id);

CREATE INDEX IF NOT EXISTS idx_post_comments_post
  ON public.social_post_comments (social_post_id, commented_at DESC)
  WHERE deleted_at IS NULL;

-- Para completar los que llegaron antes que su publicacion.
CREATE INDEX IF NOT EXISTS idx_post_comments_orphans
  ON public.social_post_comments (workspace_id, platform)
  WHERE social_post_id IS NULL;

-- ------------------------------------------------------------
-- 4. Insights de Meta Ads
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.meta_ads_insights_daily (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ad_account_id           text NOT NULL,
  -- Los cuatro niveles conviven en la misma tabla: son las mismas metricas
  -- con distinto grado de detalle, y separarlas en cuatro tablas obligaria a
  -- escribir cuatro veces la misma consulta.
  level                   text NOT NULL,
  object_id               text NOT NULL,
  object_name             text,
  parent_name             text,
  campaign_id             text,
  adset_id                text,
  date                    date NOT NULL,
  spend                   numeric,
  impressions             integer,
  reach                   integer,
  clicks                  integer,
  outbound_clicks         integer,
  link_clicks             integer,
  ctr                     numeric,
  cpc                     numeric,
  cpm                     numeric,
  leads                   integer,
  purchases               integer,
  purchase_value          numeric,
  video_p25               integer,
  video_p50               integer,
  video_p75               integer,
  video_p95               integer,
  video_p100              integer,
  thruplays               integer,
  video_avg_time_seconds  numeric,
  quality_ranking         text,
  engagement_ranking      text,
  conversion_ranking      text,
  status                  text,
  effective_status        text,
  -- Las acciones crudas de Meta: sus nombres cambian por objetivo de campaña
  -- y por plataforma, asi que se guardan enteras y se interpretan al leer.
  actions                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.meta_ads_insights_daily IS
  'Insights de Meta Ads por dia y objeto. Los cuatro niveles (cuenta, campaña, conjunto, anuncio) en una tabla: son las mismas metricas con distinto detalle.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_ads_insights_level_check') THEN
    ALTER TABLE public.meta_ads_insights_daily ADD CONSTRAINT meta_ads_insights_level_check
      CHECK (level IN ('account', 'campaign', 'adset', 'ad'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_ads_insights
  ON public.meta_ads_insights_daily (workspace_id, level, object_id, date);

CREATE INDEX IF NOT EXISTS idx_meta_ads_insights_account_date
  ON public.meta_ads_insights_daily (workspace_id, ad_account_id, level, date DESC);

-- ------------------------------------------------------------
-- 5. updated_at
-- ------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'social_post_metrics_daily',
    'social_account_metrics_daily',
    'social_post_comments',
    'meta_ads_insights_daily'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_' || t
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER set_updated_at_%1$s BEFORE UPDATE ON public.%1$I
           FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()',
        t
      );
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 6. RLS
-- ------------------------------------------------------------
--
-- Lectura para Owner/Admin, escritura de nadie: las escribe el service role,
-- que no pasa por RLS. Un Member no ve metricas hasta el bloque 9, donde el
-- permiso `dashboards.content.view` puede darselas.

ALTER TABLE public.social_post_metrics_daily     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_account_metrics_daily  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_post_comments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ads_insights_daily       ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'social_post_metrics_daily',
    'social_account_metrics_daily',
    'social_post_comments',
    'meta_ads_insights_daily'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_select_admin" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "%1$s_select_admin" ON public.%1$I
         FOR SELECT TO authenticated
         USING (public.is_workspace_admin(workspace_id))',
      t
    );
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 7. Cron de metricas (F47)
-- ------------------------------------------------------------
--
-- Corre cada hora y la ruta decide para que workspaces encolar: los que en
-- ese momento son las 3:30 de la mañana en SU zona horaria. Un cron por
-- workspace seria lo mismo con mas piezas que mantener.

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
    'social-token-refresh', 'content-media-cleanup', 'metrics-sync'
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

REVOKE ALL ON FUNCTION private.call_app_cron(text) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'metrics-sync') THEN
    PERFORM cron.unschedule('metrics-sync');
  END IF;
  -- Al minuto 30 de cada hora: la ruta se queda con los workspaces cuya hora
  -- local es 03:30. Las zonas con medias horas (India, Nepal) entran igual
  -- porque la ruta compara la hora local, no el offset.
  PERFORM cron.schedule(
    'metrics-sync',
    '30 * * * *',
    $cron$SELECT private.call_app_cron('metrics-sync')$cron$
  );
END $$;
