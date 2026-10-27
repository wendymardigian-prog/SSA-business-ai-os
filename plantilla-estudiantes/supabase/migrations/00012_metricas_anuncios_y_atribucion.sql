-- ============================================================================
-- Metricas, anuncios y atribucion
--
-- Las metricas diarias de cada publicacion y de cada cuenta, el catalogo de Meta
-- (campanas, conjuntos y anuncios) con sus metricas diarias, y la atribucion: cada
-- interaccion de un contacto (toque) con su canal (organico, pauta, referido, directo),
-- su vinculo con el anuncio de Meta y con la pieza de contenido.
--
-- Un metric que la red no dio queda en null: nunca se inventa un cero.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tablas
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.contact_touches (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  occurred_at timestamp with time zone NOT NULL,
  source text NOT NULL,
  medium text,
  campaign text,
  content_label text,
  term text,
  medium_raw boolean DEFAULT false NOT NULL,
  social_post_id uuid,
  content_post_id uuid,
  ad_id text,
  adset_id text,
  campaign_id text,
  fbclid text,
  gclid text,
  ttclid text,
  li_fat_id text,
  ctwa_clid text,
  referrer_url text,
  landing_page text,
  origin text NOT NULL,
  dedupe_key text NOT NULL,
  raw jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  meta_campaign_id text,
  meta_adset_id text,
  meta_ad_id text,
  meta_match_status text DEFAULT 'none'::text NOT NULL,
  meta_match_method text,
  meta_match_reason text,
  meta_matched_at timestamp with time zone,
  meta_match_by uuid,
  entry_url text,
  channel text,
  CONSTRAINT contact_touches_pkey PRIMARY KEY (id),
  CONSTRAINT uq_contact_touches_dedupe UNIQUE (workspace_id, dedupe_key),
  CONSTRAINT contact_touches_channel_check CHECK (((channel IS NULL) OR (channel = ANY (ARRAY['organic'::text, 'paid'::text, 'referral'::text, 'direct'::text])))),
  CONSTRAINT contact_touches_meta_match_status_check CHECK ((meta_match_status = ANY (ARRAY['none'::text, 'matched'::text, 'unmatched'::text, 'manual'::text, 'ignored'::text]))),
  CONSTRAINT contact_touches_origin_check CHECK ((origin = ANY (ARRAY['dm'::text, 'comment'::text, 'booking'::text, 'manual'::text, 'import'::text, 'link_click'::text]))),
  CONSTRAINT contact_touches_source_not_empty CHECK ((btrim(source) <> ''::text)),
  CONSTRAINT contact_touches_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
  CONSTRAINT contact_touches_content_post_id_fkey FOREIGN KEY (content_post_id) REFERENCES public.content_posts(id) ON DELETE SET NULL,
  CONSTRAINT contact_touches_meta_match_by_fkey FOREIGN KEY (meta_match_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT contact_touches_social_post_id_fkey FOREIGN KEY (social_post_id) REFERENCES public.social_posts(id) ON DELETE SET NULL,
  CONSTRAINT contact_touches_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.contact_touches ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.contact_touches IS 'Cada interaccion atribuible de un contacto. Solo la escribe el servidor.';
COMMENT ON COLUMN public.contact_touches.meta_match_status IS 'Resultado del vinculo con el catalogo de Meta: none (sin datos de anuncio), matched, unmatched, manual (lo eligio una persona) o ignored. Lo completa el trigger contact_touches_meta_match.';
COMMENT ON COLUMN public.contact_touches.entry_url IS 'La URL de entrada completa de la visita (con todos sus parametros, sin sensibles ni fragmento). La escribe record_contact_touch. Puede traer datos de la persona: nunca se loguea.';
COMMENT ON COLUMN public.contact_touches.channel IS 'organic | paid | referral | direct. Lo calcula contact_touches_zz_channel con touch_channel(); un valor puesto en el INSERT se respeta.';
REVOKE ALL ON TABLE public.contact_touches FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.contact_touches FROM authenticated;

CREATE TABLE IF NOT EXISTS public.meta_ads (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  ad_account_id text NOT NULL,
  campaign_id text,
  adset_id text,
  ad_id text NOT NULL,
  name text,
  name_key text,
  status text,
  effective_status text,
  created_time timestamp with time zone,
  creative_id text,
  creative jsonb DEFAULT '{}'::jsonb NOT NULL,
  thumbnail_source_url text,
  thumbnail_path text,
  thumbnail_attempts integer DEFAULT 0 NOT NULL,
  instagram_media_id text,
  object_story_id text,
  social_post_id uuid,
  content_post_id uuid,
  content_link_manual boolean DEFAULT false NOT NULL,
  raw jsonb DEFAULT '{}'::jsonb NOT NULL,
  synced_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT meta_ads_pkey PRIMARY KEY (id),
  CONSTRAINT meta_ads_thumbnail_attempts_check CHECK ((thumbnail_attempts >= 0)),
  CONSTRAINT meta_ads_content_post_id_fkey FOREIGN KEY (content_post_id) REFERENCES public.content_posts(id) ON DELETE SET NULL,
  CONSTRAINT meta_ads_social_post_id_fkey FOREIGN KEY (social_post_id) REFERENCES public.social_posts(id) ON DELETE SET NULL,
  CONSTRAINT meta_ads_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.meta_ads ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.meta_ads IS 'Catalogo de anuncios de Meta. Los escribe el sync con el service role.';
REVOKE ALL ON TABLE public.meta_ads FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.meta_ads FROM authenticated;

CREATE TABLE IF NOT EXISTS public.meta_ads_insights_daily (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  ad_account_id text NOT NULL,
  level text NOT NULL,
  object_id text NOT NULL,
  object_name text,
  parent_name text,
  campaign_id text,
  adset_id text,
  date date NOT NULL,
  spend numeric,
  impressions integer,
  reach integer,
  clicks integer,
  outbound_clicks integer,
  link_clicks integer,
  ctr numeric,
  cpc numeric,
  cpm numeric,
  leads integer,
  purchases integer,
  purchase_value numeric,
  video_p25 integer,
  video_p50 integer,
  video_p75 integer,
  video_p95 integer,
  video_p100 integer,
  thruplays integer,
  video_avg_time_seconds numeric,
  quality_ranking text,
  engagement_ranking text,
  conversion_ranking text,
  status text,
  effective_status text,
  actions jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT meta_ads_insights_daily_pkey PRIMARY KEY (id),
  CONSTRAINT meta_ads_insights_level_check CHECK ((level = ANY (ARRAY['account'::text, 'campaign'::text, 'adset'::text, 'ad'::text]))),
  CONSTRAINT meta_ads_insights_daily_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.meta_ads_insights_daily ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.meta_ads_insights_daily IS 'Insights de Meta Ads por dia y objeto. Los cuatro niveles (cuenta, campaña, conjunto, anuncio) en una tabla: son las mismas metricas con distinto detalle.';

CREATE TABLE IF NOT EXISTS public.meta_adsets (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  ad_account_id text NOT NULL,
  campaign_id text,
  adset_id text NOT NULL,
  name text,
  name_key text,
  status text,
  effective_status text,
  optimization_goal text,
  billing_event text,
  daily_budget bigint,
  lifetime_budget bigint,
  start_time timestamp with time zone,
  stop_time timestamp with time zone,
  created_time timestamp with time zone,
  raw jsonb DEFAULT '{}'::jsonb NOT NULL,
  synced_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT meta_adsets_pkey PRIMARY KEY (id),
  CONSTRAINT meta_adsets_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.meta_adsets ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.meta_adsets IS 'Catalogo de conjuntos de anuncios de Meta. Los escribe el sync con el service role.';
REVOKE ALL ON TABLE public.meta_adsets FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.meta_adsets FROM authenticated;

CREATE TABLE IF NOT EXISTS public.meta_campaigns (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  ad_account_id text NOT NULL,
  campaign_id text NOT NULL,
  name text,
  name_key text,
  status text,
  effective_status text,
  objective text,
  buying_type text,
  daily_budget bigint,
  lifetime_budget bigint,
  start_time timestamp with time zone,
  stop_time timestamp with time zone,
  created_time timestamp with time zone,
  raw jsonb DEFAULT '{}'::jsonb NOT NULL,
  synced_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT meta_campaigns_pkey PRIMARY KEY (id),
  CONSTRAINT meta_campaigns_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.meta_campaigns ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.meta_campaigns IS 'Catalogo de campañas de Meta. Las escribe el sync con el service role.';
REVOKE ALL ON TABLE public.meta_campaigns FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.meta_campaigns FROM authenticated;

CREATE TABLE IF NOT EXISTS public.social_account_metrics_daily (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  social_account_id uuid NOT NULL,
  date date NOT NULL,
  followers integer,
  followers_gained integer,
  followers_lost integer,
  impressions integer,
  reach integer,
  profile_views integer,
  extra jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT social_account_metrics_daily_pkey PRIMARY KEY (id),
  CONSTRAINT social_account_metrics_daily_social_account_id_fkey FOREIGN KEY (social_account_id) REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  CONSTRAINT social_account_metrics_daily_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.social_account_metrics_daily ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.social_account_metrics_daily IS 'Seguidores y alcance de una cuenta, por dia. Es la base del grafico de crecimiento y del salto de seguidores por post.';

CREATE TABLE IF NOT EXISTS public.social_post_metrics_daily (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  social_post_id uuid NOT NULL,
  date date NOT NULL,
  views integer,
  impressions integer,
  reach integer,
  likes integer,
  comments integer,
  shares integer,
  saves integer,
  watch_time_seconds integer,
  avg_view_duration_seconds numeric,
  engagement_rate numeric,
  extra jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT social_post_metrics_daily_pkey PRIMARY KEY (id),
  CONSTRAINT social_post_metrics_daily_social_post_id_fkey FOREIGN KEY (social_post_id) REFERENCES public.social_posts(id) ON DELETE CASCADE,
  CONSTRAINT social_post_metrics_daily_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.social_post_metrics_daily ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.social_post_metrics_daily IS 'Metricas de una publicacion, acumuladas a cada dia. Un dia sin dato no tiene fila: el grafico muestra el hueco en vez de un cero inventado.';
COMMENT ON COLUMN public.social_post_metrics_daily.extra IS 'Lo propio de cada red: reach_followers, reach_non_followers, creatorContentType, etc.';

-- ----------------------------------------------------------------------------
-- Funciones
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.enqueue_comment_backfill()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_platform text;
  v_username text;
  v_old text;
BEGIN
  BEGIN
    IF NEW.deleted_at IS NOT NULL THEN
      RETURN NEW;
    END IF;
    FOREACH v_platform IN ARRAY ARRAY['instagram', 'tiktok'] LOOP
      v_username := nullif(btrim(CASE v_platform WHEN 'instagram' THEN NEW.instagram_username ELSE NEW.tiktok_username END), '');
      v_old := CASE WHEN TG_OP = 'UPDATE' THEN nullif(btrim(CASE v_platform WHEN 'instagram' THEN OLD.instagram_username ELSE OLD.tiktok_username END), '') END;
      IF v_username IS NULL OR v_username IS NOT DISTINCT FROM v_old THEN
        CONTINUE;
      END IF;
      INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
      VALUES (
        'comment_backfill',
        jsonb_build_object('workspace_id', NEW.workspace_id, 'contact_id', NEW.id, 'platform', v_platform),
        now() + interval '5 seconds',
        'comment_backfill:' || NEW.id::text || ':' || v_platform || ':' || lower(v_username)
      )
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Encolar el vinculo de comentarios nunca puede costar un contacto.
    RAISE WARNING 'enqueue_comment_backfill: no pude encolar el contacto %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.enqueue_comment_backfill() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.meta_touch_utm_counts(t public.contact_touches)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT t.origin IN ('booking', 'form', 'webhook', 'import', 'manual')
      OR nullif(btrim(t.ad_id), '') IS NOT NULL
      OR nullif(btrim(t.adset_id), '') IS NOT NULL
      OR nullif(btrim(t.campaign_id), '') IS NOT NULL
$function$;
REVOKE ALL ON FUNCTION private.meta_touch_utm_counts(t public.contact_touches) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.meta_touch_has_data(t public.contact_touches)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT nullif(btrim(t.ad_id), '') IS NOT NULL
      OR nullif(btrim(t.adset_id), '') IS NOT NULL
      OR nullif(btrim(t.campaign_id), '') IS NOT NULL
      OR nullif(btrim(t.fbclid), '') IS NOT NULL
      OR (
        private.meta_touch_utm_counts(t)
        AND (nullif(btrim(t.campaign), '') IS NOT NULL
             OR nullif(btrim(t.content_label), '') IS NOT NULL
             OR nullif(btrim(t.term), '') IS NOT NULL)
      )
$function$;
REVOKE ALL ON FUNCTION private.meta_touch_has_data(t public.contact_touches) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.refresh_contact_attribution(p_contact_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_first jsonb;
  v_last  jsonb;
BEGIN
  -- Sin toques no hay nada que recalcular (record_contact_touch siempre inserta uno antes de escribir).
  PERFORM 1 FROM public.contact_touches WHERE contact_id = p_contact_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- El MISMO orden que record_contact_touch: occurred_at, created_at, id.
  SELECT public.contact_touch_json(t) INTO v_first
  FROM public.contact_touches t
  WHERE t.contact_id = p_contact_id
  ORDER BY t.occurred_at ASC, t.created_at ASC, t.id ASC
  LIMIT 1;

  SELECT public.contact_touch_json(t) INTO v_last
  FROM public.contact_touches t
  WHERE t.contact_id = p_contact_id
  ORDER BY t.occurred_at DESC, t.created_at DESC, t.id DESC
  LIMIT 1;

  UPDATE public.contacts
  SET attribution = coalesce(attribution, '{}'::jsonb)
        || jsonb_build_object('version', 2, 'first_touch', v_first, 'last_touch', v_last)
  WHERE id = p_contact_id;
END;
$function$;
REVOKE ALL ON FUNCTION private.refresh_contact_attribution(p_contact_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.refresh_contact_attribution(p_contact_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ads_crm_cell_detail(p_level text, p_metric text, p_since date, p_until date, p_ad_account_id text DEFAULT NULL::text, p_workspace_id uuid DEFAULT NULL::uuid, p_object_id text DEFAULT NULL::text, p_object_ids text[] DEFAULT NULL::text[], p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(item_id uuid, contact_id uuid, contact_name text, occurred_at timestamp with time zone, origin text, detail_at timestamp with time zone, amount_cents bigint, total_count bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
BEGIN
  IF p_metric NOT IN ('leads_new', 'leads_total', 'bookings') THEN
    RAISE EXCEPTION 'ads_crm_cell_detail: metrica invalida (%)', p_metric USING ERRCODE = '22023';
  END IF;

  -- La lista del TOTAL de «Leads totales» (sin un objeto): una persona que tocó dos anuncios es UNA fila, igual que en el número
  -- (la fila `is_total` de ads_crm_metrics_v2 cuenta personas distintas). En cualquier otra celda, una fila por registro.
  RETURN QUERY
  WITH src AS (
    SELECT i.item_id AS s_item, i.contact_id AS s_contact, i.occurred_at AS s_occurred, i.origin AS s_origin,
           i.detail_at AS s_detail, i.amount_cents AS s_amount,
           CASE WHEN p_metric = 'leads_total' AND p_object_id IS NULL
                THEN row_number() OVER (PARTITION BY i.contact_id ORDER BY i.occurred_at DESC NULLS LAST, i.obj)
                ELSE 1
           END AS rn
      FROM public.ads_crm_items(p_level, p_metric, p_since, p_until, p_workspace_id, p_ad_account_id, p_object_id, p_object_ids) i
  )
  SELECT s.s_item, s.s_contact, c.display_name, s.s_occurred, s.s_origin, s.s_detail, s.s_amount,
         count(*) OVER ()
    FROM src s
    LEFT JOIN public.contacts c ON c.id = s.s_contact
   WHERE s.rn = 1
   ORDER BY s.s_occurred DESC NULLS LAST, s.s_item
   LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)
  OFFSET greatest(coalesce(p_offset, 0), 0);
END;
$function$;
REVOKE ALL ON FUNCTION public.ads_crm_cell_detail(p_level text, p_metric text, p_since date, p_until date, p_ad_account_id text, p_workspace_id uuid, p_object_id text, p_object_ids text[], p_limit integer, p_offset integer) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.ads_crm_items(p_level text, p_metric text, p_since date, p_until date, p_workspace_id uuid, p_ad_account_id text DEFAULT NULL::text, p_object_id text DEFAULT NULL::text, p_object_ids text[] DEFAULT NULL::text[])
 RETURNS TABLE(obj text, contact_id uuid, item_id uuid, occurred_at timestamp with time zone, origin text, detail_at timestamp with time zone, amount_cents bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_col       text;
  v_cat_table text;
  v_cat_col   text;
  v_tz        text;
  v_lo        timestamptz;
  v_hi        timestamptz;
  v_acct      text;
  v_filter    text;
  v_sql       text;
BEGIN
  v_col := CASE p_level
    WHEN 'campaign' THEN 'meta_campaign_id'
    WHEN 'adset'    THEN 'meta_adset_id'
    WHEN 'ad'       THEN 'meta_ad_id'
  END;
  IF v_col IS NULL THEN
    RAISE EXCEPTION 'ads_crm_items: nivel invalido (%)', p_level USING ERRCODE = '22023';
  END IF;
  IF p_metric NOT IN ('leads_new', 'leads_total', 'bookings') THEN
    RAISE EXCEPTION 'ads_crm_items: metrica invalida (%)', p_metric USING ERRCODE = '22023';
  END IF;
  IF p_since IS NULL OR p_until IS NULL OR p_until < p_since THEN
    RAISE EXCEPTION 'ads_crm_items: rango de fechas invalido' USING ERRCODE = '22023';
  END IF;
  IF p_workspace_id IS NULL THEN
    RETURN;
  END IF;

  SELECT w.timezone INTO v_tz FROM public.workspaces w WHERE w.id = p_workspace_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_tz := coalesce(nullif(btrim(v_tz), ''), 'UTC');
  v_lo := p_since::timestamp AT TIME ZONE v_tz;
  v_hi := (p_until + 1)::timestamp AT TIME ZONE v_tz;

  v_cat_table := CASE p_level WHEN 'campaign' THEN 'meta_campaigns' WHEN 'adset' THEN 'meta_adsets' ELSE 'meta_ads' END;
  v_cat_col   := CASE p_level WHEN 'campaign' THEN 'campaign_id'    WHEN 'adset' THEN 'adset_id'    ELSE 'ad_id' END;

  -- Los objetos de la cuenta: el catálogo Y los insights (con el catálogo vacío, solo el catálogo los dejaba a todos afuera).
  v_acct := format($q$
    WITH acct AS (
      SELECT x.%1$I AS obj FROM public.%2$I x WHERE x.workspace_id = $1 AND x.ad_account_id = $6
      UNION
      SELECT i.object_id FROM public.meta_ads_insights_daily i WHERE i.workspace_id = $1 AND i.ad_account_id = $6 AND i.level = $7
    )
  $q$, v_cat_col, v_cat_table);

  -- Los mismos tres filtros en cada métrica: cuenta, un objeto, o una lista de objetos.
  v_filter := $q$
    ($6::text IS NULL OR x.obj IN (SELECT a.obj FROM acct a))
    AND ($8::text IS NULL OR x.obj = $8)
    AND ($9::text[] IS NULL OR x.obj = ANY($9))
  $q$;

  -- La columna del nivel viene de una lista fija (nunca del pedido): %1$I la cita como identificador, %2$L como texto.
  IF p_metric = 'leads_new' THEN
    v_sql := v_acct || format($q$
      SELECT x.obj, x.contact_id, x.contact_id, x.occurred_at, x.origin, NULL::timestamptz, NULL::bigint
        FROM (
          SELECT c.attribution -> 'first_touch' ->> %2$L AS obj,
                 c.id AS contact_id,
                 nullif(c.attribution -> 'first_touch' ->> 'occurred_at', '')::timestamptz AS occurred_at,
                 c.attribution -> 'first_touch' ->> 'origin' AS origin
            FROM public.contacts c
           WHERE c.workspace_id = $1 AND c.deleted_at IS NULL
             AND c.created_at >= $2 AND c.created_at < $3
             AND c.attribution -> 'first_touch' ->> %2$L IS NOT NULL
        ) x
       WHERE %3$s
    $q$, v_col, v_col, v_filter);

  ELSIF p_metric = 'leads_total' THEN
    v_sql := v_acct || format($q$
      SELECT x.obj, x.contact_id, x.contact_id, x.occurred_at, x.origin, NULL::timestamptz, NULL::bigint
        FROM (
          SELECT DISTINCT ON (t.%1$I, t.contact_id)
                 t.%1$I AS obj, t.contact_id, t.occurred_at, t.origin
            FROM public.contact_touches t
            JOIN public.contacts c ON c.id = t.contact_id AND c.deleted_at IS NULL
           WHERE t.workspace_id = $1 AND t.%1$I IS NOT NULL
             AND t.occurred_at >= $2 AND t.occurred_at < $3
           ORDER BY t.%1$I, t.contact_id, t.occurred_at DESC, t.created_at DESC, t.id DESC
        ) x
       WHERE %2$s
    $q$, v_col, v_filter);

  ELSE -- bookings
    v_sql := v_acct || format($q$
      SELECT x.obj, x.contact_id, x.id, x.touch_at, x.origin, x.start_at, NULL::bigint
        FROM (
          SELECT b.id, b.contact_id, b.start_at,
                 coalesce(bt.obj, lt.obj) AS obj,
                 CASE WHEN bt.obj IS NOT NULL THEN bt.occurred_at ELSE lt.occurred_at END AS touch_at,
                 CASE WHEN bt.obj IS NOT NULL THEN bt.origin ELSE lt.origin END AS origin
            FROM public.bookings b
            LEFT JOIN LATERAL (
              SELECT t.%1$I AS obj, t.occurred_at, t.origin
                FROM public.contact_touches t
               WHERE t.workspace_id = $1 AND t.dedupe_key = 'booking:' || b.id::text AND t.%1$I IS NOT NULL
               LIMIT 1
            ) bt ON true
            LEFT JOIN LATERAL (
              SELECT t.%1$I AS obj, t.occurred_at, t.origin
                FROM public.contact_touches t
               WHERE bt.obj IS NULL
                 AND t.contact_id = b.contact_id AND t.%1$I IS NOT NULL AND t.occurred_at <= b.created_at
               ORDER BY t.occurred_at DESC, t.created_at DESC, t.id DESC
               LIMIT 1
            ) lt ON true
           WHERE b.workspace_id = $1 AND b.created_at >= $2 AND b.created_at < $3
             AND b.slot_released_at IS NULL
        ) x
       WHERE x.obj IS NOT NULL AND %2$s
    $q$, v_col, v_filter);
  END IF;

  RETURN QUERY EXECUTE v_sql USING p_workspace_id, v_lo, v_hi, p_since, p_until, p_ad_account_id, p_level, p_object_id, p_object_ids;
END;
$function$;
REVOKE ALL ON FUNCTION public.ads_crm_items(p_level text, p_metric text, p_since date, p_until date, p_workspace_id uuid, p_ad_account_id text, p_object_id text, p_object_ids text[]) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.ads_crm_metrics_v2(p_level text, p_since date, p_until date, p_ad_account_id text DEFAULT NULL::text, p_workspace_id uuid DEFAULT NULL::uuid, p_object_ids text[] DEFAULT NULL::text[])
 RETURNS TABLE(object_id text, is_total boolean, leads_first integer, leads_total integer, leads_with_booking integer, bookings integer, bookings_attended integer, sales integer, revenue_cents bigint, cash_cents bigint, uf_cash_cents bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_col       text;
  v_cat_table text;
  v_cat_col   text;
  v_tz        text;
  v_lo        timestamptz;
  v_hi        timestamptz;
  v_sql       text;
BEGIN
  v_col := CASE p_level
    WHEN 'campaign' THEN 'meta_campaign_id'
    WHEN 'adset'    THEN 'meta_adset_id'
    WHEN 'ad'       THEN 'meta_ad_id'
  END;
  IF v_col IS NULL THEN
    RAISE EXCEPTION 'ads_crm_metrics_v2: nivel invalido (%)', p_level USING ERRCODE = '22023';
  END IF;
  IF p_since IS NULL OR p_until IS NULL OR p_until < p_since THEN
    RAISE EXCEPTION 'ads_crm_metrics_v2: rango de fechas invalido' USING ERRCODE = '22023';
  END IF;
  IF p_workspace_id IS NULL THEN
    RETURN;
  END IF;

  SELECT w.timezone INTO v_tz FROM public.workspaces w WHERE w.id = p_workspace_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_tz := coalesce(nullif(btrim(v_tz), ''), 'UTC');
  v_lo := p_since::timestamp AT TIME ZONE v_tz;
  v_hi := (p_until + 1)::timestamp AT TIME ZONE v_tz;

  v_cat_table := CASE p_level WHEN 'campaign' THEN 'meta_campaigns' WHEN 'adset' THEN 'meta_adsets' ELSE 'meta_ads' END;
  v_cat_col   := CASE p_level WHEN 'campaign' THEN 'campaign_id'    WHEN 'adset' THEN 'adset_id'    ELSE 'ad_id' END;

  -- Las cuatro ultimas columnas vuelven siempre en NULL: se conservan para que la pantalla no cambie de forma.
  v_sql := format($q$
    WITH
    acct AS (
      SELECT x.%1$I AS obj FROM public.%2$I x WHERE x.workspace_id = $1 AND x.ad_account_id = $6
      UNION
      SELECT i.object_id FROM public.meta_ads_insights_daily i WHERE i.workspace_id = $1 AND i.ad_account_id = $6 AND i.level = $7
    ),
    new_items AS (SELECT * FROM public.ads_crm_items($7, 'leads_new',   $4, $5, $1, $6, NULL, $8)),
    tot_items AS (SELECT * FROM public.ads_crm_items($7, 'leads_total', $4, $5, $1, $6, NULL, $8)),
    bk_items  AS (
      SELECT i.obj, i.contact_id, b.status_group
        FROM public.ads_crm_items($7, 'bookings', $4, $5, $1, $6, NULL, $8) i
        JOIN public.bookings b ON b.id = i.item_id
    ),
    new_agg  AS (SELECT obj, count(*)::int AS n FROM new_items GROUP BY obj),
    tot_agg  AS (SELECT obj, count(*)::int AS n FROM tot_items GROUP BY obj),
    bk_agg   AS (
      SELECT obj, count(*)::int AS bookings,
             (count(*) FILTER (WHERE status_group = 'outcome'))::int AS attended,
             count(DISTINCT contact_id)::int AS leads
        FROM bk_items GROUP BY obj
    ),
    objs AS (
      SELECT obj FROM new_agg UNION SELECT obj FROM tot_agg UNION SELECT obj FROM bk_agg
    )
    SELECT o.obj, false,
           coalesce(n.n, 0), coalesce(tl.n, 0), coalesce(ba.leads, 0),
           coalesce(ba.bookings, 0), coalesce(ba.attended, 0),
           NULL::int, NULL::bigint, NULL::bigint, NULL::bigint
      FROM objs o
      LEFT JOIN new_agg n ON n.obj = o.obj
      LEFT JOIN tot_agg tl ON tl.obj = o.obj
      LEFT JOIN bk_agg ba ON ba.obj = o.obj
     WHERE ($6::text IS NULL OR o.obj IN (SELECT a.obj FROM acct a))
       AND ($8::text[] IS NULL OR o.obj = ANY($8))
    UNION ALL
    -- La fila de total: personas DISTINTAS. Lo demas del total lo suma quien llama (es exacto).
    SELECT NULL::text, true,
           NULL::int,
           (SELECT count(DISTINCT contact_id)::int FROM tot_items),
           (SELECT count(DISTINCT contact_id)::int FROM bk_items),
           NULL::int, NULL::int, NULL::int, NULL::bigint, NULL::bigint, NULL::bigint
    ORDER BY 2, 1
  $q$, v_cat_col, v_cat_table);

  RETURN QUERY EXECUTE v_sql USING p_workspace_id, v_lo, v_hi, p_since, p_until, p_ad_account_id, p_level, p_object_ids;
END;
$function$;
REVOKE ALL ON FUNCTION public.ads_crm_metrics_v2(p_level text, p_since date, p_until date, p_ad_account_id text, p_workspace_id uuid, p_object_ids text[]) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.contact_last_origin_touch(p_contact_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT t.id
    FROM public.contact_touches t
   WHERE t.contact_id = p_contact_id
     AND t.channel IN ('organic', 'paid', 'referral')
   ORDER BY t.occurred_at DESC, t.created_at DESC, t.id DESC
   LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.contact_last_origin_touch(p_contact_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.contact_touch_json(t public.contact_touches)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'occurred_at',     t.occurred_at,
    'source',          t.source,
    'medium',          t.medium,
    'campaign',        t.campaign,
    'content',         t.content_label,
    'term',            t.term,
    'medium_raw',      CASE WHEN t.medium_raw THEN true END,
    'social_post_id',  t.social_post_id,
    'content_post_id', t.content_post_id,
    'ad_id',           t.ad_id,
    'adset_id',        t.adset_id,
    'campaign_id',     t.campaign_id,
    'fbclid',          t.fbclid,
    'gclid',           t.gclid,
    'ttclid',          t.ttclid,
    'li_fat_id',       t.li_fat_id,
    'ctwa_clid',       t.ctwa_clid,
    'referrer_url',    t.referrer_url,
    'landing_page',    t.landing_page,
    'origin',          t.origin,
    'meta_campaign_id', t.meta_campaign_id,
    'meta_adset_id',    t.meta_adset_id,
    'meta_ad_id',       t.meta_ad_id,
    'meta_match_status', CASE WHEN t.meta_match_status <> 'none' THEN t.meta_match_status END,
    'meta_match_method', t.meta_match_method
  ))
$function$;
REVOKE ALL ON FUNCTION public.contact_touch_json(t public.contact_touches) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contact_touches_content_code_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_label text;
  v_piece uuid;
  v_source text;
  v_count int;
  v_post uuid;
BEGIN
  IF NEW.content_post_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_label := lower(btrim(private.meta_url_decode(NEW.content_label)));
    IF v_label IS NULL OR v_label !~ '^c[a-z2-9]{5}$' THEN
      RETURN NEW;
    END IF;
    SELECT p.id INTO v_piece FROM public.content_posts p WHERE p.workspace_id = NEW.workspace_id AND p.attribution_code = v_label;
    IF v_piece IS NULL THEN
      RETURN NEW;
    END IF;
    IF NEW.social_post_id IS NULL THEN
      v_source := lower(btrim(coalesce(NEW.source, '')));
      SELECT count(*), (array_agg(s.id))[1] INTO v_count, v_post
        FROM public.social_posts s
       WHERE s.workspace_id = NEW.workspace_id AND s.content_post_id = v_piece AND s.platform = v_source AND s.deleted_at IS NULL;
      IF v_count = 1 THEN
        NEW.social_post_id := v_post;
      END IF;
    END IF;
    NEW.content_post_id := v_piece;
    NEW.raw := coalesce(NEW.raw, '{}'::jsonb) || jsonb_build_object('content_code_matched', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'contact_touches_content_code: no pude completar la pieza del toque (%): %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.contact_touches_content_code_trg() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contact_touches_meta_match_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  r jsonb;
BEGIN
  -- Lo que una persona eligio o descarto no se vuelve a resolver solo.
  IF NEW.meta_match_status IN ('manual', 'ignored') THEN
    RETURN NEW;
  END IF;

  BEGIN
    r := public.resolve_meta_match_for_touch(NEW);
    NEW.meta_campaign_id := r->>'campaign_id';
    NEW.meta_adset_id    := r->>'adset_id';
    NEW.meta_ad_id       := r->>'ad_id';
    NEW.meta_match_status := coalesce(r->>'status', 'none');
    NEW.meta_match_method := r->>'method';
    NEW.meta_match_reason := r->>'reason';
    NEW.meta_matched_at   := CASE WHEN NEW.meta_match_status = 'matched' THEN now() END;
  EXCEPTION WHEN OTHERS THEN
    -- Un error en el vinculo no puede costar un toque: se guarda sin vincular y queda el aviso en el log.
    NEW.meta_campaign_id := NULL;
    NEW.meta_adset_id := NULL;
    NEW.meta_ad_id := NULL;
    NEW.meta_match_status := 'none';
    NEW.meta_match_method := NULL;
    NEW.meta_match_reason := NULL;
    NEW.meta_matched_at := NULL;
    RAISE WARNING 'contact_touches_meta_match: no pude vincular el toque (%): %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.contact_touches_meta_match_trg() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contact_touches_zz_channel_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_channel text := NEW.channel;
  v_status text := NEW.meta_match_status;
  v_reason text := NEW.meta_match_reason;
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF v_channel IS NULL THEN
        v_channel := public.touch_channel(NEW.origin, NEW.medium, NEW.source, NEW.ad_id, NEW.adset_id, NEW.campaign_id, NEW.meta_ad_id, NEW.meta_campaign_id,
                                          NEW.gclid, NEW.ttclid, NEW.li_fat_id, NEW.ctwa_clid, NEW.fbclid, NEW.social_post_id, NEW.content_post_id);
      END IF;
    ELSIF NEW.channel IS NOT DISTINCT FROM OLD.channel THEN
      -- Se actualizo algo que cambia el canal y nadie lo puso a mano: se recalcula.
      v_channel := public.touch_channel(NEW.origin, NEW.medium, NEW.source, NEW.ad_id, NEW.adset_id, NEW.campaign_id, NEW.meta_ad_id, NEW.meta_campaign_id,
                                        NEW.gclid, NEW.ttclid, NEW.li_fat_id, NEW.ctwa_clid, NEW.fbclid, NEW.social_post_id, NEW.content_post_id);
    END IF;

    -- Un link organico con UTMs no es un anuncio sin vincular.
    IF v_channel = 'organic'
       AND (NEW.content_post_id IS NOT NULL OR NEW.social_post_id IS NOT NULL)
       AND nullif(btrim(NEW.ad_id), '') IS NULL AND nullif(btrim(NEW.adset_id), '') IS NULL AND nullif(btrim(NEW.campaign_id), '') IS NULL
       AND nullif(btrim(NEW.fbclid), '') IS NULL
       AND nullif(btrim(NEW.meta_ad_id), '') IS NULL AND nullif(btrim(NEW.meta_adset_id), '') IS NULL AND nullif(btrim(NEW.meta_campaign_id), '') IS NULL
       AND v_status = 'unmatched' THEN
      v_status := 'ignored';
      v_reason := 'organic_content';
    END IF;

    NEW.channel := v_channel;
    NEW.meta_match_status := v_status;
    NEW.meta_match_reason := v_reason;
  EXCEPTION WHEN OTHERS THEN
    NEW.channel := 'direct';
    RAISE WARNING 'contact_touches_zz_channel: no pude calcular el canal del toque (%): %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.contact_touches_zz_channel_trg() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enrich_touch_ad_origin(p_workspace_id uuid, p_dedupe_key text, p_ad_id text, p_title text DEFAULT NULL::text, p_post_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  t       public.contact_touches%ROWTYPE;
  v_ad    text := left(nullif(btrim(p_ad_id), ''), 500);
  v_title text := left(nullif(btrim(p_title), ''), 500);
  v_post  text := left(nullif(btrim(p_post_id), ''), 500);
  r       jsonb;
BEGIN
  IF p_workspace_id IS NULL OR nullif(btrim(p_dedupe_key), '') IS NULL OR v_ad IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nothing_to_enrich');
  END IF;

  BEGIN
    SELECT * INTO t FROM public.contact_touches
     WHERE workspace_id = p_workspace_id AND dedupe_key = p_dedupe_key
     FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'touch_not_found');
    END IF;

    -- Lo que una persona decidió, o un anuncio que el toque ya traía, no se toca.
    IF t.meta_match_status IN ('manual', 'ignored') THEN
      RETURN jsonb_build_object('ok', true, 'changed', false, 'reason', 'decided_by_person');
    END IF;
    IF nullif(btrim(t.ad_id), '') IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'changed', false, 'reason', 'already_has_ad');
    END IF;

    UPDATE public.contact_touches
       SET ad_id = v_ad,
           content_label = coalesce(nullif(btrim(content_label), ''), v_title),
           medium = 'paid_social',
           raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object(
             'referral', jsonb_strip_nulls(jsonb_build_object(
               'ad_id', v_ad,
               'headline', v_title,
               'post_id', v_post,
               'platform', source,
               'recovered_from', 'zernio_conversation'
             ))
           )
     WHERE id = t.id
     RETURNING * INTO t;

    -- El vínculo con el catálogo, con la regla de siempre (con el anuncio ya puesto, sus datos cuentan).
    r := public.resolve_meta_match_for_touch(t);
    UPDATE public.contact_touches
       SET meta_campaign_id = r->>'campaign_id',
           meta_adset_id = r->>'adset_id',
           meta_ad_id = r->>'ad_id',
           meta_match_status = coalesce(r->>'status', 'none'),
           meta_match_method = r->>'method',
           meta_match_reason = r->>'reason',
           meta_matched_at = CASE WHEN r->>'status' = 'matched' THEN now() END
     WHERE id = t.id;

    PERFORM private.refresh_contact_attribution(t.contact_id);

    RETURN jsonb_build_object(
      'ok', true, 'changed', true, 'contact_id', t.contact_id,
      'status', coalesce(r->>'status', 'none'), 'ad_id', r->>'ad_id'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enrich_touch_ad_origin: no pude completar el toque (%): %', p_dedupe_key, SQLERRM;
    RETURN jsonb_build_object('ok', false, 'error', 'exception');
  END;
END;
$function$;
REVOKE ALL ON FUNCTION public.enrich_touch_ad_origin(p_workspace_id uuid, p_dedupe_key text, p_ad_id text, p_title text, p_post_id text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.meta_action_canonical(p_actions jsonb, p_preference text[])
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT (p_actions ->> pref)::numeric::integer
    FROM unnest(p_preference) WITH ORDINALITY AS u(pref, ord)
   WHERE jsonb_typeof(p_actions) = 'object'
     AND p_actions ? pref
     AND jsonb_typeof(p_actions -> pref) = 'number'
   ORDER BY ord
   LIMIT 1
$function$;
REVOKE ALL ON FUNCTION public.meta_action_canonical(p_actions jsonb, p_preference text[]) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.record_contact_touch(p_workspace_id uuid, p_contact_id uuid, p_touch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_id    uuid;
  v_first jsonb;
  v_last  jsonb;
BEGIN
  IF p_touch IS NULL
     OR nullif(btrim(p_touch->>'source'), '') IS NULL
     OR nullif(btrim(p_touch->>'dedupe_key'), '') IS NULL
     OR nullif(btrim(p_touch->>'origin'), '') IS NULL THEN
    RETURN jsonb_build_object('inserted', false, 'reason', 'invalid');
  END IF;

  PERFORM 1 FROM public.contacts
  WHERE id = p_contact_id AND workspace_id = p_workspace_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('inserted', false, 'reason', 'contact_not_found');
  END IF;

  INSERT INTO public.contact_touches (
    workspace_id, contact_id, occurred_at,
    source, medium, campaign, content_label, term, medium_raw,
    social_post_id, content_post_id,
    ad_id, adset_id, campaign_id, fbclid, gclid, ttclid, li_fat_id, ctwa_clid,
    referrer_url, landing_page, entry_url, origin, dedupe_key, raw
  )
  VALUES (
    p_workspace_id, p_contact_id,
    coalesce((p_touch->>'occurred_at')::timestamptz, now()),
    btrim(p_touch->>'source'),
    nullif(btrim(p_touch->>'medium'), ''),
    nullif(btrim(p_touch->>'campaign'), ''),
    nullif(btrim(p_touch->>'content'), ''),
    nullif(btrim(p_touch->>'term'), ''),
    coalesce((p_touch->>'medium_raw')::boolean, false),
    -- La pieza solo se enlaza si existe Y es de este workspace: una referencia
    -- colgada o ajena no puede tumbar el registro ni filtrar datos.
    (SELECT id FROM public.social_posts
       WHERE id = nullif(p_touch->>'social_post_id', '')::uuid AND workspace_id = p_workspace_id),
    (SELECT id FROM public.content_posts
       WHERE id = nullif(p_touch->>'content_post_id', '')::uuid AND workspace_id = p_workspace_id),
    nullif(p_touch->>'ad_id', ''),
    nullif(p_touch->>'adset_id', ''),
    nullif(p_touch->>'campaign_id', ''),
    nullif(p_touch->>'fbclid', ''),
    nullif(p_touch->>'gclid', ''),
    nullif(p_touch->>'ttclid', ''),
    nullif(p_touch->>'li_fat_id', ''),
    nullif(p_touch->>'ctwa_clid', ''),
    nullif(p_touch->>'referrer_url', ''),
    nullif(p_touch->>'landing_page', ''),
    -- La URL de entrada completa. Puede venir como `entry_url` o, desde la Agenda,
    -- dentro de `raw.utm` (create_booking pasa `p_utm` entero ahi).
    -- Hasta 2000 caracteres: lo que pase de eso se corta, nunca hace fallar el toque.
    left(
      coalesce(
        nullif(btrim(p_touch->>'entry_url'), ''),
        nullif(btrim(p_touch->'raw'->'utm'->>'entry_url'), '')
      ),
      2000
    ),
    btrim(p_touch->>'origin'),
    btrim(p_touch->>'dedupe_key'),
    coalesce(p_touch->'raw', '{}'::jsonb)
  )
  ON CONFLICT (workspace_id, dedupe_key) DO NOTHING
  RETURNING id INTO v_id;

  -- Ya estaba: no hay nada que recalcular ni que escribir.
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('inserted', false, 'reason', 'duplicate');
  END IF;

  SELECT public.contact_touch_json(t) INTO v_first
  FROM public.contact_touches t
  WHERE t.contact_id = p_contact_id
  ORDER BY t.occurred_at ASC, t.created_at ASC, t.id ASC
  LIMIT 1;

  SELECT public.contact_touch_json(t) INTO v_last
  FROM public.contact_touches t
  WHERE t.contact_id = p_contact_id
  ORDER BY t.occurred_at DESC, t.created_at DESC, t.id DESC
  LIMIT 1;

  UPDATE public.contacts
  SET attribution = coalesce(attribution, '{}'::jsonb)
        || jsonb_build_object('version', 2, 'first_touch', v_first, 'last_touch', v_last)
  WHERE id = p_contact_id;

  RETURN jsonb_build_object('inserted', true, 'touch_id', v_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.record_contact_touch(p_workspace_id uuid, p_contact_id uuid, p_touch jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rematch_meta_touches(p_workspace_id uuid, p_since timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_changed int := 0;
  v_batch   int;
  v_last_at timestamptz := '-infinity';
  v_last_id uuid := '00000000-0000-0000-0000-000000000000';
  t         public.contact_touches%ROWTYPE;
  r         jsonb;
  v_contacts uuid[];
BEGIN
  LOOP
    v_batch := 0;
    v_contacts := ARRAY[]::uuid[];

    FOR t IN
      SELECT ct.*
        FROM public.contact_touches ct
       WHERE ct.workspace_id = p_workspace_id
         AND ct.occurred_at >= p_since
         AND (ct.occurred_at, ct.id) > (v_last_at, v_last_id)
         AND (
           ct.meta_match_status IN ('unmatched', 'none')
           OR (ct.meta_match_status = 'matched' AND ct.meta_ad_id IS NULL
               AND (nullif(btrim(ct.ad_id), '') IS NOT NULL OR nullif(btrim(ct.content_label), '') IS NOT NULL))
         )
         AND private.meta_touch_has_data(ct)
       ORDER BY ct.occurred_at, ct.id
       LIMIT 500
    LOOP
      v_batch := v_batch + 1;
      v_last_at := t.occurred_at;
      v_last_id := t.id;

      r := public.resolve_meta_match_for_touch(t);

      -- Si no cambia nada, no se escribe (y no se cuenta).
      IF (r->>'status') IS DISTINCT FROM t.meta_match_status
         OR (r->>'ad_id') IS DISTINCT FROM t.meta_ad_id
         OR (r->>'adset_id') IS DISTINCT FROM t.meta_adset_id
         OR (r->>'campaign_id') IS DISTINCT FROM t.meta_campaign_id
         OR (r->>'method') IS DISTINCT FROM t.meta_match_method
         OR (r->>'reason') IS DISTINCT FROM t.meta_match_reason THEN
        UPDATE public.contact_touches
           SET meta_campaign_id = r->>'campaign_id',
               meta_adset_id = r->>'adset_id',
               meta_ad_id = r->>'ad_id',
               meta_match_status = coalesce(r->>'status', 'none'),
               meta_match_method = r->>'method',
               meta_match_reason = r->>'reason',
               meta_matched_at = CASE WHEN r->>'status' = 'matched' THEN now() END
         WHERE id = t.id;
        v_changed := v_changed + 1;
        v_contacts := array_append(v_contacts, t.contact_id);
      END IF;
    END LOOP;

    EXIT WHEN v_batch = 0;

    -- El contacto se refresca una vez por lote, no una vez por toque.
    PERFORM private.refresh_contact_attribution(c) FROM (SELECT DISTINCT unnest(v_contacts) AS c) x;
  END LOOP;

  RETURN v_changed;
END;
$function$;
REVOKE ALL ON FUNCTION public.rematch_meta_touches(p_workspace_id uuid, p_since timestamp with time zone) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.resolve_meta_match(p_workspace_id uuid, p_ad_id text, p_adset_id text, p_campaign_id text, p_utm_campaign text, p_utm_content text, p_utm_term text, p_fbclid text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ad_id        text := nullif(btrim(p_ad_id), '');
  v_adset_id     text := nullif(btrim(p_adset_id), '');
  v_campaign_id  text := nullif(btrim(p_campaign_id), '');
  v_utm_campaign text := nullif(btrim(private.meta_url_decode(p_utm_campaign)), '');
  v_utm_content  text := nullif(btrim(private.meta_url_decode(p_utm_content)), '');
  v_utm_term     text := nullif(btrim(private.meta_url_decode(p_utm_term)), '');
  v_fbclid       text := nullif(btrim(p_fbclid), '');

  -- Lo resuelto
  r_ad           text;
  r_ad_adset     text;
  r_ad_campaign  text;
  r_adset        text;
  r_adset_camp   text;
  r_campaign     text;
  m_ad           text;
  m_adset        text;
  m_campaign     text;

  -- Pistas de campaña (pasos 1, 2 y 4) para desempatar anuncios homonimos
  h_campaign     text;
  h_campaign_n   int;
  h_direct       text;
  v_name_key     text;
  v_n            int;

  ambiguous_ad       boolean := false;
  ambiguous_campaign boolean := false;
  v_notes        text[] := ARRAY[]::text[];
  v_status       text;
  v_method       text;
  v_reason       text;
BEGIN
  -- Sin ningun dato de Meta (ni ids, ni UTMs con valor, ni fbclid): no hay nada que resolver.
  IF v_ad_id IS NULL AND v_adset_id IS NULL AND v_campaign_id IS NULL
     AND v_utm_campaign IS NULL AND v_utm_content IS NULL AND v_utm_term IS NULL AND v_fbclid IS NULL THEN
    RETURN jsonb_build_object('status', 'none', 'ad_id', NULL, 'adset_id', NULL, 'campaign_id', NULL, 'method', NULL, 'reason', NULL);
  END IF;

  -- ---- La campaña que se puede deducir SIN pasar por el anuncio (pistas 1, 2 y 4) ----
  IF v_campaign_id IS NOT NULL THEN
    SELECT c.campaign_id INTO h_campaign FROM public.meta_campaigns c
     WHERE c.workspace_id = p_workspace_id AND c.campaign_id = v_campaign_id LIMIT 1;
    IF h_campaign IS NOT NULL THEN h_direct := h_campaign; END IF;
  END IF;
  IF h_campaign IS NULL AND v_utm_campaign IS NOT NULL THEN
    SELECT c.campaign_id INTO h_campaign FROM public.meta_campaigns c
     WHERE c.workspace_id = p_workspace_id AND c.campaign_id = v_utm_campaign LIMIT 1;
    IF h_campaign IS NOT NULL THEN h_direct := h_campaign; END IF;
  END IF;
  IF h_campaign IS NULL AND v_utm_campaign IS NOT NULL THEN
    v_name_key := public.meta_name_key(v_utm_campaign);
    SELECT count(DISTINCT c.campaign_id), min(c.campaign_id) INTO h_campaign_n, h_campaign
      FROM public.meta_campaigns c
     WHERE c.workspace_id = p_workspace_id AND c.name_key = v_name_key AND v_name_key <> '';
    IF h_campaign_n > 1 THEN
      h_campaign := NULL;
      ambiguous_campaign := true;
    END IF;
  END IF;

  -- ---- Anuncio ----
  IF v_ad_id IS NOT NULL THEN
    SELECT a.ad_id, a.adset_id, a.campaign_id INTO r_ad, r_ad_adset, r_ad_campaign FROM public.meta_ads a
     WHERE a.workspace_id = p_workspace_id AND a.ad_id = v_ad_id LIMIT 1;
    IF r_ad IS NOT NULL THEN m_ad := 'ad_id'; END IF;
  END IF;
  IF r_ad IS NULL AND v_utm_content IS NOT NULL THEN
    SELECT a.ad_id, a.adset_id, a.campaign_id INTO r_ad, r_ad_adset, r_ad_campaign FROM public.meta_ads a
     WHERE a.workspace_id = p_workspace_id AND a.ad_id = v_utm_content LIMIT 1;
    IF r_ad IS NOT NULL THEN m_ad := 'utm_content_id'; END IF;
  END IF;
  IF r_ad IS NULL AND v_utm_content IS NOT NULL THEN
    v_name_key := public.meta_name_key(v_utm_content);
    IF v_name_key <> '' THEN
      SELECT count(*) INTO v_n FROM public.meta_ads a
       WHERE a.workspace_id = p_workspace_id AND a.name_key = v_name_key;
      IF v_n = 1 THEN
        SELECT a.ad_id, a.adset_id, a.campaign_id INTO r_ad, r_ad_adset, r_ad_campaign FROM public.meta_ads a
         WHERE a.workspace_id = p_workspace_id AND a.name_key = v_name_key LIMIT 1;
        m_ad := 'utm_content_name';
      ELSIF v_n > 1 THEN
        -- Varios anuncios con ese nombre: se desempata con la campaña (pistas 1, 2 y 4).
        IF h_campaign IS NOT NULL THEN
          SELECT count(*) INTO v_n FROM public.meta_ads a
           WHERE a.workspace_id = p_workspace_id AND a.name_key = v_name_key AND a.campaign_id = h_campaign;
          IF v_n = 1 THEN
            SELECT a.ad_id, a.adset_id, a.campaign_id INTO r_ad, r_ad_adset, r_ad_campaign FROM public.meta_ads a
             WHERE a.workspace_id = p_workspace_id AND a.name_key = v_name_key AND a.campaign_id = h_campaign LIMIT 1;
            m_ad := 'utm_content_name_campaign';
          END IF;
        END IF;
        IF r_ad IS NULL THEN ambiguous_ad := true; END IF;
      END IF;
    END IF;
  END IF;

  -- ---- Conjunto ----
  IF v_adset_id IS NOT NULL THEN
    SELECT s.adset_id, s.campaign_id INTO r_adset, r_adset_camp FROM public.meta_adsets s
     WHERE s.workspace_id = p_workspace_id AND s.adset_id = v_adset_id LIMIT 1;
    IF r_adset IS NOT NULL THEN m_adset := 'adset_id'; END IF;
  END IF;
  IF r_adset IS NULL AND v_utm_term IS NOT NULL THEN
    SELECT s.adset_id, s.campaign_id INTO r_adset, r_adset_camp FROM public.meta_adsets s
     WHERE s.workspace_id = p_workspace_id AND s.adset_id = v_utm_term LIMIT 1;
    IF r_adset IS NOT NULL THEN m_adset := 'utm_term_id'; END IF;
  END IF;
  IF r_adset IS NULL AND r_ad IS NOT NULL AND r_ad_adset IS NOT NULL THEN
    r_adset := r_ad_adset;
    m_adset := m_ad;
    SELECT s.campaign_id INTO r_adset_camp FROM public.meta_adsets s
     WHERE s.workspace_id = p_workspace_id AND s.adset_id = r_adset LIMIT 1;
  END IF;

  -- ---- Campaña ----
  IF h_direct IS NOT NULL THEN
    r_campaign := h_direct;
    m_campaign := CASE WHEN v_campaign_id IS NOT NULL AND h_direct = v_campaign_id THEN 'campaign_id' ELSE 'utm_campaign_id' END;
    -- Coherencia: si el anuncio es de OTRA campaña, gana el anuncio (es mas especifico).
    IF r_ad IS NOT NULL AND r_ad_campaign IS NOT NULL AND r_ad_campaign <> r_campaign THEN
      r_campaign := r_ad_campaign;
      m_campaign := m_ad;
      v_notes := array_append(v_notes, 'inconsistent_campaign');
    END IF;
  ELSIF r_ad_campaign IS NOT NULL OR r_adset_camp IS NOT NULL THEN
    r_campaign := coalesce(r_ad_campaign, r_adset_camp);
    m_campaign := CASE WHEN r_ad_campaign IS NOT NULL THEN m_ad ELSE m_adset END;
  ELSIF h_campaign IS NOT NULL THEN
    -- El nombre de la campaña de una sola coincidencia (paso 4).
    r_campaign := h_campaign;
    m_campaign := 'utm_campaign_name';
  END IF;

  -- ---- Resultado ----
  IF r_ad IS NOT NULL OR r_adset IS NOT NULL OR r_campaign IS NOT NULL THEN
    v_status := 'matched';
    v_method := coalesce(m_ad, m_adset, m_campaign);
    IF ambiguous_ad THEN v_notes := array_append(v_notes, 'ambiguous_ad_name'); END IF;
    IF ambiguous_campaign AND r_campaign IS NULL THEN v_notes := array_append(v_notes, 'ambiguous_campaign_name'); END IF;
    -- Un id que vino y no esta en el catalogo, aunque otra pista haya resuelto algo.
    IF (v_ad_id IS NOT NULL AND r_ad IS NULL) OR (v_adset_id IS NOT NULL AND m_adset IS DISTINCT FROM 'adset_id')
       OR (v_campaign_id IS NOT NULL AND h_direct IS DISTINCT FROM v_campaign_id AND r_campaign IS DISTINCT FROM v_campaign_id) THEN
      v_notes := array_append(v_notes, 'id_not_in_catalog');
    END IF;
    v_reason := nullif(array_to_string(v_notes, ','), '');
  ELSE
    v_status := 'unmatched';
    IF v_ad_id IS NOT NULL OR v_adset_id IS NOT NULL OR v_campaign_id IS NOT NULL THEN
      v_reason := 'id_not_in_catalog';
    ELSIF ambiguous_ad THEN
      v_reason := 'ambiguous_ad_name';
    ELSIF ambiguous_campaign THEN
      v_reason := 'ambiguous_campaign_name';
    ELSIF v_utm_campaign IS NOT NULL OR v_utm_content IS NOT NULL OR v_utm_term IS NOT NULL THEN
      v_reason := 'name_not_found';
    ELSE
      v_reason := 'fbclid_only';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'ad_id', r_ad,
    'adset_id', r_adset,
    'campaign_id', r_campaign,
    'method', v_method,
    'reason', v_reason
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.resolve_meta_match(p_workspace_id uuid, p_ad_id text, p_adset_id text, p_campaign_id text, p_utm_campaign text, p_utm_content text, p_utm_term text, p_fbclid text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.resolve_meta_match_for_touch(t public.contact_touches)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT public.resolve_meta_match(
    t.workspace_id, t.ad_id, t.adset_id, t.campaign_id,
    CASE WHEN private.meta_touch_utm_counts(t) THEN t.campaign END,
    CASE WHEN private.meta_touch_utm_counts(t) THEN t.content_label END,
    CASE WHEN private.meta_touch_utm_counts(t) THEN t.term END,
    t.fbclid
  )
$function$;
REVOKE ALL ON FUNCTION public.resolve_meta_match_for_touch(t public.contact_touches) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_touch_meta_match(p_workspace_id uuid, p_touch_id uuid, p_action text, p_user_id uuid, p_ad_id text DEFAULT NULL::text, p_adset_id text DEFAULT NULL::text, p_campaign_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  t          public.contact_touches%ROWTYPE;
  v_before   jsonb;
  v_ad       text := nullif(btrim(p_ad_id), '');
  v_adset    text := nullif(btrim(p_adset_id), '');
  v_campaign text := nullif(btrim(p_campaign_id), '');
  a_adset    text;
  a_campaign text;
  s_campaign text;
  r          jsonb;
BEGIN
  IF p_action NOT IN ('link', 'ignore', 'unlink') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_action');
  END IF;

  SELECT * INTO t FROM public.contact_touches WHERE id = p_touch_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'touch_not_found');
  END IF;

  v_before := jsonb_build_object(
    'status', t.meta_match_status, 'ad_id', t.meta_ad_id, 'adset_id', t.meta_adset_id,
    'campaign_id', t.meta_campaign_id, 'method', t.meta_match_method
  );

  IF p_action = 'link' THEN
    -- Elegir un anuncio completa su conjunto y su campaña; un conjunto, su campaña. Todo tiene que estar en el catalogo.
    IF v_ad IS NOT NULL THEN
      SELECT a.adset_id, a.campaign_id INTO a_adset, a_campaign FROM public.meta_ads a
       WHERE a.workspace_id = p_workspace_id AND a.ad_id = v_ad LIMIT 1;
      IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_in_catalog'); END IF;
      v_adset := coalesce(a_adset, v_adset);
      v_campaign := coalesce(a_campaign, v_campaign);
    END IF;
    IF v_adset IS NOT NULL THEN
      SELECT s.campaign_id INTO s_campaign FROM public.meta_adsets s
       WHERE s.workspace_id = p_workspace_id AND s.adset_id = v_adset LIMIT 1;
      IF NOT FOUND AND v_ad IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_in_catalog'); END IF;
      v_campaign := coalesce(v_campaign, s_campaign);
    END IF;
    IF v_campaign IS NOT NULL AND v_ad IS NULL AND v_adset IS NULL THEN
      PERFORM 1 FROM public.meta_campaigns c WHERE c.workspace_id = p_workspace_id AND c.campaign_id = v_campaign;
      IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_in_catalog'); END IF;
    END IF;
    IF v_ad IS NULL AND v_adset IS NULL AND v_campaign IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'nothing_to_link');
    END IF;

    UPDATE public.contact_touches
       SET meta_ad_id = v_ad, meta_adset_id = v_adset, meta_campaign_id = v_campaign,
           meta_match_status = 'manual', meta_match_method = 'manual', meta_match_reason = NULL,
           meta_matched_at = now(), meta_match_by = p_user_id
     WHERE id = t.id;

  ELSIF p_action = 'ignore' THEN
    UPDATE public.contact_touches
       SET meta_ad_id = NULL, meta_adset_id = NULL, meta_campaign_id = NULL,
           meta_match_status = 'ignored', meta_match_method = NULL, meta_match_reason = NULL,
           meta_matched_at = now(), meta_match_by = p_user_id
     WHERE id = t.id;

  ELSE
    -- unlink: solo tiene sentido sobre lo que una persona toco; vuelve a resolverse solo.
    IF t.meta_match_status NOT IN ('manual', 'ignored') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_manual');
    END IF;
    r := public.resolve_meta_match_for_touch(t);
    UPDATE public.contact_touches
       SET meta_campaign_id = r->>'campaign_id', meta_adset_id = r->>'adset_id', meta_ad_id = r->>'ad_id',
           meta_match_status = coalesce(r->>'status', 'none'), meta_match_method = r->>'method',
           meta_match_reason = r->>'reason',
           meta_matched_at = CASE WHEN r->>'status' = 'matched' THEN now() END,
           meta_match_by = NULL
     WHERE id = t.id;
  END IF;

  PERFORM private.refresh_contact_attribution(t.contact_id);

  RETURN jsonb_build_object(
    'ok', true,
    'contact_id', t.contact_id,
    'before', v_before,
    'after', (SELECT jsonb_build_object(
        'status', x.meta_match_status, 'ad_id', x.meta_ad_id, 'adset_id', x.meta_adset_id,
        'campaign_id', x.meta_campaign_id, 'method', x.meta_match_method)
      FROM public.contact_touches x WHERE x.id = t.id)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.set_touch_meta_match(p_workspace_id uuid, p_touch_id uuid, p_action text, p_user_id uuid, p_ad_id text, p_adset_id text, p_campaign_id text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.touch_channel(p_origin text, p_medium text, p_source text, p_ad_id text, p_adset_id text, p_campaign_id text, p_meta_ad_id text, p_meta_campaign_id text, p_gclid text, p_ttclid text, p_li_fat_id text, p_ctwa_clid text, p_fbclid text, p_social_post_id uuid, p_content_post_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_origin text := nullif(lower(btrim(p_origin)), '');
  v_medium text := nullif(lower(btrim(p_medium)), '');
  v_source text := nullif(lower(btrim(p_source)), '');
BEGIN
  -- 1) Pauta
  IF nullif(btrim(p_ad_id), '') IS NOT NULL
     OR nullif(btrim(p_adset_id), '') IS NOT NULL
     OR nullif(btrim(p_campaign_id), '') IS NOT NULL
     OR nullif(btrim(p_meta_ad_id), '') IS NOT NULL
     OR nullif(btrim(p_meta_campaign_id), '') IS NOT NULL
     OR nullif(btrim(p_gclid), '') IS NOT NULL
     OR nullif(btrim(p_ttclid), '') IS NOT NULL
     OR nullif(btrim(p_li_fat_id), '') IS NOT NULL
     OR nullif(btrim(p_ctwa_clid), '') IS NOT NULL
     OR (v_medium IS NOT NULL AND v_medium = ANY (ARRAY['paid_social', 'cpc', 'ppc', 'paid', 'display', 'paidsocial', 'paid_search'])) THEN
    RETURN 'paid';
  END IF;

  -- 2) Referido
  IF v_medium = 'referral_person' THEN
    RETURN 'referral';
  END IF;

  -- 3) Organico
  IF p_social_post_id IS NOT NULL
     OR p_content_post_id IS NOT NULL
     OR (v_medium IS NOT NULL AND v_medium = ANY (ARRAY['comment', 'story_reply', 'story_mention', 'organic_social', 'social', 'dm_link']))
     OR (v_origin = 'dm' AND v_source IS NOT NULL
         AND v_source = ANY (ARRAY['instagram', 'tiktok', 'facebook', 'youtube', 'linkedin', 'threads', 'twitter'])) THEN
    RETURN 'organic';
  END IF;

  -- 4) Cualquier otro caso
  RETURN 'direct';
END;
$function$;
REVOKE ALL ON FUNCTION public.touch_channel(p_origin text, p_medium text, p_source text, p_ad_id text, p_adset_id text, p_campaign_id text, p_meta_ad_id text, p_meta_campaign_id text, p_gclid text, p_ttclid text, p_li_fat_id text, p_ctwa_clid text, p_fbclid text, p_social_post_id uuid, p_content_post_id uuid) FROM PUBLIC, anon;

-- ----------------------------------------------------------------------------
-- Indices
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_account_metrics_workspace_date ON public.social_account_metrics_daily USING btree (workspace_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_contact_touches_channel ON public.contact_touches USING btree (workspace_id, contact_id, channel, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_touches_contact ON public.contact_touches USING btree (workspace_id, contact_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_contact_touches_meta_ad ON public.contact_touches USING btree (workspace_id, meta_ad_id, occurred_at) WHERE (meta_ad_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contact_touches_meta_adset ON public.contact_touches USING btree (workspace_id, meta_adset_id, occurred_at) WHERE (meta_adset_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contact_touches_meta_campaign ON public.contact_touches USING btree (workspace_id, meta_campaign_id, occurred_at) WHERE (meta_campaign_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contact_touches_meta_unmatched ON public.contact_touches USING btree (workspace_id, occurred_at DESC) WHERE (meta_match_status = 'unmatched'::text);

CREATE INDEX IF NOT EXISTS idx_contact_touches_social_post ON public.contact_touches USING btree (social_post_id) WHERE (social_post_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contact_touches_source_medium ON public.contact_touches USING btree (workspace_id, source, medium, occurred_at);

CREATE INDEX IF NOT EXISTS idx_meta_ads_adset ON public.meta_ads USING btree (workspace_id, adset_id);

CREATE INDEX IF NOT EXISTS idx_meta_ads_campaign ON public.meta_ads USING btree (workspace_id, campaign_id);

CREATE INDEX IF NOT EXISTS idx_meta_ads_insights_account_date ON public.meta_ads_insights_daily USING btree (workspace_id, ad_account_id, level, date DESC);

CREATE INDEX IF NOT EXISTS idx_meta_ads_instagram_media ON public.meta_ads USING btree (workspace_id, instagram_media_id) WHERE (instagram_media_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_meta_ads_name_key ON public.meta_ads USING btree (workspace_id, name_key);

CREATE INDEX IF NOT EXISTS idx_meta_ads_thumbnail_pending ON public.meta_ads USING btree (workspace_id, thumbnail_attempts) WHERE (thumbnail_path IS NULL);

CREATE INDEX IF NOT EXISTS idx_meta_ads_ws_ad ON public.meta_ads USING btree (workspace_id, ad_id);

CREATE INDEX IF NOT EXISTS idx_meta_adsets_campaign ON public.meta_adsets USING btree (workspace_id, campaign_id);

CREATE INDEX IF NOT EXISTS idx_meta_adsets_name_key ON public.meta_adsets USING btree (workspace_id, name_key);

CREATE INDEX IF NOT EXISTS idx_meta_adsets_ws_adset ON public.meta_adsets USING btree (workspace_id, adset_id);

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_name_key ON public.meta_campaigns USING btree (workspace_id, name_key);

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_ws_campaign ON public.meta_campaigns USING btree (workspace_id, campaign_id);

CREATE INDEX IF NOT EXISTS idx_post_metrics_workspace_date ON public.social_post_metrics_daily USING btree (workspace_id, date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_account_metrics_daily ON public.social_account_metrics_daily USING btree (social_account_id, date);

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_ads ON public.meta_ads USING btree (workspace_id, ad_account_id, ad_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_ads_insights ON public.meta_ads_insights_daily USING btree (workspace_id, level, object_id, date);

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_adsets ON public.meta_adsets USING btree (workspace_id, ad_account_id, adset_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_campaigns ON public.meta_campaigns USING btree (workspace_id, ad_account_id, campaign_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_post_metrics_daily ON public.social_post_metrics_daily USING btree (social_post_id, date);

-- ----------------------------------------------------------------------------
-- Disparadores
-- ----------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER contact_touches_content_code BEFORE INSERT ON public.contact_touches FOR EACH ROW EXECUTE FUNCTION public.contact_touches_content_code_trg();

CREATE OR REPLACE TRIGGER contact_touches_meta_match BEFORE INSERT ON public.contact_touches FOR EACH ROW EXECUTE FUNCTION public.contact_touches_meta_match_trg();

CREATE OR REPLACE TRIGGER contact_touches_zz_channel BEFORE INSERT OR UPDATE OF ad_id, adset_id, campaign_id, meta_ad_id, meta_adset_id, meta_campaign_id, social_post_id, content_post_id, medium ON public.contact_touches FOR EACH ROW EXECUTE FUNCTION public.contact_touches_zz_channel_trg();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.contact_touches FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER contacts_comment_backfill AFTER INSERT OR UPDATE OF instagram_username, tiktok_username ON public.contacts FOR EACH ROW WHEN ((new.deleted_at IS NULL)) EXECUTE FUNCTION private.enqueue_comment_backfill();

CREATE OR REPLACE TRIGGER set_updated_at_meta_ads_insights_daily BEFORE UPDATE ON public.meta_ads_insights_daily FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_meta_ads BEFORE UPDATE ON public.meta_ads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_meta_adsets BEFORE UPDATE ON public.meta_adsets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_meta_campaigns BEFORE UPDATE ON public.meta_campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_social_account_metrics_daily BEFORE UPDATE ON public.social_account_metrics_daily FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_social_post_metrics_daily BEFORE UPDATE ON public.social_post_metrics_daily FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ----------------------------------------------------------------------------
-- Reglas de acceso (RLS)
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE POLICY contact_touches_select ON public.contact_touches FOR SELECT TO authenticated
    USING ((EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE ((c.id = contact_touches.contact_id) AND (c.workspace_id = contact_touches.workspace_id)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY meta_ads_insights_daily_select_admin ON public.meta_ads_insights_daily FOR SELECT TO authenticated
    USING (public.is_workspace_admin(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY meta_ads_insights_daily_select_perm ON public.meta_ads_insights_daily FOR SELECT TO authenticated
    USING ((public.is_workspace_member(workspace_id) AND public.has_permission(workspace_id, 'dashboards.ads.view'::text)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY meta_ads_select ON public.meta_ads FOR SELECT TO authenticated
    USING ((public.is_workspace_member(workspace_id) AND public.has_permission(workspace_id, 'dashboards.ads.view'::text)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY meta_adsets_select ON public.meta_adsets FOR SELECT TO authenticated
    USING ((public.is_workspace_member(workspace_id) AND public.has_permission(workspace_id, 'dashboards.ads.view'::text)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY meta_campaigns_select ON public.meta_campaigns FOR SELECT TO authenticated
    USING ((public.is_workspace_member(workspace_id) AND public.has_permission(workspace_id, 'dashboards.ads.view'::text)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY social_account_metrics_daily_select_permission ON public.social_account_metrics_daily FOR SELECT TO authenticated
    USING ((public.has_permission(workspace_id, 'social.view'::text) OR public.has_permission(workspace_id, 'dashboards.content.view'::text)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY social_post_metrics_daily_select_permission ON public.social_post_metrics_daily FOR SELECT TO authenticated
    USING ((public.has_permission(workspace_id, 'social.view'::text) OR public.has_permission(workspace_id, 'dashboards.content.view'::text)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
