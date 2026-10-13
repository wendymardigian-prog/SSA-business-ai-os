-- ============================================================================
-- 00191 — Catalogo de Meta: campañas, conjuntos y anuncios  (M6 del Extra L, AT2)
-- ============================================================================
-- Hasta ahora el sistema solo guardaba METRICAS por dia (`meta_ads_insights_daily`): el
-- nombre de un anuncio vivia repetido en cada fila y el estado (`status`, `effective_status`)
-- quedaba siempre vacio. Esta migracion suma el CATALOGO: una fila por campaña, conjunto y
-- anuncio, con su estado, su creativo y su miniatura. Es lo que permite, en AT3, vincular cada
-- toque del CRM con el anuncio que lo trajo.
--
-- - `meta_name_key(text)`: el nombre normalizado (minusculas, sin tildes, espacios colapsados).
--   Es la clave del vinculo por nombre (AT3). Sin `unaccent` (no esta instalada): `translate`,
--   igual que `normalize_for_grouping` (00076).
-- - Las tres tablas las escribe SOLO el servidor (el sync, con el service role). La app las lee
--   con la RLS: Owner/Admin y los roles con `dashboards.ads.view` (`has_permission`). OJO:
--   `has_permission` devuelve false para el rol de sistema "Member"; no tiene ese permiso, asi
--   que no ve el catalogo, que es lo correcto.
-- - Bucket `ad-creatives` (privado): las miniaturas de los anuncios, que la URL de Meta vence.
--   Path `{workspace_id}/{ad_id}.{ext}`. Lee quien tenga `dashboards.ads.view` en el workspace
--   del primer segmento; escribe y borra solo el servidor.
-- - Politica ADICIONAL de lectura en `meta_ads_insights_daily`: hoy solo la ve Owner/Admin
--   (`is_workspace_admin`). La tabla Meta vs CRM (AT4) tiene que servirle a un rol con
--   `dashboards.ads.view`. Las politicas de SELECT se SUMAN: la de Owner/Admin no se toca.
--
-- Como volver atras (nada del codigo viejo usa estas tablas):
--   DROP POLICY IF EXISTS meta_ads_insights_daily_select_perm ON public.meta_ads_insights_daily;
--   DROP POLICY IF EXISTS ad_creatives_select ON storage.objects;
--   -- el bucket solo si esta vacio:
--   --   select count(*) from storage.objects where bucket_id = 'ad-creatives';  -- 0
--   --   DELETE FROM storage.buckets WHERE id = 'ad-creatives';
--   DROP TABLE IF EXISTS public.meta_ads, public.meta_adsets, public.meta_campaigns;
--   DROP FUNCTION IF EXISTS public.meta_name_key(text);
-- Riesgo: bajo (aditiva).
-- ============================================================================

SET search_path = '';

-- ------------------------------------------------------------
-- meta_name_key
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.meta_name_key(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT btrim(
    regexp_replace(
      translate(
        lower(coalesce(p_raw, '')),
        'áàäâãåéèëêíìïîóòöôõúùüûñç',
        'aaaaaaeeeeiiiiooooouuuunc'
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

REVOKE ALL ON FUNCTION public.meta_name_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meta_name_key(text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- meta_campaigns
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meta_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ad_account_id text NOT NULL,
  -- El id de Meta.
  campaign_id text NOT NULL,
  name text,
  name_key text,
  status text,
  effective_status text,
  objective text,
  buying_type text,
  -- Centavos de la moneda de la cuenta (como los manda Meta).
  daily_budget bigint,
  lifetime_budget bigint,
  start_time timestamptz,
  stop_time timestamptz,
  created_time timestamptz,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.meta_campaigns IS
  'Catalogo de campañas de Meta (Extra L). Las escribe el sync con el service role.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_campaigns
  ON public.meta_campaigns (workspace_id, ad_account_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_meta_campaigns_name_key
  ON public.meta_campaigns (workspace_id, name_key);

-- ------------------------------------------------------------
-- meta_adsets
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meta_adsets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ad_account_id text NOT NULL,
  campaign_id text,
  -- El id de Meta.
  adset_id text NOT NULL,
  name text,
  name_key text,
  status text,
  effective_status text,
  optimization_goal text,
  billing_event text,
  daily_budget bigint,
  lifetime_budget bigint,
  start_time timestamptz,
  stop_time timestamptz,
  created_time timestamptz,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.meta_adsets IS
  'Catalogo de conjuntos de anuncios de Meta (Extra L). Los escribe el sync con el service role.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_adsets
  ON public.meta_adsets (workspace_id, ad_account_id, adset_id);
CREATE INDEX IF NOT EXISTS idx_meta_adsets_campaign
  ON public.meta_adsets (workspace_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_meta_adsets_name_key
  ON public.meta_adsets (workspace_id, name_key);

-- ------------------------------------------------------------
-- meta_ads
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meta_ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ad_account_id text NOT NULL,
  campaign_id text,
  adset_id text,
  -- El id de Meta.
  ad_id text NOT NULL,
  name text,
  name_key text,
  status text,
  effective_status text,
  created_time timestamptz,
  creative_id text,
  -- { title, body, cta, link_url, object_type }
  creative jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- De donde se baja la miniatura y donde quedo guardada en `ad-creatives`.
  thumbnail_source_url text,
  thumbnail_path text,
  thumbnail_attempts integer NOT NULL DEFAULT 0 CHECK (thumbnail_attempts >= 0),
  -- La publicacion organica que promociona el anuncio (para enlazarla con Contenido).
  instagram_media_id text,
  object_story_id text,
  social_post_id uuid REFERENCES public.social_posts(id) ON DELETE SET NULL,
  content_post_id uuid REFERENCES public.content_posts(id) ON DELETE SET NULL,
  -- true = una persona eligio la pieza: el vinculo automatico no la pisa.
  content_link_manual boolean NOT NULL DEFAULT false,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.meta_ads IS
  'Catalogo de anuncios de Meta (Extra L). Los escribe el sync con el service role.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_ads
  ON public.meta_ads (workspace_id, ad_account_id, ad_id);
CREATE INDEX IF NOT EXISTS idx_meta_ads_adset
  ON public.meta_ads (workspace_id, adset_id);
CREATE INDEX IF NOT EXISTS idx_meta_ads_campaign
  ON public.meta_ads (workspace_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_meta_ads_name_key
  ON public.meta_ads (workspace_id, name_key);
-- La cola de miniaturas busca los anuncios sin miniatura y con intentos disponibles.
CREATE INDEX IF NOT EXISTS idx_meta_ads_thumbnail_pending
  ON public.meta_ads (workspace_id, thumbnail_attempts)
  WHERE thumbnail_path IS NULL;
-- El enlace con Contenido busca por el id de la publicacion de Instagram / Facebook.
CREATE INDEX IF NOT EXISTS idx_meta_ads_instagram_media
  ON public.meta_ads (workspace_id, instagram_media_id)
  WHERE instagram_media_id IS NOT NULL;

-- ------------------------------------------------------------
-- updated_at
-- ------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['meta_campaigns', 'meta_adsets', 'meta_ads'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_' || t) THEN
      EXECUTE format(
        'CREATE TRIGGER set_updated_at_%1$s BEFORE UPDATE ON public.%1$I
           FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()',
        t
      );
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- RLS: lectura con el permiso; escritura de nadie (la hace el service role)
-- ------------------------------------------------------------
ALTER TABLE public.meta_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_adsets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ads ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['meta_campaigns', 'meta_adsets', 'meta_ads'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
         USING (public.is_workspace_member(workspace_id) AND public.has_permission(workspace_id, ''dashboards.ads.view''))',
      t || '_select', t
    );
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- meta_ads_insights_daily: lectura ADICIONAL para quien tiene el permiso
-- ------------------------------------------------------------
-- La politica de Owner/Admin (`meta_ads_insights_daily_select_admin`) no se toca.
DROP POLICY IF EXISTS meta_ads_insights_daily_select_perm ON public.meta_ads_insights_daily;
CREATE POLICY meta_ads_insights_daily_select_perm ON public.meta_ads_insights_daily
  FOR SELECT TO authenticated
  USING (
    public.is_workspace_member(workspace_id)
    AND public.has_permission(workspace_id, 'dashboards.ads.view')
  );

-- ------------------------------------------------------------
-- Bucket de miniaturas
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ad-creatives',
  'ad-creatives',
  false,
  2097152,  -- 2 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Leer: quien puede ver los anuncios en el workspace del primer segmento del path. NO es
-- `bucket_id = 'ad-creatives'` a secas: eso dejaria a cualquier usuario ver los creativos de otro negocio.
DROP POLICY IF EXISTS "ad_creatives_select" ON storage.objects;
CREATE POLICY "ad_creatives_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'ad-creatives'
    AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)
    AND public.has_permission(((storage.foldername(name))[1])::uuid, 'dashboards.ads.view')
  );

-- Escribir y borrar son del servidor (el job de miniaturas, con el service role).
DROP POLICY IF EXISTS "ad_creatives_insert" ON storage.objects;
DROP POLICY IF EXISTS "ad_creatives_update" ON storage.objects;
DROP POLICY IF EXISTS "ad_creatives_delete" ON storage.objects;
