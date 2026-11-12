-- ============================================================================
-- Metricas, anuncios y atribucion
--
-- Las metricas diarias de cada publicacion y de cada cuenta, el catalogo de Meta
-- (campanas, conjuntos y anuncios) con sus metricas diarias, y la atribucion: cada
-- interaccion de un contacto (toque) con su canal (organico, pauta, referido, directo),
-- su vinculo con el anuncio de Meta y con la pieza de contenido. Tambien la cola de eventos
-- de la API de Conversiones de Meta (reuniones agendadas y pasos de automatizacion).
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
  CONSTRAINT contact_touches_origin_check CHECK ((origin = ANY (ARRAY['dm'::text, 'comment'::text, 'booking'::text, 'form'::text, 'manual'::text, 'import'::text, 'webhook'::text, 'link_click'::text, 'whatsapp_group'::text]))),
  CONSTRAINT contact_touches_source_not_empty CHECK ((btrim(source) <> ''::text)),
  CONSTRAINT contact_touches_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
  CONSTRAINT contact_touches_content_post_id_fkey FOREIGN KEY (content_post_id) REFERENCES public.content_posts(id) ON DELETE SET NULL,
  CONSTRAINT contact_touches_meta_match_by_fkey FOREIGN KEY (meta_match_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT contact_touches_social_post_id_fkey FOREIGN KEY (social_post_id) REFERENCES public.social_posts(id) ON DELETE SET NULL,
  CONSTRAINT contact_touches_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.contact_touches ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.contact_touches IS 'Cada interaccion atribuible de un contacto (F82). Solo la escribe el servidor.';
COMMENT ON COLUMN public.contact_touches.meta_match_status IS 'Resultado del vinculo con el catalogo de Meta: none (sin datos de anuncio), matched, unmatched, manual (lo eligio una persona) o ignored. Lo completa el trigger contact_touches_meta_match.';
COMMENT ON COLUMN public.contact_touches.entry_url IS 'La URL de entrada completa de la visita (con todos sus parametros, sin sensibles ni fragmento). La escribe record_contact_touch (00215). Puede traer datos de la persona: nunca se loguea.';
COMMENT ON COLUMN public.contact_touches.channel IS 'organic | paid | referral | direct. Lo calcula contact_touches_zz_channel con touch_channel(); un valor puesto en el INSERT se respeta.';
REVOKE ALL ON TABLE public.contact_touches FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.contact_touches FROM authenticated;

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
  video_id text,
  transcript text,
  transcript_status text DEFAULT 'none'::text NOT NULL,
  transcript_source text,
  transcript_updated_at timestamp with time zone,
  transcript_updated_by uuid,
  CONSTRAINT meta_ads_pkey PRIMARY KEY (id),
  CONSTRAINT meta_ads_thumbnail_attempts_check CHECK ((thumbnail_attempts >= 0)),
  CONSTRAINT meta_ads_transcript_shape CHECK ((((transcript_status = 'ready'::text) AND (transcript IS NOT NULL) AND (btrim(transcript) <> ''::text) AND (transcript_source IS NOT NULL)) OR ((transcript_status = 'none'::text) AND (transcript IS NULL)) OR (transcript_status = ANY (ARRAY['pending'::text, 'failed'::text])))),
  CONSTRAINT meta_ads_transcript_source_check CHECK (((transcript_source IS NULL) OR (transcript_source = ANY (ARRAY['auto'::text, 'manual'::text])))),
  CONSTRAINT meta_ads_transcript_status_check CHECK ((transcript_status = ANY (ARRAY['none'::text, 'pending'::text, 'ready'::text, 'failed'::text]))),
  CONSTRAINT meta_ads_content_post_id_fkey FOREIGN KEY (content_post_id) REFERENCES public.content_posts(id) ON DELETE SET NULL,
  CONSTRAINT meta_ads_social_post_id_fkey FOREIGN KEY (social_post_id) REFERENCES public.social_posts(id) ON DELETE SET NULL,
  CONSTRAINT meta_ads_transcript_updated_by_fkey FOREIGN KEY (transcript_updated_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT meta_ads_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.meta_ads ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.meta_ads IS 'Catalogo de anuncios de Meta (Extra L). Los escribe el sync con el service role.';
COMMENT ON COLUMN public.meta_ads.video_id IS 'El id del video del creativo en Meta (creative.video_id, object_story_spec.video_data o asset_feed_spec). Lo escribe el sync.';
COMMENT ON COLUMN public.meta_ads.transcript IS 'Lo que se dice en el video. Hoy se carga a mano desde el detalle del anuncio.';
COMMENT ON COLUMN public.meta_ads.transcript_status IS 'none | pending | ready | failed. pending y failed quedan para la transcripcion automatica.';
COMMENT ON COLUMN public.meta_ads.transcript_source IS 'auto | manual. La automatica nunca pisa una manual.';
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
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.meta_ads_insights_daily FROM anon, authenticated;

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
COMMENT ON TABLE public.meta_adsets IS 'Catalogo de conjuntos de anuncios de Meta (Extra L). Los escribe el sync con el service role.';
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
COMMENT ON TABLE public.meta_campaigns IS 'Catalogo de campañas de Meta (Extra L). Las escribe el sync con el service role.';
REVOKE ALL ON TABLE public.meta_campaigns FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.meta_campaigns FROM authenticated;

CREATE TABLE IF NOT EXISTS public.meta_capi_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  event_name text NOT NULL,
  event_id text NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  flow_id uuid,
  flow_session_id uuid,
  event_time timestamp with time zone NOT NULL,
  params jsonb DEFAULT '{}'::jsonb NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  skip_reason text,
  attempts integer DEFAULT 0 NOT NULL,
  test boolean DEFAULT false NOT NULL,
  action_source text,
  fbtrace_id text,
  error text,
  sent_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT meta_capi_events_pkey PRIMARY KEY (id),
  CONSTRAINT meta_capi_events_action_source_check CHECK (((action_source IS NULL) OR (action_source = ANY (ARRAY['website'::text, 'system_generated'::text])))),
  CONSTRAINT meta_capi_events_attempts_check CHECK ((attempts >= 0)),
  CONSTRAINT meta_capi_events_error_check CHECK (((error IS NULL) OR (char_length(error) <= 500))),
  CONSTRAINT meta_capi_events_event_id_check CHECK (((char_length(event_id) >= 1) AND (char_length(event_id) <= 200))),
  CONSTRAINT meta_capi_events_event_name_check CHECK (((char_length(event_name) >= 1) AND (char_length(event_name) <= 50))),
  CONSTRAINT meta_capi_events_fbtrace_id_check CHECK (((fbtrace_id IS NULL) OR (char_length(fbtrace_id) <= 100))),
  CONSTRAINT meta_capi_events_params_check CHECK ((jsonb_typeof(params) = 'object'::text)),
  CONSTRAINT meta_capi_events_skip_reason_check CHECK (((skip_reason IS NULL) OR (skip_reason ~ '^[a-z_]{1,40}$'::text))),
  CONSTRAINT meta_capi_events_source_type_check CHECK ((source_type = ANY (ARRAY['form'::text, 'booking'::text, 'payment'::text, 'contact'::text]))),
  CONSTRAINT meta_capi_events_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'skipped'::text]))),
  CONSTRAINT meta_capi_events_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES public.flows(id) ON DELETE SET NULL,
  CONSTRAINT meta_capi_events_flow_session_id_fkey FOREIGN KEY (flow_session_id) REFERENCES public.flow_sessions(id) ON DELETE SET NULL,
  CONSTRAINT meta_capi_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.meta_capi_events ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.meta_capi_events IS 'Cada evento de la API de Conversiones de Meta (00328). Un evento se manda una sola vez (índice único por workspace, evento y código). Sin contact_id ni datos de la persona a propósito.';
REVOKE ALL ON TABLE public.meta_capi_events FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.meta_capi_events FROM authenticated;

CREATE TABLE IF NOT EXISTS public.meta_capi_request_context (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  client_ip text,
  user_agent text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT meta_capi_request_context_pkey PRIMARY KEY (id),
  CONSTRAINT meta_capi_request_context_client_ip_check CHECK (((client_ip IS NULL) OR (char_length(client_ip) <= 64))),
  CONSTRAINT meta_capi_request_context_source_type_check CHECK ((source_type = ANY (ARRAY['form'::text, 'booking'::text]))),
  CONSTRAINT meta_capi_request_context_user_agent_check CHECK (((user_agent IS NULL) OR (char_length(user_agent) <= 500))),
  CONSTRAINT meta_capi_request_context_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.meta_capi_request_context ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.meta_capi_request_context IS 'La IP y el navegador de quien respondió un formulario o agendó, para la API de Conversiones de Meta (00328). Solo service_role; se borra a los 8 días.';
REVOKE ALL ON TABLE public.meta_capi_request_context FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.meta_match_rules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  campaign_key text DEFAULT ''::text NOT NULL,
  content_key text DEFAULT ''::text NOT NULL,
  term_key text DEFAULT ''::text NOT NULL,
  utm_campaign text,
  utm_content text,
  utm_term text,
  action text NOT NULL,
  ad_id text,
  adset_id text,
  campaign_id text,
  origin text DEFAULT 'manual'::text NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT meta_match_rules_pkey PRIMARY KEY (id),
  CONSTRAINT meta_match_rules_action_check CHECK ((action = ANY (ARRAY['link'::text, 'ignore'::text]))),
  CONSTRAINT meta_match_rules_keys_check CHECK (((campaign_key <> ''::text) OR (content_key <> ''::text) OR (term_key <> ''::text))),
  CONSTRAINT meta_match_rules_origin_check CHECK ((origin = ANY (ARRAY['manual'::text, 'confirmed'::text, 'ai'::text]))),
  CONSTRAINT meta_match_rules_target_check CHECK ((((action = 'ignore'::text) AND (ad_id IS NULL) AND (adset_id IS NULL) AND (campaign_id IS NULL)) OR ((action = 'link'::text) AND (COALESCE(ad_id, adset_id, campaign_id) IS NOT NULL)))),
  CONSTRAINT meta_match_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT meta_match_rules_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.meta_match_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.meta_match_rules FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.meta_match_rules FROM authenticated;

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
COMMENT ON TABLE public.social_account_metrics_daily IS 'Seguidores y alcance de una cuenta, por dia. Es la base del grafico de crecimiento y del salto de seguidores por post (F52).';
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.social_account_metrics_daily FROM anon, authenticated;

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
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.social_post_metrics_daily FROM anon, authenticated;

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

CREATE OR REPLACE FUNCTION private.meta_is_numeric(p_value text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT coalesce(btrim(p_value) ~ '^[0-9]+$', false)
$function$;
REVOKE ALL ON FUNCTION private.meta_is_numeric(p_value text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.meta_medium_is_organic(p_medium text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT coalesce(lower(btrim(p_medium)) IN ('social', 'organic', 'organic_social', 'bio', 'link_in_bio', 'referral', 'email',
                                             'newsletter', 'dm', 'dm_link', 'story', 'story_reply', 'story_mention', 'comment',
                                             'whatsapp', 'whatsapp_group', 'sms'), false)
$function$;
REVOKE ALL ON FUNCTION private.meta_medium_is_organic(p_medium text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.meta_medium_is_paid(p_medium text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT coalesce(lower(btrim(p_medium)) IN ('paid', 'paid_social', 'paidsocial', 'paid-social', 'cpc', 'ppc', 'cpm', 'display', 'paid_search', 'ads', 'ad'), false)
$function$;
REVOKE ALL ON FUNCTION private.meta_medium_is_paid(p_medium text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.meta_name_tokens(p_raw text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT coalesce(array_agg(DISTINCT w ORDER BY w), ARRAY[]::text[])
    FROM unnest(regexp_split_to_array(coalesce(public.meta_name_key(p_raw), ''), '[^a-z0-9]+')) AS w
   WHERE w <> ''
     AND w <> ALL (ARRAY['ad', 'ads', 'anuncio', 'anuncios', 'campana', 'campanas', 'campaign', 'conjunto', 'adset',
                         'copia', 'copy', 'el', 'la', 'los', 'las', 'de', 'del', 'y', 'e', 'en', 'un', 'una', 'a', 'al',
                         'con', 'por', 'para', 'the', 'of', 'and'])
$function$;
REVOKE ALL ON FUNCTION private.meta_name_tokens(p_raw text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.meta_rematch_by_keys(p_workspace_id uuid, p_campaign_key text, p_content_key text, p_term_key text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  t          public.contact_touches%ROWTYPE;
  r          jsonb;
  v_changed  int := 0;
  v_contacts uuid[] := ARRAY[]::uuid[];
BEGIN
  FOR t IN
    SELECT ct.* FROM public.contact_touches ct
     WHERE ct.workspace_id = p_workspace_id
       AND ct.meta_match_status IN ('none', 'unmatched', 'matched', 'ignored')
       AND NOT (ct.meta_match_status = 'ignored' AND ct.meta_match_by IS NOT NULL)
       AND private.meta_touch_utm_counts(ct)
       AND private.meta_rule_key(ct.campaign) = p_campaign_key
       AND private.meta_rule_key(ct.content_label) = p_content_key
       AND private.meta_rule_key(ct.term) = p_term_key
     FOR UPDATE
  LOOP
    r := public.resolve_meta_match_for_touch(t);
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
             meta_matched_at = CASE WHEN r->>'status' IN ('matched', 'ignored') THEN now() END
       WHERE id = t.id;
      v_changed := v_changed + 1;
      v_contacts := array_append(v_contacts, t.contact_id);
    END IF;
  END LOOP;

  PERFORM private.refresh_contact_attribution(c) FROM (SELECT DISTINCT unnest(v_contacts) AS c) x;
  RETURN v_changed;
END;
$function$;
REVOKE ALL ON FUNCTION private.meta_rematch_by_keys(p_workspace_id uuid, p_campaign_key text, p_content_key text, p_term_key text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.meta_rule_key(p_raw text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT coalesce(public.meta_name_key(nullif(btrim(private.meta_url_decode(p_raw)), '')), '')
$function$;
REVOKE ALL ON FUNCTION private.meta_rule_key(p_raw text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.meta_source_counts(p_source text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT coalesce(nullif(btrim(lower(p_source)), ''), 'web') IN ('meta', 'facebook', 'fb', 'instagram', 'ig', 'msg', 'an', 'web')
$function$;
REVOKE ALL ON FUNCTION private.meta_source_counts(p_source text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.meta_tokens_qualify(p_tokens text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT coalesce(cardinality(p_tokens), 0) >= 2
      OR EXISTS (SELECT 1 FROM unnest(coalesce(p_tokens, ARRAY[]::text[])) w WHERE w ~ '[a-z]' AND w ~ '[0-9]')
$function$;
REVOKE ALL ON FUNCTION private.meta_tokens_qualify(p_tokens text[]) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.meta_touch_medium(t public.contact_touches)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT coalesce(
    nullif(lower(btrim(coalesce(t.raw->'utm'->>'utm_medium', t.raw->>'utm_medium'))), ''),
    nullif(lower(btrim(t.medium)), '')
  )
$function$;
REVOKE ALL ON FUNCTION private.meta_touch_medium(t public.contact_touches) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.meta_touch_utm_counts(t public.contact_touches)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT nullif(btrim(t.ad_id), '') IS NOT NULL
      OR nullif(btrim(t.adset_id), '') IS NOT NULL
      OR nullif(btrim(t.campaign_id), '') IS NOT NULL
      OR (
        t.origin IN ('booking', 'form', 'webhook', 'import', 'manual')
        AND NOT private.meta_medium_is_organic(private.meta_touch_medium(t))
        AND (
          private.meta_is_numeric(t.campaign)
          OR private.meta_is_numeric(t.content_label)
          OR private.meta_is_numeric(t.term)
          OR coalesce(lower(btrim(t.source)), '') IN ('meta', 'facebook', 'meta_ads', 'facebook_ads', 'fb_ads')
          OR (private.meta_medium_is_paid(private.meta_touch_medium(t)) AND private.meta_source_counts(t.source))
        )
      )
$function$;
REVOKE ALL ON FUNCTION private.meta_touch_utm_counts(t public.contact_touches) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.meta_touch_utm_id(t public.contact_touches)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT nullif(btrim(coalesce(t.raw->>'utm_id', t.raw->'utm'->>'utm_id')), '')
$function$;
REVOKE ALL ON FUNCTION private.meta_touch_utm_id(t public.contact_touches) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.meta_touch_has_data(t public.contact_touches)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT nullif(btrim(t.ad_id), '') IS NOT NULL
      OR nullif(btrim(t.adset_id), '') IS NOT NULL
      OR nullif(btrim(t.campaign_id), '') IS NOT NULL
      OR (
        private.meta_touch_utm_counts(t)
        AND (nullif(btrim(t.campaign), '') IS NOT NULL
             OR nullif(btrim(t.content_label), '') IS NOT NULL
             OR nullif(btrim(t.term), '') IS NOT NULL
             OR (private.meta_source_counts(t.source) AND private.meta_is_numeric(private.meta_touch_utm_id(t))))
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

CREATE OR REPLACE FUNCTION private.touch_effective_medium(p_medium text, p_raw jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN coalesce(nullif(lower(btrim(p_medium)), ''), 'form') IN ('form', 'booking', 'webhook', 'import', 'manual')
      THEN coalesce(nullif(lower(btrim(coalesce(p_raw->'utm'->>'utm_medium', p_raw->>'utm_medium'))), ''), p_medium)
    ELSE p_medium
  END
$function$;
REVOKE ALL ON FUNCTION private.touch_effective_medium(p_medium text, p_raw jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.ads_crm_cell_detail(p_level text, p_metric text, p_since date, p_until date, p_ad_account_id text DEFAULT NULL::text, p_workspace_id uuid DEFAULT NULL::uuid, p_object_id text DEFAULT NULL::text, p_object_ids text[] DEFAULT NULL::text[], p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(item_id uuid, contact_id uuid, contact_name text, occurred_at timestamp with time zone, origin text, detail_at timestamp with time zone, amount_cents bigint, total_count bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
BEGIN
  IF p_metric NOT IN ('leads_new', 'leads_total', 'bookings', 'sales') THEN
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
  v_col        text;
  v_cat_table  text;
  v_cat_col    text;
  v_tz         text;
  v_lo         timestamptz;
  v_hi         timestamptz;
  v_acct       text;
  v_filter     text;
  v_sale_touch text;
  v_sql        text;
BEGIN
  v_col := CASE p_level
    WHEN 'campaign' THEN 'meta_campaign_id'
    WHEN 'adset'    THEN 'meta_adset_id'
    WHEN 'ad'       THEN 'meta_ad_id'
  END;
  IF v_col IS NULL THEN
    RAISE EXCEPTION 'ads_crm_items: nivel invalido (%)', p_level USING ERRCODE = '22023';
  END IF;
  IF p_metric NOT IN ('leads_new', 'leads_total', 'bookings', 'sales', 'uf_cash', 'cash') THEN
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

  -- A qué objeto cuenta cada venta. Una sola definición para ventas, UF cash y cash:
  -- su toque guardado si tiene objeto; si no, y la venta no es manual, el último toque con objeto anterior a la venta.
  v_sale_touch := format($q$
    SELECT s.id, s.contact_id, s.sale_date, s.status, s.final_amount,
           coalesce(own.obj, prev.obj) AS obj,
           CASE WHEN own.obj IS NOT NULL THEN own.occurred_at ELSE prev.occurred_at END AS touch_at,
           CASE WHEN own.obj IS NOT NULL THEN own.origin ELSE prev.origin END AS origin
      FROM public.sales s
      LEFT JOIN LATERAL (
        SELECT t.%1$I AS obj, t.occurred_at, t.origin
          FROM public.contact_touches t
         WHERE t.id = s.attribution_touch_id AND t.%1$I IS NOT NULL
      ) own ON true
      LEFT JOIN LATERAL (
        SELECT t.%1$I AS obj, t.occurred_at, t.origin
          FROM public.contact_touches t
         WHERE own.obj IS NULL
           AND s.attribution_type <> 'manual'
           AND t.workspace_id = $1 AND t.contact_id = s.contact_id AND t.%1$I IS NOT NULL
           AND t.occurred_at <= s.created_at
           AND t.occurred_at < ((s.sale_date + 1)::timestamp AT TIME ZONE $10)
         ORDER BY t.occurred_at DESC, t.created_at DESC, t.id DESC
         LIMIT 1
      ) prev ON true
     WHERE s.workspace_id = $1
  $q$, v_col);

  -- La columna del nivel sale de una lista fija (nunca del pedido): %1$I la cita como identificador, %2$L como texto.
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

  ELSIF p_metric = 'bookings' THEN
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

  ELSIF p_metric = 'sales' THEN
    v_sql := v_acct || format($q$
      SELECT x.obj, x.contact_id, x.id, x.touch_at, x.origin, (x.sale_date::timestamp AT TIME ZONE 'UTC'), x.amount_cents
        FROM (
          SELECT st.id, st.contact_id, st.sale_date, round(st.final_amount * 100)::bigint AS amount_cents,
                 st.obj, st.touch_at, st.origin
            FROM (%1$s) st
           WHERE st.sale_date >= $4 AND st.sale_date <= $5
             AND st.status NOT IN ('cancelled', 'refunded')
             AND st.obj IS NOT NULL
        ) x
       WHERE %2$s
    $q$, v_sale_touch, v_filter);

  ELSIF p_metric = 'uf_cash' THEN
    v_sql := v_acct || format($q$
      SELECT x.obj, x.contact_id, x.payment_id, x.touch_at, x.origin, x.paid_at, x.amount_cents
        FROM (
          SELECT fp.id AS payment_id, st.contact_id,
                 st.obj, st.touch_at, st.origin,
                 coalesce(fp.paid_at, (fp.paid_on::timestamp AT TIME ZONE 'UTC')) AS paid_at,
                 round(fp.amount * 100)::bigint AS amount_cents
            FROM (
              SELECT DISTINCT ON (p.sale_id) p.id, p.sale_id, p.amount, p.paid_on, p.paid_at
                FROM public.payments p
               WHERE p.workspace_id = $1 AND p.status = 'paid' AND p.amount > 0
               ORDER BY p.sale_id, coalesce(p.paid_at, (p.paid_on::timestamp AT TIME ZONE 'UTC')) ASC, p.id ASC
            ) fp
            JOIN (%1$s) st ON st.id = fp.sale_id
           WHERE fp.paid_on >= $4 AND fp.paid_on <= $5 AND st.obj IS NOT NULL
        ) x
       WHERE %2$s
    $q$, v_sale_touch, v_filter);

  ELSE -- cash: todo lo cobrado en el rango, menos los reembolsos (filas negativas), de cualquier venta del objeto
    v_sql := v_acct || format($q$
      SELECT x.obj, x.contact_id, x.payment_id, x.touch_at, x.origin, x.paid_at, x.amount_cents
        FROM (
          SELECT p.id AS payment_id, st.contact_id,
                 st.obj, st.touch_at, st.origin,
                 coalesce(p.paid_at, (p.paid_on::timestamp AT TIME ZONE 'UTC')) AS paid_at,
                 round(p.amount * 100)::bigint AS amount_cents
            FROM public.payments p
            JOIN (%1$s) st ON st.id = p.sale_id
           WHERE p.workspace_id = $1 AND p.status = 'paid'
             AND p.paid_on >= $4 AND p.paid_on <= $5
             AND st.obj IS NOT NULL
        ) x
       WHERE %2$s
    $q$, v_sale_touch, v_filter);
  END IF;

  RETURN QUERY EXECUTE v_sql USING p_workspace_id, v_lo, v_hi, p_since, p_until, p_ad_account_id, p_level, p_object_id, p_object_ids, v_tz;
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
    sale_items AS (SELECT * FROM public.ads_crm_items($7, 'sales',    $4, $5, $1, $6, NULL, $8)),
    uf_items   AS (SELECT * FROM public.ads_crm_items($7, 'uf_cash',  $4, $5, $1, $6, NULL, $8)),
    cash_items AS (SELECT * FROM public.ads_crm_items($7, 'cash',     $4, $5, $1, $6, NULL, $8)),
    new_agg  AS (SELECT obj, count(*)::int AS n FROM new_items GROUP BY obj),
    tot_agg  AS (SELECT obj, count(*)::int AS n FROM tot_items GROUP BY obj),
    bk_agg   AS (
      SELECT obj, count(*)::int AS bookings,
             (count(*) FILTER (WHERE status_group = 'outcome'))::int AS attended,
             count(DISTINCT contact_id)::int AS leads
        FROM bk_items GROUP BY obj
    ),
    sale_agg AS (SELECT obj, count(*)::int AS sales, coalesce(sum(amount_cents), 0)::bigint AS revenue FROM sale_items GROUP BY obj),
    uf_agg   AS (SELECT obj, coalesce(sum(amount_cents), 0)::bigint AS uf FROM uf_items GROUP BY obj),
    cash_agg AS (SELECT obj, coalesce(sum(amount_cents), 0)::bigint AS cash FROM cash_items GROUP BY obj),
    objs AS (
      SELECT obj FROM new_agg UNION SELECT obj FROM tot_agg UNION SELECT obj FROM bk_agg
      UNION SELECT obj FROM sale_agg UNION SELECT obj FROM uf_agg UNION SELECT obj FROM cash_agg
    )
    SELECT o.obj, false,
           coalesce(n.n, 0), coalesce(tl.n, 0), coalesce(ba.leads, 0),
           coalesce(ba.bookings, 0), coalesce(ba.attended, 0),
           coalesce(sa.sales, 0), coalesce(sa.revenue, 0)::bigint, coalesce(ca.cash, 0)::bigint, coalesce(ua.uf, 0)::bigint
      FROM objs o
      LEFT JOIN new_agg n ON n.obj = o.obj
      LEFT JOIN tot_agg tl ON tl.obj = o.obj
      LEFT JOIN bk_agg ba ON ba.obj = o.obj
      LEFT JOIN sale_agg sa ON sa.obj = o.obj
      LEFT JOIN uf_agg ua ON ua.obj = o.obj
      LEFT JOIN cash_agg ca ON ca.obj = o.obj
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

CREATE OR REPLACE FUNCTION public.booking_last_touches(p_workspace_id uuid, p_booking_ids uuid[], p_limit integer DEFAULT 3)
 RETURNS TABLE(booking_id uuid, touch_rank integer, touch_id uuid, occurred_at timestamp with time zone, source text, medium text, campaign text, content_label text, term text, origin text, channel text, social_post_id uuid, content_post_id uuid, ad_id text, adset_id text, campaign_id text, meta_campaign_id text, meta_adset_id text, meta_ad_id text, meta_match_status text, entry_url text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT
    b.id,
    (row_number() OVER (PARTITION BY b.id ORDER BY t.occurred_at DESC, t.created_at DESC, t.id DESC))::integer,
    t.id, t.occurred_at, t.source, t.medium, t.campaign, t.content_label, t.term, t.origin, t.channel,
    t.social_post_id, t.content_post_id, t.ad_id, t.adset_id, t.campaign_id,
    t.meta_campaign_id, t.meta_adset_id, t.meta_ad_id, t.meta_match_status, t.entry_url
  FROM public.bookings b
  CROSS JOIN LATERAL (
    SELECT ct.*
    FROM public.contact_touches ct
    WHERE ct.workspace_id = b.workspace_id
      AND ct.contact_id = b.contact_id
      AND ct.occurred_at <= b.created_at
      AND NOT (
        ct.origin = 'booking' AND ct.source = 'web'
        AND ct.campaign IS NULL AND ct.content_label IS NULL AND ct.term IS NULL
        AND ct.ad_id IS NULL AND ct.adset_id IS NULL AND ct.campaign_id IS NULL
        AND ct.fbclid IS NULL AND ct.gclid IS NULL AND ct.ttclid IS NULL AND ct.li_fat_id IS NULL
      )
    ORDER BY ct.occurred_at DESC, ct.created_at DESC, ct.id DESC
    LIMIT greatest(1, least(coalesce(p_limit, 3), 10))
  ) t
  WHERE b.workspace_id = p_workspace_id
    AND b.id = ANY (p_booking_ids)
  ORDER BY b.id, 2;
$function$;
REVOKE ALL ON FUNCTION public.booking_last_touches(p_workspace_id uuid, p_booking_ids uuid[], p_limit integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contact_last_activity(p_workspace_id uuid, p_contact_ids uuid[])
 RETURNS TABLE(contact_id uuid, activity_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT c.id,
         coalesce(greatest(c.last_interaction_at, t.last_touch), c.created_at)
    FROM public.contacts c
    LEFT JOIN LATERAL (
      SELECT max(ct.occurred_at) AS last_touch
        FROM public.contact_touches ct
       WHERE ct.workspace_id = p_workspace_id AND ct.contact_id = c.id
    ) t ON true
   WHERE c.workspace_id = p_workspace_id
     AND c.id = ANY (p_contact_ids);
$function$;
REVOKE ALL ON FUNCTION public.contact_last_activity(p_workspace_id uuid, p_contact_ids uuid[]) FROM PUBLIC, anon, authenticated;

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
  v_medium text;
BEGIN
  BEGIN
    v_medium := private.touch_effective_medium(NEW.medium, NEW.raw);
    IF TG_OP = 'INSERT' THEN
      IF v_channel IS NULL THEN
        v_channel := public.touch_channel(NEW.origin, v_medium, NEW.source, NEW.ad_id, NEW.adset_id, NEW.campaign_id, NEW.meta_ad_id, NEW.meta_campaign_id,
                                          NEW.gclid, NEW.ttclid, NEW.li_fat_id, NEW.ctwa_clid, NEW.fbclid, NEW.social_post_id, NEW.content_post_id);
      END IF;
    ELSIF NEW.channel IS NOT DISTINCT FROM OLD.channel THEN
      v_channel := public.touch_channel(NEW.origin, v_medium, NEW.source, NEW.ad_id, NEW.adset_id, NEW.campaign_id, NEW.meta_ad_id, NEW.meta_campaign_id,
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

CREATE OR REPLACE FUNCTION public.create_meta_match_rule(p_workspace_id uuid, p_user_id uuid, p_utm_campaign text, p_utm_content text, p_utm_term text, p_action text, p_ad_id text DEFAULT NULL::text, p_adset_id text DEFAULT NULL::text, p_campaign_id text DEFAULT NULL::text, p_origin text DEFAULT 'manual'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ckey     text := private.meta_rule_key(p_utm_campaign);
  v_kkey     text := private.meta_rule_key(p_utm_content);
  v_tkey     text := private.meta_rule_key(p_utm_term);
  v_ad       text := nullif(btrim(p_ad_id), '');
  v_adset    text := nullif(btrim(p_adset_id), '');
  v_campaign text := nullif(btrim(p_campaign_id), '');
  a_adset    text;
  a_campaign text;
  s_campaign text;
  v_id       uuid;
  v_applied  int;
BEGIN
  IF p_action NOT IN ('link', 'ignore') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_action');
  END IF;
  IF coalesce(p_origin, '') NOT IN ('manual', 'confirmed', 'ai') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_origin');
  END IF;
  IF v_ckey = '' AND v_kkey = '' AND v_tkey = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_keys');
  END IF;

  IF p_action = 'link' THEN
    IF v_ad IS NOT NULL THEN
      SELECT a.adset_id, a.campaign_id INTO a_adset, a_campaign FROM public.meta_ads a
       WHERE a.workspace_id = p_workspace_id AND a.ad_id = v_ad LIMIT 1;
      IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_in_catalog'); END IF;
      v_adset := a_adset;
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
  ELSE
    v_ad := NULL; v_adset := NULL; v_campaign := NULL;
  END IF;

  INSERT INTO public.meta_match_rules AS mr
    (workspace_id, campaign_key, content_key, term_key, utm_campaign, utm_content, utm_term,
     action, ad_id, adset_id, campaign_id, origin, created_by)
  VALUES
    (p_workspace_id, v_ckey, v_kkey, v_tkey,
     nullif(btrim(private.meta_url_decode(p_utm_campaign)), ''),
     nullif(btrim(private.meta_url_decode(p_utm_content)), ''),
     nullif(btrim(private.meta_url_decode(p_utm_term)), ''),
     p_action, v_ad, v_adset, v_campaign, p_origin, p_user_id)
  ON CONFLICT (workspace_id, campaign_key, content_key, term_key) DO UPDATE
    SET action = EXCLUDED.action, ad_id = EXCLUDED.ad_id, adset_id = EXCLUDED.adset_id, campaign_id = EXCLUDED.campaign_id,
        origin = EXCLUDED.origin, created_by = EXCLUDED.created_by, updated_at = now()
  RETURNING mr.id INTO v_id;

  v_applied := private.meta_rematch_by_keys(p_workspace_id, v_ckey, v_kkey, v_tkey);

  RETURN jsonb_build_object('ok', true, 'rule_id', v_id, 'applied', v_applied,
                            'ad_id', v_ad, 'adset_id', v_adset, 'campaign_id', v_campaign);
END;
$function$;
REVOKE ALL ON FUNCTION public.create_meta_match_rule(p_workspace_id uuid, p_user_id uuid, p_utm_campaign text, p_utm_content text, p_utm_term text, p_action text, p_ad_id text, p_adset_id text, p_campaign_id text, p_origin text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_meta_match_rule(p_workspace_id uuid, p_rule_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_rule    public.meta_match_rules%ROWTYPE;
  v_changed int;
BEGIN
  DELETE FROM public.meta_match_rules WHERE id = p_rule_id AND workspace_id = p_workspace_id RETURNING * INTO v_rule;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rule_not_found');
  END IF;
  v_changed := private.meta_rematch_by_keys(p_workspace_id, v_rule.campaign_key, v_rule.content_key, v_rule.term_key);
  RETURN jsonb_build_object('ok', true, 'reverted', v_changed, 'rule', to_jsonb(v_rule));
END;
$function$;
REVOKE ALL ON FUNCTION public.delete_meta_match_rule(p_workspace_id uuid, p_rule_id uuid) FROM PUBLIC, anon, authenticated;

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
    -- La URL de entrada completa (plano formularios-ui, F18). Un formulario la manda como `entry_url`; la Agenda,
    -- dentro de `raw.utm` (create_booking pasa `p_utm` entero ahi), asi que `create_booking` NO se toca.
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
               AND (nullif(btrim(ct.ad_id), '') IS NOT NULL
                    OR nullif(btrim(ct.content_label), '') IS NOT NULL
                    OR ct.meta_adset_id IS NOT NULL))
         )
         AND private.meta_touch_has_data(ct)
       ORDER BY ct.occurred_at, ct.id
       LIMIT 500
    LOOP
      v_batch := v_batch + 1;
      v_last_at := t.occurred_at;
      v_last_id := t.id;

      r := public.resolve_meta_match_for_touch(t);

      -- Lo ya vinculado no empeora: la regla nueva no le saca un conjunto o una campaña a quien ya los tenia.
      CONTINUE WHEN t.meta_match_status = 'matched' AND (
        (r->>'status') IS DISTINCT FROM 'matched'
        OR (t.meta_adset_id IS NOT NULL AND (r->>'adset_id') IS NULL)
        OR (t.meta_campaign_id IS NOT NULL AND (r->>'campaign_id') IS NULL)
      );

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

  r_ad           text;
  r_ad_adset     text;
  r_ad_campaign  text;
  r_adset        text;
  r_adset_camp   text;
  r_campaign     text;
  m_ad           text;
  m_adset        text;
  m_campaign     text;

  h_direct       text;
  h_named        text;
  m_named        text;
  v_scope        text[];
  v_name_key     text;
  v_tokens       text[];
  v_n            int;
  v_rule         public.meta_match_rules%ROWTYPE;

  ambiguous_ad       boolean := false;
  ambiguous_campaign boolean := false;
  v_notes        text[] := ARRAY[]::text[];
  v_status       text;
  v_method       text;
  v_reason       text;
BEGIN
  IF v_ad_id IS NULL AND v_adset_id IS NULL AND v_campaign_id IS NULL
     AND v_utm_campaign IS NULL AND v_utm_content IS NULL AND v_utm_term IS NULL AND v_fbclid IS NULL THEN
    RETURN jsonb_build_object('status', 'none', 'ad_id', NULL, 'adset_id', NULL, 'campaign_id', NULL, 'method', NULL, 'reason', NULL);
  END IF;

  -- ---- 1. Por id ----
  IF v_campaign_id IS NOT NULL THEN
    SELECT c.campaign_id INTO h_direct FROM public.meta_campaigns c
     WHERE c.workspace_id = p_workspace_id AND c.campaign_id = v_campaign_id LIMIT 1;
  END IF;
  IF h_direct IS NULL AND v_utm_campaign IS NOT NULL THEN
    SELECT c.campaign_id INTO h_direct FROM public.meta_campaigns c
     WHERE c.workspace_id = p_workspace_id AND c.campaign_id = v_utm_campaign LIMIT 1;
  END IF;

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

  -- ---- 2. Una regla (lo que decidio una persona para estos mismos UTMs) ----
  IF r_ad IS NULL AND (v_utm_campaign IS NOT NULL OR v_utm_content IS NOT NULL OR v_utm_term IS NOT NULL) THEN
    SELECT * INTO v_rule FROM public.meta_match_rules mr
     WHERE mr.workspace_id = p_workspace_id
       AND mr.campaign_key = coalesce(public.meta_name_key(v_utm_campaign), '')
       AND mr.content_key = coalesce(public.meta_name_key(v_utm_content), '')
       AND mr.term_key = coalesce(public.meta_name_key(v_utm_term), '')
     LIMIT 1;
    IF FOUND THEN
      IF v_rule.action = 'ignore' THEN
        -- «No es un anuncio» solo vale si ningun id dijo lo contrario.
        IF r_adset IS NULL AND h_direct IS NULL THEN
          RETURN jsonb_build_object('status', 'ignored', 'ad_id', NULL, 'adset_id', NULL, 'campaign_id', NULL, 'method', 'rule', 'reason', NULL);
        END IF;
      -- Una regla nunca contradice un conjunto o una campaña que vinieron por id.
      ELSIF (r_adset IS NULL OR v_rule.adset_id IS NULL OR v_rule.adset_id = r_adset)
        AND (h_direct IS NULL OR v_rule.campaign_id IS NULL OR v_rule.campaign_id = h_direct) THEN
        IF v_rule.ad_id IS NOT NULL THEN
          r_ad := v_rule.ad_id;
          r_ad_adset := v_rule.adset_id;
          r_ad_campaign := v_rule.campaign_id;
          m_ad := 'rule';
        ELSIF v_rule.adset_id IS NOT NULL AND r_adset IS NULL THEN
          r_adset := v_rule.adset_id;
          r_adset_camp := v_rule.campaign_id;
          m_adset := 'rule';
        ELSIF v_rule.campaign_id IS NOT NULL AND h_direct IS NULL THEN
          h_named := v_rule.campaign_id;
          m_named := 'rule';
        END IF;
      END IF;
    END IF;
  END IF;

  -- ---- 3. Anuncio por nombre exacto, adentro de lo que se conoce por id ----
  IF r_ad IS NULL AND v_utm_content IS NOT NULL AND (r_adset IS NOT NULL OR h_direct IS NOT NULL) THEN
    v_name_key := public.meta_name_key(v_utm_content);
    IF v_name_key <> '' THEN
      SELECT count(*) INTO v_n FROM public.meta_ads a
       WHERE a.workspace_id = p_workspace_id AND a.name_key = v_name_key
         AND (CASE WHEN r_adset IS NOT NULL THEN a.adset_id = r_adset ELSE a.campaign_id = h_direct END);
      IF v_n = 1 THEN
        SELECT a.ad_id, a.adset_id, a.campaign_id INTO r_ad, r_ad_adset, r_ad_campaign FROM public.meta_ads a
         WHERE a.workspace_id = p_workspace_id AND a.name_key = v_name_key
           AND (CASE WHEN r_adset IS NOT NULL THEN a.adset_id = r_adset ELSE a.campaign_id = h_direct END)
         LIMIT 1;
        m_ad := CASE WHEN r_adset IS NOT NULL THEN 'utm_content_name_adset' ELSE 'utm_content_name_campaign' END;
      ELSIF v_n > 1 THEN
        ambiguous_ad := true;
      END IF;
    END IF;
  END IF;

  -- ---- 4. Sin ningun id: la campaña por su nombre (unico) o, si no, por parecido ----
  IF r_ad IS NULL AND r_adset IS NULL AND h_direct IS NULL AND h_named IS NULL
     AND v_utm_campaign IS NOT NULL AND NOT private.meta_is_numeric(v_utm_campaign) THEN
    v_name_key := public.meta_name_key(v_utm_campaign);
    IF v_name_key <> '' THEN
      SELECT count(*), min(c.campaign_id) INTO v_n, h_named FROM public.meta_campaigns c
       WHERE c.workspace_id = p_workspace_id AND c.name_key = v_name_key;
      IF v_n = 1 THEN
        m_named := 'utm_campaign_name';
      ELSE
        h_named := NULL;
        IF v_n > 1 THEN ambiguous_campaign := true; END IF;
      END IF;
    END IF;
    IF h_named IS NULL THEN
      v_tokens := private.meta_name_tokens(v_utm_campaign);
      IF cardinality(v_tokens) > 0 THEN
        SELECT coalesce(array_agg(c.campaign_id ORDER BY c.campaign_id), ARRAY[]::text[]) INTO v_scope
          FROM public.meta_campaigns c
         WHERE c.workspace_id = p_workspace_id AND private.meta_name_tokens(c.name_key) @> v_tokens;
        IF cardinality(v_scope) = 1 THEN
          h_named := v_scope[1];
          m_named := 'utm_campaign_similar';
        ELSIF cardinality(v_scope) > 1 THEN
          ambiguous_campaign := true;
        END IF;
      END IF;
    END IF;
  END IF;

  -- ---- 5. Anuncio por nombre exacto dentro de la campaña hallada por su nombre ----
  IF r_ad IS NULL AND v_ad_id IS NULL AND m_named = 'utm_campaign_name' AND v_utm_content IS NOT NULL THEN
    v_name_key := public.meta_name_key(v_utm_content);
    IF v_name_key <> '' THEN
      SELECT count(*) INTO v_n FROM public.meta_ads a
       WHERE a.workspace_id = p_workspace_id AND a.campaign_id = h_named AND a.name_key = v_name_key;
      IF v_n = 1 THEN
        SELECT a.ad_id, a.adset_id, a.campaign_id INTO r_ad, r_ad_adset, r_ad_campaign FROM public.meta_ads a
         WHERE a.workspace_id = p_workspace_id AND a.campaign_id = h_named AND a.name_key = v_name_key LIMIT 1;
        m_ad := 'utm_content_name';
      ELSIF v_n > 1 THEN
        ambiguous_ad := true;
      END IF;
    END IF;
  END IF;

  -- ---- 6. Anuncio por parecido: el UNICO del alcance cuyas palabras contienen todas las del utm_content ----
  IF r_ad IS NULL AND v_ad_id IS NULL AND NOT ambiguous_ad AND v_utm_content IS NOT NULL
     AND NOT private.meta_is_numeric(v_utm_content) THEN
    v_tokens := private.meta_name_tokens(v_utm_content);
    v_n := 0;
    IF private.meta_tokens_qualify(v_tokens) THEN
      IF r_adset IS NOT NULL THEN
        SELECT count(*) INTO v_n FROM public.meta_ads a
         WHERE a.workspace_id = p_workspace_id AND a.adset_id = r_adset AND private.meta_name_tokens(a.name_key) @> v_tokens;
        IF v_n = 1 THEN
          SELECT a.ad_id, a.adset_id, a.campaign_id INTO r_ad, r_ad_adset, r_ad_campaign FROM public.meta_ads a
           WHERE a.workspace_id = p_workspace_id AND a.adset_id = r_adset AND private.meta_name_tokens(a.name_key) @> v_tokens LIMIT 1;
          m_ad := 'utm_content_similar_adset';
        END IF;
      ELSIF coalesce(h_direct, h_named) IS NOT NULL OR cardinality(v_scope) > 1 THEN
        IF coalesce(h_direct, h_named) IS NOT NULL THEN v_scope := ARRAY[coalesce(h_direct, h_named)]; END IF;
        SELECT count(*) INTO v_n FROM public.meta_ads a
         WHERE a.workspace_id = p_workspace_id AND a.campaign_id = ANY (v_scope) AND private.meta_name_tokens(a.name_key) @> v_tokens;
        IF v_n = 1 THEN
          SELECT a.ad_id, a.adset_id, a.campaign_id INTO r_ad, r_ad_adset, r_ad_campaign FROM public.meta_ads a
           WHERE a.workspace_id = p_workspace_id AND a.campaign_id = ANY (v_scope) AND private.meta_name_tokens(a.name_key) @> v_tokens LIMIT 1;
          m_ad := 'utm_content_similar_campaign';
        END IF;
      END IF;
      IF v_n > 1 THEN ambiguous_ad := true; END IF;
    END IF;
  END IF;

  -- ---- 7. El unico anuncio del conjunto (no si llego un id de anuncio desconocido: seria otro anuncio) ----
  IF r_ad IS NULL AND r_adset IS NOT NULL AND NOT ambiguous_ad AND v_ad_id IS NULL
     AND NOT private.meta_is_numeric(v_utm_content) THEN
    SELECT count(*) INTO v_n FROM public.meta_ads a
     WHERE a.workspace_id = p_workspace_id AND a.adset_id = r_adset;
    IF v_n = 1 THEN
      SELECT a.ad_id, a.adset_id, a.campaign_id INTO r_ad, r_ad_adset, r_ad_campaign FROM public.meta_ads a
       WHERE a.workspace_id = p_workspace_id AND a.adset_id = r_adset LIMIT 1;
      m_ad := 'adset_single_ad';
    END IF;
  END IF;

  -- ---- El conjunto del anuncio ----
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
    IF r_ad IS NOT NULL AND r_ad_campaign IS NOT NULL AND r_ad_campaign <> r_campaign THEN
      r_campaign := r_ad_campaign;
      m_campaign := m_ad;
      v_notes := array_append(v_notes, 'inconsistent_campaign');
    END IF;
  ELSIF r_ad_campaign IS NOT NULL OR r_adset_camp IS NOT NULL THEN
    r_campaign := coalesce(r_ad_campaign, r_adset_camp);
    m_campaign := CASE WHEN r_ad_campaign IS NOT NULL THEN m_ad ELSE m_adset END;
  ELSIF h_named IS NOT NULL THEN
    r_campaign := h_named;
    m_campaign := m_named;
  END IF;

  -- ---- Resultado ----
  IF r_ad IS NOT NULL OR r_adset IS NOT NULL OR r_campaign IS NOT NULL THEN
    v_status := 'matched';
    v_method := coalesce(m_ad, m_adset, m_campaign);
    IF ambiguous_ad THEN v_notes := array_append(v_notes, 'ambiguous_ad_name'); END IF;
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
    ELSIF v_utm_campaign IS NOT NULL AND NOT private.meta_is_numeric(v_utm_campaign) THEN
      v_reason := 'name_not_found';
    ELSIF v_utm_campaign IS NOT NULL OR v_utm_content IS NOT NULL OR v_utm_term IS NOT NULL THEN
      v_reason := 'name_without_id';
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
    t.workspace_id, t.ad_id, t.adset_id,
    coalesce(
      nullif(btrim(t.campaign_id), ''),
      CASE WHEN private.meta_touch_utm_counts(t) AND private.meta_source_counts(t.source)
                AND private.meta_is_numeric(private.meta_touch_utm_id(t))
           THEN private.meta_touch_utm_id(t) END
    ),
    CASE WHEN private.meta_touch_utm_counts(t) THEN t.campaign END,
    CASE WHEN private.meta_touch_utm_counts(t) THEN t.content_label END,
    CASE WHEN private.meta_touch_utm_counts(t) THEN t.term END,
    NULL
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

  -- 2) Referido (lo deja el selector de la venta)
  IF v_medium = 'referral_person' THEN
    RETURN 'referral';
  END IF;

  -- 3) Organico
  IF p_social_post_id IS NOT NULL
     OR p_content_post_id IS NOT NULL
     OR (v_medium IS NOT NULL AND v_medium = ANY (ARRAY['comment', 'story_reply', 'story_mention', 'organic_social', 'social', 'dm_link', 'whatsapp_group']))
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

CREATE INDEX IF NOT EXISTS idx_meta_ads_video ON public.meta_ads USING btree (workspace_id, video_id) WHERE (video_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_meta_ads_ws_ad ON public.meta_ads USING btree (workspace_id, ad_id);

CREATE INDEX IF NOT EXISTS idx_meta_adsets_campaign ON public.meta_adsets USING btree (workspace_id, campaign_id);

CREATE INDEX IF NOT EXISTS idx_meta_adsets_name_key ON public.meta_adsets USING btree (workspace_id, name_key);

CREATE INDEX IF NOT EXISTS idx_meta_adsets_ws_adset ON public.meta_adsets USING btree (workspace_id, adset_id);

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_name_key ON public.meta_campaigns USING btree (workspace_id, name_key);

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_ws_campaign ON public.meta_campaigns USING btree (workspace_id, campaign_id);

CREATE INDEX IF NOT EXISTS idx_meta_capi_events_recent ON public.meta_capi_events USING btree (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_meta_capi_request_context_created ON public.meta_capi_request_context USING btree (created_at);

CREATE INDEX IF NOT EXISTS idx_post_metrics_workspace_date ON public.social_post_metrics_daily USING btree (workspace_id, date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_account_metrics_daily ON public.social_account_metrics_daily USING btree (social_account_id, date);

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_ads ON public.meta_ads USING btree (workspace_id, ad_account_id, ad_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_ads_insights ON public.meta_ads_insights_daily USING btree (workspace_id, level, object_id, date);

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_adsets ON public.meta_adsets USING btree (workspace_id, ad_account_id, adset_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_campaigns ON public.meta_campaigns USING btree (workspace_id, ad_account_id, campaign_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_capi_events_event ON public.meta_capi_events USING btree (workspace_id, event_name, event_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_capi_request_context_source ON public.meta_capi_request_context USING btree (source_type, source_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_match_rules_keys ON public.meta_match_rules USING btree (workspace_id, campaign_key, content_key, term_key);

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
  CREATE POLICY meta_capi_events_select ON public.meta_capi_events FOR SELECT TO public
    USING ((COALESCE(( SELECT public.has_permission(meta_capi_events.workspace_id, 'integrations.view'::text) AS has_permission), false) OR COALESCE(( SELECT public.has_permission(meta_capi_events.workspace_id, 'integrations.manage'::text) AS has_permission), false)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY meta_match_rules_select ON public.meta_match_rules FOR SELECT TO authenticated
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
