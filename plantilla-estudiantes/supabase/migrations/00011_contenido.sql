-- ============================================================================
-- Contenido
--
-- El pipeline de contenido: pilares, ideas, piezas (con su responsable, su variante
-- por red y su historial de versiones), las cuentas sociales conectadas, cada
-- publicacion por red y sus comentarios.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tablas
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.content_pillars (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  color text,
  archived_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT content_pillars_pkey PRIMARY KEY (id),
  CONSTRAINT content_pillars_color_check CHECK (((color IS NULL) OR (color ~ '^#[0-9a-fA-F]{6}$'::text))),
  CONSTRAINT content_pillars_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 60))),
  CONSTRAINT content_pillars_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT content_pillars_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.content_pillars ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.content_pillars IS 'Pilares de contenido del negocio. Se archivan, nunca se borran: lo publicado sigue mostrando el suyo.';

CREATE TABLE IF NOT EXISTS public.content_ideas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  title text NOT NULL,
  format text,
  reference text,
  status text DEFAULT 'nueva'::text NOT NULL,
  source text DEFAULT 'manual'::text NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  created_by uuid,
  approved_by uuid,
  approved_at timestamp with time zone,
  discarded_reason text,
  score numeric,
  target_audience text,
  awareness_level text,
  embedding extensions.vector(1024),
  deleted_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  content text,
  platforms text[] DEFAULT '{}'::text[] NOT NULL,
  offer_id uuid,
  pillar_id uuid,
  funnel_stage text,
  CONSTRAINT content_ideas_pkey PRIMARY KEY (id),
  CONSTRAINT content_ideas_funnel_check CHECK (((funnel_stage IS NULL) OR (funnel_stage = ANY (ARRAY['tofu'::text, 'mofu'::text, 'bofu'::text])))),
  CONSTRAINT content_ideas_platforms_check CHECK ((platforms <@ ARRAY['instagram'::text, 'tiktok'::text, 'youtube'::text, 'linkedin'::text, 'threads'::text])),
  CONSTRAINT content_ideas_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'agent'::text]))),
  CONSTRAINT content_ideas_status_check CHECK ((status = ANY (ARRAY['nueva'::text, 'aprobada'::text, 'descartada'::text]))),
  CONSTRAINT content_ideas_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT content_ideas_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT content_ideas_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.products(id) ON DELETE SET NULL,
  CONSTRAINT content_ideas_pillar_id_fkey FOREIGN KEY (pillar_id) REFERENCES public.content_pillars(id) ON DELETE SET NULL,
  CONSTRAINT content_ideas_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.content_ideas ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.content_ideas IS 'Ideas de contenido. Aprobar una crea un post; una idea puede originar varios.';
COMMENT ON COLUMN public.content_ideas.source IS 'manual: la escribio una persona. agent: la propuso un agente.';
COMMENT ON COLUMN public.content_ideas.content IS 'El texto unico de la idea.';
COMMENT ON COLUMN public.content_ideas.platforms IS 'Redes a las que apunta la idea. Es una intencion: al aprobar se heredan a la pieza.';

CREATE TABLE IF NOT EXISTS public.content_posts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  idea_id uuid,
  title text NOT NULL,
  format text,
  caption text,
  networks jsonb DEFAULT '[]'::jsonb NOT NULL,
  media jsonb DEFAULT '[]'::jsonb NOT NULL,
  copy_source text DEFAULT 'manual'::text NOT NULL,
  ai_unreviewed boolean DEFAULT false NOT NULL,
  status text DEFAULT 'draft'::text NOT NULL,
  current_version integer DEFAULT 0 NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  created_by uuid,
  approved_by uuid,
  approved_at timestamp with time zone,
  review_note text,
  source text DEFAULT 'manual'::text NOT NULL,
  archived_at timestamp with time zone,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  copy_status text DEFAULT 'idle'::text NOT NULL,
  script text,
  recording_notes text,
  offer_id uuid,
  pillar_id uuid,
  funnel_stage text,
  reference text,
  assigned_to uuid,
  attribution_code text NOT NULL,
  CONSTRAINT content_posts_pkey PRIMARY KEY (id),
  CONSTRAINT content_posts_copy_source_check CHECK ((copy_source = ANY (ARRAY['manual'::text, 'ai'::text, 'mixed'::text]))),
  CONSTRAINT content_posts_copy_status_check CHECK ((copy_status = ANY (ARRAY['idle'::text, 'generating'::text, 'failed'::text]))),
  CONSTRAINT content_posts_funnel_check CHECK (((funnel_stage IS NULL) OR (funnel_stage = ANY (ARRAY['tofu'::text, 'mofu'::text, 'bofu'::text])))),
  CONSTRAINT content_posts_media_array CHECK ((jsonb_typeof(media) = 'array'::text)),
  CONSTRAINT content_posts_networks_array CHECK ((jsonb_typeof(networks) = 'array'::text)),
  CONSTRAINT content_posts_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'agent'::text]))),
  CONSTRAINT content_posts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'in_production'::text, 'in_review'::text, 'approved'::text, 'scheduled'::text, 'publishing'::text, 'published'::text, 'partially_published'::text, 'failed'::text]))),
  CONSTRAINT content_posts_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT content_posts_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT content_posts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT content_posts_idea_id_fkey FOREIGN KEY (idea_id) REFERENCES public.content_ideas(id) ON DELETE SET NULL,
  CONSTRAINT content_posts_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.products(id) ON DELETE SET NULL,
  CONSTRAINT content_posts_pillar_id_fkey FOREIGN KEY (pillar_id) REFERENCES public.content_pillars(id) ON DELETE SET NULL,
  CONSTRAINT content_posts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.content_posts ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.content_posts IS 'Una pieza de contenido: un copy, un caption y las redes donde va. El estado desde "scheduled" se deriva de sus filas en social_posts.';
COMMENT ON COLUMN public.content_posts.networks IS 'Lo propio de cada red: [{ platform, planned_at, caption, media, cta, options, publisher, youtube_title }]. planned_at es TENTATIVA: mientras viva solo aca, no hay nada en la cola.';
COMMENT ON COLUMN public.content_posts.media IS 'La biblioteca de la pieza: todos sus archivos, subidos una vez. Cada red elige los suyos por id en networks[].files.';
COMMENT ON COLUMN public.content_posts.copy_source IS 'Quien escribio el copy: manual, ai, o mixed (la IA lo escribio y una persona lo edito).';
COMMENT ON COLUMN public.content_posts.copy_status IS 'Si el copywriter esta escribiendo esta pieza. Lo lee el kanban y el editor para mostrarlo y refrescarse solos.';
COMMENT ON COLUMN public.content_posts.script IS 'El guion completo para grabar.';
COMMENT ON COLUMN public.content_posts.recording_notes IS 'Instrucciones para grabar la pieza.';
COMMENT ON COLUMN public.content_posts.assigned_to IS 'Responsable de la pieza (miembro del workspace). Distinto de created_by, que no cambia. Por defecto, quien la crea.';
COMMENT ON COLUMN public.content_posts.attribution_code IS 'Codigo corto y unico por workspace (c + 5 caracteres [a-z2-9]) que va en el utm_content de los links de la pieza.';

CREATE TABLE IF NOT EXISTS public.content_post_versions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  post_id uuid NOT NULL,
  version_no integer NOT NULL,
  snapshot jsonb NOT NULL,
  author_kind text DEFAULT 'human'::text NOT NULL,
  author_id uuid,
  reason text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT content_post_versions_pkey PRIMARY KEY (id),
  CONSTRAINT content_post_versions_author_check CHECK ((author_kind = ANY (ARRAY['human'::text, 'ai'::text, 'system'::text]))),
  CONSTRAINT content_post_versions_reason_check CHECK ((reason = ANY (ARRAY['status_change'::text, 'manual_save'::text, 'resume_after_idle'::text, 'ai_generation'::text, 'restore'::text, 'edit'::text, 'approve'::text]))),
  CONSTRAINT content_post_versions_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT content_post_versions_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.content_posts(id) ON DELETE CASCADE,
  CONSTRAINT content_post_versions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.content_post_versions ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.content_post_versions IS 'Historial del post. Restaurar crea una version nueva: nunca se borra una.';
COMMENT ON COLUMN public.content_post_versions.updated_at IS 'Cuando se toco por ultima vez esta fila. Con reason=edit y menos de 10 minutos, el proximo cambio del mismo autor actualiza esta misma version en vez de crear otra.';

CREATE TABLE IF NOT EXISTS public.provider_media (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  publisher text NOT NULL,
  storage_path text NOT NULL,
  size_bytes bigint,
  provider_url text NOT NULL,
  uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT provider_media_pkey PRIMARY KEY (id),
  CONSTRAINT provider_media_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.provider_media ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.provider_media IS 'Que archivo de content-media corresponde a que URL del proveedor, para no subirlo dos veces.';

CREATE TABLE IF NOT EXISTS public.social_accounts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  platform text NOT NULL,
  handle text,
  username text,
  display_name text,
  avatar_url text,
  bio text,
  profile_url text,
  website text,
  external_id text,
  channel_id uuid,
  default_publisher text,
  publishers jsonb DEFAULT '[]'::jsonb NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  profile_synced_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  profile_sync_error text,
  CONSTRAINT social_accounts_pkey PRIMARY KEY (id),
  CONSTRAINT social_accounts_platform_check CHECK ((platform = ANY (ARRAY['instagram'::text, 'tiktok'::text, 'youtube'::text, 'linkedin'::text, 'threads'::text]))),
  CONSTRAINT social_accounts_publishers_array CHECK ((jsonb_typeof(publishers) = 'array'::text)),
  CONSTRAINT social_accounts_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE SET NULL,
  CONSTRAINT social_accounts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.social_accounts IS 'Una fila por cuenta social del workspace (varias por red si la red lo permite, por ejemplo dos Instagram por Zernio): por donde se publica y que se muestra en la pagina Social.';
COMMENT ON COLUMN public.social_accounts.channel_id IS 'El canal de la bandeja, cuando la misma cuenta ademas conversa (Instagram por Zernio).';
COMMENT ON COLUMN public.social_accounts.default_publisher IS 'Cual se usa si no se elige otro. Si deja de estar disponible, el sistema pasa al siguiente y avisa.';
COMMENT ON COLUMN public.social_accounts.publishers IS 'Por donde se puede publicar en esta red: [{ publisher, account_ref, status, status_reason, verified_at, manually_enabled }]. Se valida con Zod al escribir.';

CREATE TABLE IF NOT EXISTS public.social_posts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  content_post_id uuid,
  social_account_id uuid,
  platform text NOT NULL,
  publisher text,
  publisher_ref text,
  origin text DEFAULT 'system'::text NOT NULL,
  status text,
  scheduled_at timestamp with time zone,
  attempts integer DEFAULT 0 NOT NULL,
  last_error text,
  last_error_kind text,
  requested_visibility text,
  actual_visibility text,
  warning text,
  external_post_id text,
  url text,
  published_at timestamp with time zone,
  caption text,
  media_type text,
  thumbnail_url text,
  last_synced_at timestamp with time zone,
  sync_error text,
  engagement_d7 numeric,
  interactions_d7 integer,
  reach_d7 integer,
  views_d7 integer,
  d7_computed_at timestamp with time zone,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  publish_progress jsonb,
  assigned_to uuid,
  CONSTRAINT social_posts_pkey PRIMARY KEY (id),
  CONSTRAINT social_posts_error_kind_check CHECK (((last_error_kind IS NULL) OR (last_error_kind = ANY (ARRAY['temporary'::text, 'permanent'::text])))),
  CONSTRAINT social_posts_media_type_check CHECK (((media_type IS NULL) OR (media_type = ANY (ARRAY['image'::text, 'carousel'::text, 'reel'::text, 'story'::text, 'video'::text, 'short'::text, 'text'::text, 'document'::text])))),
  CONSTRAINT social_posts_origin_check CHECK ((origin = ANY (ARRAY['system'::text, 'external'::text, 'manual'::text]))),
  CONSTRAINT social_posts_platform_check CHECK ((platform = ANY (ARRAY['instagram'::text, 'tiktok'::text, 'youtube'::text, 'linkedin'::text, 'threads'::text]))),
  CONSTRAINT social_posts_publish_progress_object CHECK (((publish_progress IS NULL) OR (jsonb_typeof(publish_progress) = 'object'::text))),
  CONSTRAINT social_posts_status_check CHECK (((status IS NULL) OR (status = ANY (ARRAY['uploading'::text, 'scheduled'::text, 'publishing'::text, 'published'::text, 'failed'::text, 'cancelled'::text])))),
  CONSTRAINT social_posts_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT social_posts_content_post_id_fkey FOREIGN KEY (content_post_id) REFERENCES public.content_posts(id) ON DELETE CASCADE,
  CONSTRAINT social_posts_social_account_id_fkey FOREIGN KEY (social_account_id) REFERENCES public.social_accounts(id) ON DELETE SET NULL,
  CONSTRAINT social_posts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.social_posts IS 'Una fila por red y post, creada al PROGRAMAR esa red. Tambien entran las publicaciones hechas a mano (origin = external), que aparecen en metricas y en Social pero no en el kanban. Solo la escribe el servidor.';
COMMENT ON COLUMN public.social_posts.origin IS 'system: la publico el sistema. external: la trajo la sincronizacion. manual: la subio una persona por fuera de la app y la marco como publicada.';
COMMENT ON COLUMN public.social_posts.status IS 'uploading = subiendo la media al proveedor; scheduled = agendado (nuestro o de Zernio); publishing = el proveedor la esta publicando.';
COMMENT ON COLUMN public.social_posts.last_error_kind IS 'temporary: reintentar tiene sentido. permanent: no va a mejorar solo.';
COMMENT ON COLUMN public.social_posts.publish_progress IS 'Que pasos de la publicacion ya salieron, para que un reintento no los repita. Lo escribe solo el publicador.';
COMMENT ON COLUMN public.social_posts.assigned_to IS 'Responsable de una publicacion SIN pieza (externa o marcada a mano). Las de una pieza usan content_posts.assigned_to.';

CREATE TABLE IF NOT EXISTS public.social_post_comments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  social_post_id uuid,
  platform text NOT NULL,
  external_comment_id text NOT NULL,
  parent_external_comment_id text,
  author_external_id text,
  author_username text,
  author_name text,
  author_avatar_url text,
  is_own boolean DEFAULT false NOT NULL,
  text text,
  commented_at timestamp with time zone,
  like_count integer,
  hidden boolean DEFAULT false NOT NULL,
  contact_id uuid,
  source text DEFAULT 'sync'::text NOT NULL,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  external_post_id text,
  CONSTRAINT social_post_comments_pkey PRIMARY KEY (id),
  CONSTRAINT social_post_comments_platform_check CHECK ((platform = ANY (ARRAY['instagram'::text, 'tiktok'::text, 'youtube'::text, 'linkedin'::text, 'threads'::text]))),
  CONSTRAINT social_post_comments_source_check CHECK ((source = ANY (ARRAY['webhook'::text, 'sync'::text]))),
  CONSTRAINT social_post_comments_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL,
  CONSTRAINT social_post_comments_social_post_id_fkey FOREIGN KEY (social_post_id) REFERENCES public.social_posts(id) ON DELETE CASCADE,
  CONSTRAINT social_post_comments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.social_post_comments ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.social_post_comments IS 'Comentarios de las publicaciones. Entran por el webhook en el momento y se vuelven a leer en la sincronizacion. Los propios se guardan y nunca disparan automatizaciones.';

-- ----------------------------------------------------------------------------
-- Funciones
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.new_attribution_code(p_workspace_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_alphabet constant text := 'abcdefghijkmnpqrstuvwxyz23456789';
  v_code text;
  v_try int := 0;
BEGIN
  LOOP
    v_try := v_try + 1;
    v_code := 'c';
    FOR i IN 1..5 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM public.content_posts p WHERE p.workspace_id = p_workspace_id AND p.attribution_code = v_code) THEN
      RETURN v_code;
    END IF;
    IF v_try >= 10 THEN
      RAISE EXCEPTION 'No pude generar un codigo de atribucion libre despues de 10 intentos';
    END IF;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION private.new_attribution_code(p_workspace_id uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.approve_content_idea_v2(p_idea_id uuid, p_title text, p_format text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_idea    public.content_ideas%ROWTYPE;
  v_post_id uuid;
  v_networks jsonb;
BEGIN
  SELECT * INTO v_idea FROM public.content_ideas WHERE id = p_idea_id AND deleted_at IS NULL;

  IF v_idea.id IS NULL THEN
    RAISE EXCEPTION 'idea_no_encontrada';
  END IF;

  IF v_idea.status <> 'nueva' THEN
    RAISE EXCEPTION 'idea_ya_decidida';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'platform', p,
    'planned_at', NULL,
    'caption', NULL,
    'media', NULL,
    'cta', jsonb_build_object('type', 'none', 'keyword', NULL),
    'options', '{}'::jsonb
  ) ORDER BY ord), '[]'::jsonb)
  INTO v_networks
  FROM unnest(v_idea.platforms) WITH ORDINALITY AS u(p, ord);

  INSERT INTO public.content_posts (
    workspace_id, idea_id, title, format, reference,
    offer_id, pillar_id, funnel_stage, networks,
    status, created_by, position
  )
  VALUES (
    v_idea.workspace_id, v_idea.id, p_title, COALESCE(p_format, v_idea.format), v_idea.reference,
    v_idea.offer_id, v_idea.pillar_id, v_idea.funnel_stage, v_networks,
    'draft', auth.uid(),
    coalesce((
      SELECT max(position) + 10 FROM public.content_posts
      WHERE workspace_id = v_idea.workspace_id AND status = 'draft' AND deleted_at IS NULL
    ), 10)
  )
  RETURNING id INTO v_post_id;

  UPDATE public.content_ideas
  SET status = 'aprobada', approved_by = auth.uid(), approved_at = now()
  WHERE id = v_idea.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sin_permiso_para_aprobar';
  END IF;

  RETURN v_post_id;
END;
$function$;
COMMENT ON FUNCTION public.approve_content_idea_v2(p_idea_id uuid, p_title text, p_format text) IS 'Crea la pieza y marca la idea aprobada en una sola transaccion, heredando clasificacion y plataformas. SECURITY INVOKER: la RLS decide si puede.';
REVOKE ALL ON FUNCTION public.approve_content_idea_v2(p_idea_id uuid, p_title text, p_format text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.content_posts_assignee_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.assigned_to IS NULL AND NEW.created_by IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.workspace_members m
       WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.created_by
    ) THEN
      NEW.assigned_to := NEW.created_by;
    END IF;
  END IF;

  IF NEW.assigned_to IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.workspace_members m
       WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.assigned_to
    ) THEN
      RAISE EXCEPTION 'El responsable tiene que ser parte del equipo.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.content_posts_assignee_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.content_posts_attribution_code_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.attribution_code IS NULL OR btrim(NEW.attribution_code) = '' THEN
    NEW.attribution_code := private.new_attribution_code(NEW.workspace_id);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.content_posts_attribution_code_trg() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.content_posts_status_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  -- El servidor (service_role, cron, funciones del sistema) no tiene usuario.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.is_workspace_admin(NEW.workspace_id) THEN
    RETURN NEW;
  END IF;
  IF OLD.status IN ('draft', 'in_production', 'in_review')
     AND NEW.status IN ('draft', 'in_production', 'in_review') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Ese cambio de estado lo hace quien aprueba o publica.'
    USING ERRCODE = 'insufficient_privilege';
END;
$function$;
REVOKE ALL ON FUNCTION public.content_posts_status_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.social_posts_assignee_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.assigned_to IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.workspace_members m
       WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.assigned_to
    ) THEN
      RAISE EXCEPTION 'El responsable tiene que ser parte del equipo.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.social_posts_assignee_guard() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Indices
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_content_ideas_board ON public.content_ideas USING btree (workspace_id, status, "position") WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_content_ideas_offer ON public.content_ideas USING btree (workspace_id, offer_id) WHERE (offer_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_content_ideas_pillar ON public.content_ideas USING btree (workspace_id, pillar_id) WHERE (pillar_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_content_posts_assignee ON public.content_posts USING btree (workspace_id, assigned_to) WHERE (assigned_to IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_content_posts_board ON public.content_posts USING btree (workspace_id, status, "position") WHERE ((deleted_at IS NULL) AND (archived_at IS NULL));

CREATE INDEX IF NOT EXISTS idx_content_posts_idea ON public.content_posts USING btree (idea_id) WHERE (idea_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_content_posts_offer ON public.content_posts USING btree (workspace_id, offer_id) WHERE (offer_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_content_posts_pillar ON public.content_posts USING btree (workspace_id, pillar_id) WHERE (pillar_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_post_comments_external_post ON public.social_post_comments USING btree (workspace_id, platform, external_post_id) WHERE (external_post_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_post_comments_orphans ON public.social_post_comments USING btree (workspace_id, platform) WHERE (social_post_id IS NULL);

CREATE INDEX IF NOT EXISTS idx_post_comments_post ON public.social_post_comments USING btree (social_post_id, commented_at DESC) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_social_accounts_ws_active ON public.social_accounts USING btree (workspace_id, is_active);

CREATE INDEX IF NOT EXISTS idx_social_posts_publisher ON public.social_posts USING btree (workspace_id, publisher, published_at);

CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled ON public.social_posts USING btree (workspace_id, status, scheduled_at) WHERE (status = ANY (ARRAY['scheduled'::text, 'publishing'::text]));

CREATE UNIQUE INDEX IF NOT EXISTS provider_media_unique ON public.provider_media USING btree (workspace_id, publisher, storage_path);

CREATE INDEX IF NOT EXISTS provider_media_workspace_idx ON public.provider_media USING btree (workspace_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_pillars_name ON public.content_pillars USING btree (workspace_id, lower(btrim(name))) WHERE (archived_at IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_post_versions_no ON public.content_post_versions USING btree (post_id, version_no);

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_posts_attribution_code ON public.content_posts USING btree (workspace_id, attribution_code);

CREATE UNIQUE INDEX IF NOT EXISTS uq_post_comments_external ON public.social_post_comments USING btree (workspace_id, platform, external_comment_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_accounts_ws_platform_ext ON public.social_accounts USING btree (workspace_id, platform, external_id) WHERE (external_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_accounts_ws_platform_noext ON public.social_accounts USING btree (workspace_id, platform) WHERE (external_id IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_posts_account_external ON public.social_posts USING btree (social_account_id, external_post_id) WHERE (external_post_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_posts_content_platform ON public.social_posts USING btree (content_post_id, platform) WHERE ((content_post_id IS NOT NULL) AND (deleted_at IS NULL));

-- ----------------------------------------------------------------------------
-- Disparadores
-- ----------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.content_ideas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.content_pillars FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER content_posts_assignee BEFORE INSERT OR UPDATE OF assigned_to ON public.content_posts FOR EACH ROW EXECUTE FUNCTION public.content_posts_assignee_guard();

CREATE OR REPLACE TRIGGER content_posts_attribution_code BEFORE INSERT ON public.content_posts FOR EACH ROW EXECUTE FUNCTION public.content_posts_attribution_code_trg();

CREATE OR REPLACE TRIGGER content_posts_status_guard BEFORE UPDATE OF status ON public.content_posts FOR EACH ROW EXECUTE FUNCTION public.content_posts_status_guard();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.content_posts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.social_accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_social_post_comments BEFORE UPDATE ON public.social_post_comments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.social_posts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER social_posts_assignee BEFORE INSERT OR UPDATE OF assigned_to ON public.social_posts FOR EACH ROW EXECUTE FUNCTION public.social_posts_assignee_guard();

-- ----------------------------------------------------------------------------
-- Reglas de acceso (RLS)
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE POLICY content_ideas_delete ON public.content_ideas FOR DELETE TO public
    USING (public.is_workspace_admin(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY content_ideas_insert ON public.content_ideas FOR INSERT TO public
    WITH CHECK ((public.is_workspace_member(workspace_id) AND (status = 'nueva'::text) AND (public.is_workspace_admin(workspace_id) OR (created_by = auth.uid()))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY content_ideas_select ON public.content_ideas FOR SELECT TO public
    USING ((public.is_workspace_member(workspace_id) AND (deleted_at IS NULL)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY content_ideas_update ON public.content_ideas FOR UPDATE TO public
    USING ((public.is_workspace_admin(workspace_id) OR (public.is_workspace_member(workspace_id) AND (created_by = auth.uid()) AND (status = 'nueva'::text))))
    WITH CHECK ((public.is_workspace_admin(workspace_id) OR ((created_by = auth.uid()) AND (status = 'nueva'::text))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY content_pillars_insert ON public.content_pillars FOR INSERT TO public
    WITH CHECK (public.has_permission(workspace_id, 'settings.general'::text));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY content_pillars_select ON public.content_pillars FOR SELECT TO public
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY content_pillars_update ON public.content_pillars FOR UPDATE TO public
    USING (public.has_permission(workspace_id, 'settings.general'::text))
    WITH CHECK (public.has_permission(workspace_id, 'settings.general'::text));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY content_post_versions_select ON public.content_post_versions FOR SELECT TO public
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY content_posts_delete ON public.content_posts FOR DELETE TO public
    USING (public.is_workspace_admin(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY content_posts_insert ON public.content_posts FOR INSERT TO public
    WITH CHECK ((public.is_workspace_member(workspace_id) AND (public.is_workspace_admin(workspace_id) OR ((created_by = auth.uid()) AND (status = ANY (ARRAY['draft'::text, 'in_production'::text, 'in_review'::text]))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY content_posts_select ON public.content_posts FOR SELECT TO public
    USING ((public.is_workspace_member(workspace_id) AND (deleted_at IS NULL)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY content_posts_update ON public.content_posts FOR UPDATE TO public
    USING ((public.is_workspace_admin(workspace_id) OR (public.is_workspace_member(workspace_id) AND ((created_by = auth.uid()) OR (assigned_to = auth.uid())))))
    WITH CHECK ((public.is_workspace_admin(workspace_id) OR ((created_by = auth.uid()) OR (assigned_to = auth.uid()))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY provider_media_select ON public.provider_media FOR SELECT TO authenticated
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY social_accounts_delete ON public.social_accounts FOR DELETE TO public
    USING (( SELECT public.has_permission(social_accounts.workspace_id, 'integrations.manage'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY social_accounts_insert ON public.social_accounts FOR INSERT TO public
    WITH CHECK (( SELECT public.has_permission(social_accounts.workspace_id, 'integrations.manage'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY social_accounts_select ON public.social_accounts FOR SELECT TO public
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY social_accounts_update ON public.social_accounts FOR UPDATE TO public
    USING (( SELECT public.has_permission(social_accounts.workspace_id, 'integrations.manage'::text) AS has_permission))
    WITH CHECK (( SELECT public.has_permission(social_accounts.workspace_id, 'integrations.manage'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY social_post_comments_select_permission ON public.social_post_comments FOR SELECT TO authenticated
    USING ((public.has_permission(workspace_id, 'social.view'::text) OR public.has_permission(workspace_id, 'dashboards.content.view'::text)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY social_posts_select ON public.social_posts FOR SELECT TO public
    USING ((public.is_workspace_member(workspace_id) AND (deleted_at IS NULL)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
