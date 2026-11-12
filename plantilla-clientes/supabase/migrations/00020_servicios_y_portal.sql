-- ============================================================================
-- Servicios y portal
--
-- Lo que pasa con cada cliente despues de la venta: el servicio, su camino (fases y
-- pasos), el semaforo y los accesos al portal; y lo del portal del estudiante (programa,
-- evaluaciones, calendario, asistencia, comunidad y tutor). Vive en sus propios esquemas:
-- app_servicio (expuesto en la API, solo lectura con reglas de acceso) y app_servicio_portal
-- (cerrado). El modulo se prende por negocio y nace apagado; sus disparadores sobre tablas del
-- resto del sistema nunca hacen fallar lo que los dispara.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tablas
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app_servicio_portal.portal_accounts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  email text NOT NULL,
  status text DEFAULT 'invited'::text NOT NULL,
  password_hash text,
  login_code_hash text,
  login_code_expires_at timestamp with time zone,
  login_code_attempts integer DEFAULT 0 NOT NULL,
  invite_token_hash text,
  invite_expires_at timestamp with time zone,
  invite_sent_at timestamp with time zone,
  invite_sent_count_day integer DEFAULT 0 NOT NULL,
  last_login_at timestamp with time zone,
  display_name text,
  avatar_path text,
  timezone text,
  show_amount_in_fame boolean DEFAULT false NOT NULL,
  suspended_at timestamp with time zone,
  suspended_reason text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT portal_accounts_pkey PRIMARY KEY (id),
  CONSTRAINT portal_accounts_attempts_check CHECK (((login_code_attempts >= 0) AND (invite_sent_count_day >= 0))),
  CONSTRAINT portal_accounts_email_lower CHECK (((email = lower(btrim(email))) AND (email <> ''::text))),
  CONSTRAINT portal_accounts_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'active'::text, 'suspended'::text]))),
  CONSTRAINT portal_accounts_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
  CONSTRAINT portal_accounts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE app_servicio_portal.portal_accounts ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE app_servicio_portal.portal_accounts IS 'Servicios v12 (F41): la cuenta del portal de un contacto. Una por contacto y negocio; email unico por negocio. Solo huellas de los secretos. La escriben las funciones del modulo (00341).';
GRANT ALL ON TABLE app_servicio_portal.portal_accounts TO service_role;

CREATE TABLE IF NOT EXISTS app_servicio_portal.portal_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  account_id uuid,
  kind text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone,
  preview_user_id uuid,
  preview_contact_id uuid,
  user_agent_hash text,
  ip_hash text,
  last_seen_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT portal_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT portal_sessions_account_check CHECK (((kind <> 'student'::text) OR (account_id IS NOT NULL))),
  CONSTRAINT portal_sessions_hash_check CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT portal_sessions_kind_check CHECK ((kind = ANY (ARRAY['student'::text, 'preview_pass'::text, 'preview'::text]))),
  CONSTRAINT portal_sessions_preview_check CHECK (((kind = 'student'::text) OR (preview_contact_id IS NOT NULL))),
  CONSTRAINT portal_sessions_account_id_fkey FOREIGN KEY (account_id) REFERENCES app_servicio_portal.portal_accounts(id) ON DELETE CASCADE,
  CONSTRAINT portal_sessions_preview_contact_id_fkey FOREIGN KEY (preview_contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
  CONSTRAINT portal_sessions_preview_user_id_fkey FOREIGN KEY (preview_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT portal_sessions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE app_servicio_portal.portal_sessions ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE app_servicio_portal.portal_sessions IS 'Servicios v12 (F44): sesiones del portal y pases de "Ver como estudiante". Solo la huella del token. La crea y la revoca SSA; el login la usa en la Parte 2.';
GRANT ALL ON TABLE app_servicio_portal.portal_sessions TO service_role;

CREATE TABLE IF NOT EXISTS app_servicio.link_clicks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  target_date date,
  contact_id uuid,
  portal_account_id uuid,
  clicked_at timestamp with time zone DEFAULT now() NOT NULL,
  ip_hash text,
  user_agent_kind text,
  is_bot boolean DEFAULT false NOT NULL,
  CONSTRAINT link_clicks_pkey PRIMARY KEY (id),
  CONSTRAINT link_clicks_ip_hash_check CHECK (((ip_hash IS NULL) OR (ip_hash ~ '^[0-9a-f]{64}$'::text))),
  CONSTRAINT link_clicks_target_check CHECK ((target_type = 'live_session'::text)),
  CONSTRAINT link_clicks_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
  CONSTRAINT link_clicks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE app_servicio.link_clicks ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE app_servicio.link_clicks TO authenticated;
GRANT ALL ON TABLE app_servicio.link_clicks TO service_role;

CREATE TABLE IF NOT EXISTS app_servicio.live_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  product_id uuid NOT NULL,
  title text NOT NULL,
  kind text NOT NULL,
  weekdays integer[],
  every_weeks integer,
  starts_on date,
  ends_on date,
  single_at timestamp with time zone,
  start_time time without time zone,
  duration_minutes integer DEFAULT 60 NOT NULL,
  timezone text NOT NULL,
  variant_ids uuid[],
  host_user_id uuid,
  meeting_url text,
  keyword text,
  track_clicks boolean DEFAULT true NOT NULL,
  click_counts_as_attendance boolean DEFAULT false NOT NULL,
  attendance_base jsonb DEFAULT '{"type": "active"}'::jsonb NOT NULL,
  archived_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT live_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT live_sessions_base_check CHECK ((((attendance_base ->> 'type'::text) = 'active'::text) OR (((attendance_base ->> 'type'::text) = 'started_within'::text) AND (jsonb_typeof((attendance_base -> 'days'::text)) = 'number'::text) AND ((((attendance_base ->> 'days'::text))::numeric >= (1)::numeric) AND (((attendance_base ->> 'days'::text))::numeric <= (365)::numeric))) OR (((attendance_base ->> 'type'::text) = 'phase'::text) AND ((attendance_base ->> 'phase_key'::text) ~ '^ph_[a-z0-9]{6}$'::text)) OR (((attendance_base ->> 'type'::text) = 'variant'::text) AND ((attendance_base ->> 'variant_id'::text) ~* '^[0-9a-f-]{36}$'::text)))),
  CONSTRAINT live_sessions_duration_check CHECK (((duration_minutes >= 5) AND (duration_minutes <= 720))),
  CONSTRAINT live_sessions_kind_check CHECK ((kind = ANY (ARRAY['weekly'::text, 'single'::text]))),
  CONSTRAINT live_sessions_shape_check CHECK ((((kind = 'weekly'::text) AND (starts_on IS NOT NULL) AND (start_time IS NOT NULL) AND ((cardinality(weekdays) >= 1) AND (cardinality(weekdays) <= 7)) AND (weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]) AND (every_weeks BETWEEN 1 AND 4) AND ((ends_on IS NULL) OR (ends_on >= starts_on))) OR ((kind = 'single'::text) AND (single_at IS NOT NULL)))),
  CONSTRAINT live_sessions_title_check CHECK (((btrim(title) <> ''::text) AND (char_length(title) <= 120))),
  CONSTRAINT live_sessions_url_check CHECK (((meeting_url IS NULL) OR (meeting_url ~ '^https://'::text))),
  CONSTRAINT live_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT live_sessions_host_user_id_fkey FOREIGN KEY (host_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT live_sessions_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE,
  CONSTRAINT live_sessions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE app_servicio.live_sessions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE app_servicio.live_sessions TO service_role;
GRANT SELECT (id, workspace_id, product_id, title, kind, weekdays, every_weeks, starts_on, ends_on, single_at, start_time, duration_minutes, timezone, variant_ids, host_user_id, keyword, track_clicks, click_counts_as_attendance, attendance_base, archived_at, created_by, created_at, updated_at) ON TABLE app_servicio.live_sessions TO authenticated;

CREATE TABLE IF NOT EXISTS app_servicio_portal.live_attendance (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  live_session_id uuid NOT NULL,
  occurs_on date NOT NULL,
  contact_id uuid NOT NULL,
  source text NOT NULL,
  added_manually boolean DEFAULT false NOT NULL,
  marked_at timestamp with time zone DEFAULT now() NOT NULL,
  marked_by uuid,
  removed_at timestamp with time zone,
  removed_by uuid,
  removed_reason text,
  CONSTRAINT live_attendance_pkey PRIMARY KEY (id),
  CONSTRAINT live_attendance_removed_check CHECK (((removed_at IS NULL) OR (NULLIF(btrim(removed_reason), ''::text) IS NOT NULL))),
  CONSTRAINT live_attendance_source_check CHECK ((source = ANY (ARRAY['self'::text, 'team'::text, 'click'::text]))),
  CONSTRAINT live_attendance_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
  CONSTRAINT live_attendance_live_session_id_fkey FOREIGN KEY (live_session_id) REFERENCES app_servicio.live_sessions(id) ON DELETE CASCADE,
  CONSTRAINT live_attendance_marked_by_fkey FOREIGN KEY (marked_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT live_attendance_removed_by_fkey FOREIGN KEY (removed_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT live_attendance_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE app_servicio_portal.live_attendance ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE app_servicio_portal.live_attendance TO service_role;

CREATE TABLE IF NOT EXISTS app_servicio.live_session_dates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  live_session_id uuid NOT NULL,
  occurs_on date NOT NULL,
  status text DEFAULT 'normal'::text NOT NULL,
  moved_to timestamp with time zone,
  recording_url text,
  recording_call_id uuid,
  recording_source text,
  recording_active boolean DEFAULT true NOT NULL,
  note text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT live_session_dates_pkey PRIMARY KEY (id),
  CONSTRAINT live_session_dates_moved_check CHECK (((status <> 'moved'::text) OR (moved_to IS NOT NULL))),
  CONSTRAINT live_session_dates_source_check CHECK (((recording_source IS NULL) OR (recording_source = ANY (ARRAY['manual'::text, 'fathom'::text])))),
  CONSTRAINT live_session_dates_status_check CHECK ((status = ANY (ARRAY['normal'::text, 'cancelled'::text, 'moved'::text]))),
  CONSTRAINT live_session_dates_url_check CHECK (((recording_url IS NULL) OR (recording_url ~ '^https://'::text))),
  CONSTRAINT live_session_dates_live_session_id_fkey FOREIGN KEY (live_session_id) REFERENCES app_servicio.live_sessions(id) ON DELETE CASCADE,
  CONSTRAINT live_session_dates_recording_call_id_fkey FOREIGN KEY (recording_call_id) REFERENCES public.calls(id) ON DELETE SET NULL,
  CONSTRAINT live_session_dates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE app_servicio.live_session_dates ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE app_servicio.live_session_dates TO authenticated;
GRANT ALL ON TABLE app_servicio.live_session_dates TO service_role;

CREATE TABLE IF NOT EXISTS app_servicio.program_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  product_id uuid NOT NULL,
  parent_id uuid,
  kind text NOT NULL,
  lesson_type text,
  title text NOT NULL,
  description text,
  "position" integer DEFAULT 0 NOT NULL,
  status text DEFAULT 'inactive'::text NOT NULL,
  video_url text,
  video_embed_url text,
  duration_seconds integer,
  html_content text,
  document_path text,
  form_id uuid,
  resources jsonb DEFAULT '[]'::jsonb NOT NULL,
  cover_path text,
  thumbnail_path text,
  thumbnail_url text,
  comments_enabled boolean DEFAULT true NOT NULL,
  unlock_rule jsonb DEFAULT '{"type": "open"}'::jsonb NOT NULL,
  required boolean DEFAULT true NOT NULL,
  source_call_id uuid,
  copied_from_id uuid,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT program_items_pkey PRIMARY KEY (id),
  CONSTRAINT program_items_duration_check CHECK (((duration_seconds IS NULL) OR (duration_seconds >= 0))),
  CONSTRAINT program_items_html_size CHECK (((html_content IS NULL) OR (octet_length(html_content) <= 1048576))),
  CONSTRAINT program_items_kind_check CHECK ((kind = ANY (ARRAY['module'::text, 'submodule'::text, 'lesson'::text]))),
  CONSTRAINT program_items_lesson_type_check CHECK ((((kind = 'lesson'::text) AND (lesson_type = ANY (ARRAY['video'::text, 'html'::text, 'document'::text, 'quiz'::text, 'activity'::text]))) OR ((kind <> 'lesson'::text) AND (lesson_type IS NULL)))),
  CONSTRAINT program_items_not_self CHECK (((parent_id IS NULL) OR (parent_id <> id))),
  CONSTRAINT program_items_resources_check CHECK ((jsonb_typeof(resources) = 'array'::text)),
  CONSTRAINT program_items_status_check CHECK ((status = ANY (ARRAY['inactive'::text, 'active'::text, 'archived'::text]))),
  CONSTRAINT program_items_title_check CHECK (((btrim(title) <> ''::text) AND (char_length(title) <= 200))),
  CONSTRAINT program_items_unlock_check CHECK ((jsonb_typeof(unlock_rule) = 'object'::text)),
  CONSTRAINT program_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT program_items_form_id_fkey FOREIGN KEY (form_id) REFERENCES public.forms(id) ON DELETE SET NULL,
  CONSTRAINT program_items_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES app_servicio.program_items(id) ON DELETE CASCADE,
  CONSTRAINT program_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE,
  CONSTRAINT program_items_source_call_id_fkey FOREIGN KEY (source_call_id) REFERENCES public.calls(id) ON DELETE SET NULL,
  CONSTRAINT program_items_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE app_servicio.program_items ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE app_servicio.program_items IS 'Servicios v12 (F45): el contenido del programa de un producto. Lo nuevo nace inactivo; se archiva, no se borra. Escribe solo el servidor (00342).';
GRANT SELECT ON TABLE app_servicio.program_items TO authenticated;
GRANT ALL ON TABLE app_servicio.program_items TO service_role;

CREATE TABLE IF NOT EXISTS app_servicio_portal.community_posts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  product_id uuid NOT NULL,
  space_key text NOT NULL,
  parent_id uuid,
  program_item_id uuid,
  author_contact_id uuid,
  author_user_id uuid,
  as_business boolean DEFAULT false NOT NULL,
  body text NOT NULL,
  media jsonb DEFAULT '[]'::jsonb NOT NULL,
  pinned_at timestamp with time zone,
  hidden_at timestamp with time zone,
  hidden_by uuid,
  hidden_reason text,
  team_seen_at timestamp with time zone,
  deleted_at timestamp with time zone,
  edited_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT community_posts_pkey PRIMARY KEY (id),
  CONSTRAINT community_posts_author_check CHECK ((((author_contact_id IS NOT NULL) AND (author_user_id IS NULL) AND (NOT as_business)) OR ((author_contact_id IS NULL) AND ((author_user_id IS NOT NULL) OR as_business)))),
  CONSTRAINT community_posts_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 10000))),
  CONSTRAINT community_posts_hidden_check CHECK (((hidden_at IS NULL) OR (NULLIF(btrim(hidden_reason), ''::text) IS NOT NULL))),
  CONSTRAINT community_posts_lesson_check CHECK (((space_key = 'clases'::text) = (program_item_id IS NOT NULL))),
  CONSTRAINT community_posts_media_check CHECK (((jsonb_typeof(media) = 'array'::text) AND (jsonb_array_length(media) <= 10))),
  CONSTRAINT community_posts_space_check CHECK ((space_key ~ '^[a-z0-9_]{1,40}$'::text)),
  CONSTRAINT community_posts_author_contact_id_fkey FOREIGN KEY (author_contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
  CONSTRAINT community_posts_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT community_posts_hidden_by_fkey FOREIGN KEY (hidden_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT community_posts_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES app_servicio_portal.community_posts(id) ON DELETE CASCADE,
  CONSTRAINT community_posts_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE,
  CONSTRAINT community_posts_program_item_id_fkey FOREIGN KEY (program_item_id) REFERENCES app_servicio.program_items(id) ON DELETE CASCADE,
  CONSTRAINT community_posts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE app_servicio_portal.community_posts ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE app_servicio_portal.community_posts TO service_role;

CREATE TABLE IF NOT EXISTS app_servicio_portal.community_reactions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  post_id uuid NOT NULL,
  contact_id uuid,
  user_id uuid,
  kind text NOT NULL,
  report_reason text,
  resolved_at timestamp with time zone,
  resolved_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT community_reactions_pkey PRIMARY KEY (id),
  CONSTRAINT community_reactions_kind_check CHECK ((kind = ANY (ARRAY['like'::text, 'fire'::text, 'clap'::text, 'report'::text]))),
  CONSTRAINT community_reactions_reason_check CHECK (((report_reason IS NULL) OR (char_length(report_reason) <= 500))),
  CONSTRAINT community_reactions_who_check CHECK (((contact_id IS NULL) <> (user_id IS NULL))),
  CONSTRAINT community_reactions_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
  CONSTRAINT community_reactions_post_id_fkey FOREIGN KEY (post_id) REFERENCES app_servicio_portal.community_posts(id) ON DELETE CASCADE,
  CONSTRAINT community_reactions_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT community_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT community_reactions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE app_servicio_portal.community_reactions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE app_servicio_portal.community_reactions TO service_role;

CREATE TABLE IF NOT EXISTS app_servicio_portal.program_progress (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  program_item_id uuid NOT NULL,
  viewed_at timestamp with time zone,
  completed_at timestamp with time zone,
  unlocked_at timestamp with time zone,
  unlock_source text,
  last_position_seconds integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT program_progress_pkey PRIMARY KEY (id),
  CONSTRAINT program_progress_position_check CHECK (((last_position_seconds IS NULL) OR (last_position_seconds >= 0))),
  CONSTRAINT program_progress_unlock_check CHECK (((unlock_source IS NULL) OR (unlock_source = ANY (ARRAY['journey_item'::text, 'automation'::text, 'team'::text])))),
  CONSTRAINT program_progress_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
  CONSTRAINT program_progress_program_item_id_fkey FOREIGN KEY (program_item_id) REFERENCES app_servicio.program_items(id) ON DELETE CASCADE,
  CONSTRAINT program_progress_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE app_servicio_portal.program_progress ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE app_servicio_portal.program_progress IS 'Servicios v12 (F48): el avance de una persona en el programa. Una fila por contacto y clase (o modulo). Lo escribe el portal (Parte 2) y lo abierto a mano o por el camino.';
GRANT ALL ON TABLE app_servicio_portal.program_progress TO service_role;

CREATE TABLE IF NOT EXISTS app_servicio.services (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  product_id uuid NOT NULL,
  product_variant_id uuid,
  sale_id uuid,
  origin text NOT NULL,
  origin_reason text,
  previous_service_id uuid,
  status text NOT NULL,
  starts_on date,
  ends_on date,
  owner_user_id uuid,
  product_snapshot jsonb NOT NULL,
  price_cents bigint,
  currency text,
  progress_pct numeric(5,2),
  light text DEFAULT 'grey'::text NOT NULL,
  light_reason text,
  light_at timestamp with time zone,
  paused_at timestamp with time zone,
  paused_days integer DEFAULT 0 NOT NULL,
  pause_cut_access boolean,
  pause_resume_on date,
  extension_sale_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  cancel_reason text,
  completed_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  is_test boolean DEFAULT false NOT NULL,
  flags jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT services_pkey PRIMARY KEY (id),
  CONSTRAINT services_dates_check CHECK (((ends_on IS NULL) OR (starts_on IS NULL) OR (ends_on >= starts_on))),
  CONSTRAINT services_flags_check CHECK ((jsonb_typeof(flags) = 'object'::text)),
  CONSTRAINT services_is_test_check CHECK ((is_test = (origin = 'test'::text))),
  CONSTRAINT services_light_check CHECK ((light = ANY (ARRAY['green'::text, 'yellow'::text, 'red'::text, 'grey'::text]))),
  CONSTRAINT services_origin_check CHECK ((origin = ANY (ARRAY['sale'::text, 'courtesy'::text, 'test'::text, 'manual'::text, 'recovery'::text]))),
  CONSTRAINT services_owner_check CHECK (((owner_user_id IS NOT NULL) OR (status = ANY (ARRAY['pending_confirmation'::text, 'cancelled'::text])))),
  CONSTRAINT services_paused_days_check CHECK ((paused_days >= 0)),
  CONSTRAINT services_reason_check CHECK (((sale_id IS NOT NULL) OR (origin = 'sale'::text) OR (NULLIF(btrim(origin_reason), ''::text) IS NOT NULL))),
  CONSTRAINT services_snapshot_check CHECK ((jsonb_typeof(product_snapshot) = 'object'::text)),
  CONSTRAINT services_status_check CHECK ((status = ANY (ARRAY['pending_confirmation'::text, 'active'::text, 'paused'::text, 'completed'::text, 'cancelled'::text, 'renewed'::text]))),
  CONSTRAINT services_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id),
  CONSTRAINT services_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT services_previous_service_id_fkey FOREIGN KEY (previous_service_id) REFERENCES app_servicio.services(id) ON DELETE SET NULL,
  CONSTRAINT services_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id),
  CONSTRAINT services_product_variant_id_fkey FOREIGN KEY (product_variant_id) REFERENCES public.product_variants(id),
  CONSTRAINT services_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales(id) ON DELETE SET NULL,
  CONSTRAINT services_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE app_servicio.services ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE app_servicio.services IS 'El servicio de un cliente (Servicios v12, F4). Se escribe SOLO con app_servicio.svc_create_service y las funciones svc_* (00330/00333). Una venta, un servicio.';
GRANT SELECT ON TABLE app_servicio.services TO authenticated;
GRANT ALL ON TABLE app_servicio.services TO service_role;

CREATE TABLE IF NOT EXISTS app_servicio_portal.portal_access (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  service_id uuid NOT NULL,
  product_id uuid NOT NULL,
  section text NOT NULL,
  starts_at timestamp with time zone DEFAULT now() NOT NULL,
  ends_at timestamp with time zone,
  until_type text DEFAULT 'service'::text NOT NULL,
  source text NOT NULL,
  source_ref text,
  reason text,
  revoked_at timestamp with time zone,
  revoke_reason text,
  suspended_overdue_at timestamp with time zone,
  suspended_pause_at timestamp with time zone,
  ai_monthly_limit_usd numeric,
  muted_at timestamp with time zone,
  muted_reason text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT portal_access_pkey PRIMARY KEY (id),
  CONSTRAINT portal_access_ai_check CHECK (((ai_monthly_limit_usd IS NULL) OR ((section = 'assistant'::text) AND (ai_monthly_limit_usd >= (0)::numeric)))),
  CONSTRAINT portal_access_mute_check CHECK (((muted_at IS NULL) OR (section = 'community'::text))),
  CONSTRAINT portal_access_reason_check CHECK (((source <> 'manual_extra'::text) OR (NULLIF(btrim(reason), ''::text) IS NOT NULL))),
  CONSTRAINT portal_access_section_check CHECK ((section = ANY (ARRAY['program'::text, 'calendar'::text, 'challenge'::text, 'certificate'::text, 'assistant'::text, 'community'::text, 'fame'::text, 'affiliates'::text, 'projects'::text]))),
  CONSTRAINT portal_access_source_check CHECK ((source = ANY (ARRAY['service_start'::text, 'journey_item'::text, 'automation'::text, 'manual_extra'::text, 'renewal_transfer'::text, 'extension'::text]))),
  CONSTRAINT portal_access_until_check CHECK ((until_type = ANY (ARRAY['service'::text, 'days'::text, 'months'::text, 'fixed_date'::text, 'phase_completed'::text, 'item_completed'::text, 'forever'::text, 'manual'::text]))),
  CONSTRAINT portal_access_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
  CONSTRAINT portal_access_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT portal_access_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE,
  CONSTRAINT portal_access_service_id_fkey FOREIGN KEY (service_id) REFERENCES app_servicio.services(id) ON DELETE CASCADE,
  CONSTRAINT portal_access_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE app_servicio_portal.portal_access ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE app_servicio_portal.portal_access IS 'Servicios v12 (F37): los accesos al portal. Todavia no = no hay fila; una revocada se conserva. La escriben solo las funciones del modulo (00341).';
GRANT ALL ON TABLE app_servicio_portal.portal_access TO service_role;

CREATE TABLE IF NOT EXISTS app_servicio.service_phases (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  service_id uuid NOT NULL,
  template_key text NOT NULL,
  name text NOT NULL,
  "position" integer NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  duration_days integer,
  yellow_day integer,
  red_day integer,
  advance text DEFAULT 'auto'::text NOT NULL,
  challenge jsonb,
  awaiting_start boolean DEFAULT false NOT NULL,
  late_light jsonb,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  completed_via text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT service_phases_pkey PRIMARY KEY (id),
  CONSTRAINT service_phases_key_unique UNIQUE (service_id, template_key),
  CONSTRAINT service_phases_advance_check CHECK ((advance = ANY (ARRAY['auto'::text, 'auto_all'::text, 'manual'::text]))),
  CONSTRAINT service_phases_days_check CHECK ((((duration_days IS NULL) OR (duration_days > 0)) AND ((yellow_day IS NULL) OR (yellow_day >= 0)) AND ((red_day IS NULL) OR (red_day >= 0)) AND ((yellow_day IS NULL) OR (red_day IS NULL) OR (yellow_day < red_day)))),
  CONSTRAINT service_phases_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text]))),
  CONSTRAINT service_phases_via_check CHECK (((completed_via IS NULL) OR (completed_via = ANY (ARRAY['auto'::text, 'manual'::text, 'manual_move'::text])))),
  CONSTRAINT service_phases_service_id_fkey FOREIGN KEY (service_id) REFERENCES app_servicio.services(id) ON DELETE CASCADE,
  CONSTRAINT service_phases_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE app_servicio.service_phases ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE app_servicio.service_phases TO authenticated;
GRANT ALL ON TABLE app_servicio.service_phases TO service_role;

CREATE TABLE IF NOT EXISTS app_servicio.service_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  service_id uuid NOT NULL,
  phase_id uuid NOT NULL,
  template_key text NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  description text,
  required boolean DEFAULT true NOT NULL,
  assignee text DEFAULT 'student'::text NOT NULL,
  assignee_user_id uuid,
  visible_to_client boolean DEFAULT true NOT NULL,
  portal_button boolean DEFAULT false NOT NULL,
  ref jsonb DEFAULT '{}'::jsonb NOT NULL,
  due_rule jsonb,
  due_on date,
  due_at timestamp with time zone,
  recurrence jsonb,
  late jsonb,
  reminders jsonb,
  is_recurring_template boolean DEFAULT false NOT NULL,
  parent_item_id uuid,
  occurrence_index integer,
  status text DEFAULT 'pending'::text NOT NULL,
  completed_at timestamp with time zone,
  completed_by_kind text,
  completed_by uuid,
  completed_source text,
  needs_attention boolean DEFAULT false NOT NULL,
  yellow_after_days integer,
  red_after_days integer,
  task_id uuid,
  "position" integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT service_items_pkey PRIMARY KEY (id),
  CONSTRAINT service_items_assignee_check CHECK ((assignee = ANY (ARRAY['student'::text, 'owner'::text, 'user'::text]))),
  CONSTRAINT service_items_by_kind_check CHECK (((completed_by_kind IS NULL) OR (completed_by_kind = ANY (ARRAY['user'::text, 'system'::text, 'client'::text])))),
  CONSTRAINT service_items_kind_check CHECK ((kind = ANY (ARRAY['form'::text, 'survey'::text, 'contract'::text, 'booking'::text, 'quiz'::text, 'activity'::text, 'program_item'::text, 'team_task'::text, 'student_task'::text, 'certificate'::text, 'open_section'::text, 'open_module'::text, 'checkbox'::text]))),
  CONSTRAINT service_items_light_check CHECK ((((yellow_after_days IS NULL) OR (yellow_after_days >= 0)) AND ((red_after_days IS NULL) OR (red_after_days >= 0)) AND ((yellow_after_days IS NULL) OR (red_after_days IS NULL) OR (red_after_days >= yellow_after_days)))),
  CONSTRAINT service_items_occurrence_check CHECK (((parent_item_id IS NULL) = (occurrence_index IS NULL))),
  CONSTRAINT service_items_ref_check CHECK ((jsonb_typeof(ref) = 'object'::text)),
  CONSTRAINT service_items_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text]))),
  CONSTRAINT service_items_assignee_user_id_fkey FOREIGN KEY (assignee_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT service_items_parent_item_id_fkey FOREIGN KEY (parent_item_id) REFERENCES app_servicio.service_items(id) ON DELETE CASCADE,
  CONSTRAINT service_items_phase_id_fkey FOREIGN KEY (phase_id) REFERENCES app_servicio.service_phases(id) ON DELETE CASCADE,
  CONSTRAINT service_items_service_id_fkey FOREIGN KEY (service_id) REFERENCES app_servicio.services(id) ON DELETE CASCADE,
  CONSTRAINT service_items_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE SET NULL,
  CONSTRAINT service_items_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE app_servicio.service_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE app_servicio.service_items TO authenticated;
GRANT ALL ON TABLE app_servicio.service_items TO service_role;

-- ----------------------------------------------------------------------------
-- Claves foraneas hacia tablas de esta area
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  ALTER TABLE public.contact_notes ADD CONSTRAINT contact_notes_service_id_fkey FOREIGN KEY (service_id) REFERENCES app_servicio.services(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.knowledge_base ADD CONSTRAINT knowledge_base_program_item_id_fkey FOREIGN KEY (program_item_id) REFERENCES app_servicio.program_items(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Funciones
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_servicio.as_system()
 RETURNS void
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  SELECT set_config('app_servicio.system', 'on', true);
$function$;
REVOKE ALL ON FUNCTION app_servicio.as_system() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.as_system() TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.assistant_credits_detail(p_contact_id uuid, p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  pr record;
  v_own numeric;
  v_variant numeric;
  v_spent numeric := 0;
BEGIN
  SELECT id, tutor_agent_id, portal_settings INTO pr FROM public.products WHERE id = p_product_id;
  IF pr.id IS NULL THEN RETURN NULL; END IF;
  SELECT a.ai_monthly_limit_usd INTO v_own FROM app_servicio_portal.portal_access a
   WHERE a.contact_id = p_contact_id AND a.product_id = p_product_id AND a.section = 'assistant' AND a.revoked_at IS NULL
     AND a.ai_monthly_limit_usd IS NOT NULL ORDER BY a.created_at DESC LIMIT 1;
  SELECT (app_servicio.portal_section_rule(s.product_variant_id, 'assistant') ->> 'ai_limit_usd')::numeric INTO v_variant
    FROM app_servicio.services s WHERE s.contact_id = p_contact_id AND s.product_id = p_product_id AND s.status IN ('active', 'paused')
   ORDER BY s.created_at DESC LIMIT 1;
  IF pr.tutor_agent_id IS NOT NULL THEN v_spent := app_servicio.assistant_month_spend(p_contact_id, pr.tutor_agent_id); END IF;
  RETURN app_servicio.assistant_credits_plan(jsonb_build_object('own', v_own, 'variant', v_variant,
           'program', pr.portal_settings #> '{assistant,monthly_limit_usd_per_student}', 'spentUsd', v_spent,
           'creditsPerUsd', pr.portal_settings #> '{assistant,credits_per_usd}')) || jsonb_build_object('spentUsd', v_spent);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.assistant_credits_detail(p_contact_id uuid, p_product_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.assistant_credits_detail(p_contact_id uuid, p_product_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.assistant_credits_plan(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_limit numeric := 10;
  v_spent numeric := GREATEST(0, COALESCE((p ->> 'spentUsd')::numeric, 0));
  v_per numeric := GREATEST(0, COALESCE((p ->> 'creditsPerUsd')::numeric, 100));
  k text;
BEGIN
  FOREACH k IN ARRAY ARRAY['own', 'variant', 'program'] LOOP
    IF jsonb_typeof(p -> k) = 'number' AND (p ->> k)::numeric >= 0 THEN v_limit := (p ->> k)::numeric; EXIT; END IF;
  END LOOP;
  RETURN jsonb_build_object('limitUsd', v_limit,
    'credits', GREATEST(0, floor(GREATEST(0, v_limit - v_spent) * v_per + 0.000000001))::bigint,
    'reached', v_spent >= v_limit);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.assistant_credits_plan(p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.assistant_credits_plan(p jsonb) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.assistant_credits(p_contact_id uuid, p_product_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE((app_servicio.assistant_credits_detail(p_contact_id, p_product_id) ->> 'credits')::bigint, 0);
$function$;
REVOKE ALL ON FUNCTION app_servicio.assistant_credits(p_contact_id uuid, p_product_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.assistant_credits(p_contact_id uuid, p_product_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.assistant_set_own_limit(p_service_id uuid, p_limit_usd numeric)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
  n integer;
BEGIN
  s := app_servicio.svc_get(p_service_id);
  PERFORM app_servicio.require_service(s, 'tutor.manage');
  IF p_limit_usd IS NOT NULL AND (p_limit_usd < 0 OR p_limit_usd > 10000) THEN RAISE EXCEPTION 'El límite va de 0 a 10.000 dólares' USING ERRCODE = 'IA002'; END IF;
  UPDATE app_servicio_portal.portal_access SET ai_monthly_limit_usd = p_limit_usd, updated_at = now()
   WHERE service_id = s.id AND section = 'assistant' AND revoked_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'El servicio no tiene acceso al Asistente IA' USING ERRCODE = 'IA002'; END IF;
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'tutor.own_limit', jsonb_build_object('limit_usd', p_limit_usd));
  RETURN n;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.assistant_set_own_limit(p_service_id uuid, p_limit_usd numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.assistant_set_own_limit(p_service_id uuid, p_limit_usd numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.assistant_usage(p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  pr record;
  v_money boolean;
BEGIN
  SELECT id, workspace_id, tutor_agent_id INTO pr FROM public.products WHERE id = p_product_id;
  IF pr.id IS NULL THEN RETURN NULL; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.is_workspace_member(pr.workspace_id)
       AND (public.has_permission(pr.workspace_id, 'services.view') OR public.has_permission(pr.workspace_id, 'tutor.manage'))) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  v_money := app_servicio.is_system() OR public.has_permission(pr.workspace_id, 'ai_costs.view');
  RETURN jsonb_build_object(
    'agent_id', pr.tutor_agent_id,
    'students', COALESCE((SELECT jsonb_agg(jsonb_build_object('contact_id', u.contact_id, 'name', c.display_name,
        'spent_usd', CASE WHEN v_money THEN u.spent END, 'reached', COALESCE((d.detail ->> 'reached')::boolean, false),
        'limit_usd', CASE WHEN v_money THEN (d.detail ->> 'limitUsd')::numeric END) ORDER BY u.spent DESC)
      FROM (SELECT r.contact_id, sum(r.cost_usd) AS spent FROM public.agent_runs r
             WHERE pr.tutor_agent_id IS NOT NULL AND r.agent_id = pr.tutor_agent_id AND r.source = 'portal_tutor' AND r.contact_id IS NOT NULL
               AND r.created_at >= (date_trunc('month', now() AT TIME ZONE app_servicio.ws_tz(pr.workspace_id)) AT TIME ZONE app_servicio.ws_tz(pr.workspace_id))
             GROUP BY r.contact_id) u
      JOIN public.contacts c ON c.id = u.contact_id
      CROSS JOIN LATERAL (SELECT app_servicio.assistant_credits_detail(u.contact_id, pr.id) AS detail) d), '[]'::jsonb),
    'own_limits', COALESCE((SELECT jsonb_agg(jsonb_build_object('contact_id', a.contact_id, 'name', c.display_name, 'limit_usd', CASE WHEN v_money THEN a.ai_monthly_limit_usd END))
      FROM app_servicio_portal.portal_access a JOIN public.contacts c ON c.id = a.contact_id
     WHERE a.product_id = pr.id AND a.section = 'assistant' AND a.revoked_at IS NULL AND a.ai_monthly_limit_usd IS NOT NULL), '[]'::jsonb),
    'money', v_money);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.assistant_usage(p_product_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.assistant_usage(p_product_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.attendance_base_plan(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN NOT COALESCE((p #>> '{member,calendarAccess}')::boolean, false) THEN false
    WHEN jsonb_typeof(p -> 'sessionVariantIds') = 'array'
         AND (NULLIF(p #>> '{member,variantId}', '') IS NULL OR NOT ((p -> 'sessionVariantIds') ? (p #>> '{member,variantId}'))) THEN false
    WHEN p #>> '{base,type}' = 'active' THEN true
    WHEN p #>> '{base,type}' = 'started_within' THEN NULLIF(p #>> '{member,serviceStartsOn}', '') IS NOT NULL
         AND (p #>> '{member,serviceStartsOn}')::date <= (p ->> 'occursOn')::date
         AND (p ->> 'occursOn')::date - (p #>> '{member,serviceStartsOn}')::date <= (p #>> '{base,days}')::integer
    WHEN p #>> '{base,type}' = 'phase' THEN p #>> '{member,phaseKeyOnDate}' = p #>> '{base,phase_key}'
    WHEN p #>> '{base,type}' = 'variant' THEN p #>> '{member,variantId}' = p #>> '{base,variant_id}'
    ELSE false END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.attendance_base_plan(p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.attendance_base_plan(p jsonb) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.attendance_mark(p_live_session_id uuid, p_occurs_on date, p_contact_id uuid, p_source text DEFAULT 'team'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  ls record;
  v_id uuid;
  v_in_base boolean;
BEGIN
  SELECT id, workspace_id INTO ls FROM app_servicio.live_sessions WHERE id = p_live_session_id;
  IF ls.id IS NULL THEN RAISE EXCEPTION 'No existe la sesión' USING ERRCODE = 'CA002'; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.has_permission(ls.workspace_id, 'attendance.manage')
       AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = p_contact_id AND c.workspace_id = ls.workspace_id AND public.can_see_contact(c))) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = p_contact_id AND c.workspace_id = ls.workspace_id) THEN
    RAISE EXCEPTION 'No existe el contacto' USING ERRCODE = 'CA002';
  END IF;
  -- Solo el sistema (el portal) marca `self` o `click`; una persona del equipo siempre marca `team`.
  IF NOT app_servicio.is_system() THEN p_source := 'team'; END IF;
  SELECT id INTO v_id FROM app_servicio_portal.live_attendance
   WHERE live_session_id = ls.id AND occurs_on = p_occurs_on AND contact_id = p_contact_id AND removed_at IS NULL;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  v_in_base := EXISTS (SELECT 1 FROM app_servicio.attendance_base_members(ls.id, p_occurs_on) b WHERE b.contact_id = p_contact_id);
  INSERT INTO app_servicio_portal.live_attendance (workspace_id, live_session_id, occurs_on, contact_id, source, added_manually, marked_by)
  VALUES (ls.workspace_id, ls.id, p_occurs_on, p_contact_id, CASE WHEN p_source IN ('self', 'team', 'click') THEN p_source ELSE 'team' END,
          p_source = 'team' AND NOT v_in_base, CASE WHEN app_servicio.is_system() THEN NULL ELSE auth.uid() END)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  PERFORM app_servicio.audit(ls.workspace_id, 'contact', p_contact_id, 'attendance.marked',
    jsonb_build_object('live_session_id', ls.id, 'occurs_on', p_occurs_on, 'source', p_source, 'in_base', v_in_base));
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.attendance_mark(p_live_session_id uuid, p_occurs_on date, p_contact_id uuid, p_source text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.attendance_mark(p_live_session_id uuid, p_occurs_on date, p_contact_id uuid, p_source text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.attendance_remove(p_attendance_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM app_servicio_portal.live_attendance WHERE id = p_attendance_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'No existe esa asistencia' USING ERRCODE = 'CA002'; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.has_permission(a.workspace_id, 'attendance.manage')
       AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = a.contact_id AND public.can_see_contact(c))) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'CA001'; END IF;
  IF a.removed_at IS NOT NULL THEN RETURN; END IF;
  UPDATE app_servicio_portal.live_attendance SET removed_at = now(), removed_by = auth.uid(), removed_reason = btrim(p_reason) WHERE id = a.id;
  PERFORM app_servicio.audit(a.workspace_id, 'contact', a.contact_id, 'attendance.removed',
    jsonb_build_object('live_session_id', a.live_session_id, 'occurs_on', a.occurs_on, 'reason', btrim(p_reason)));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.attendance_remove(p_attendance_id uuid, p_reason text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.attendance_remove(p_attendance_id uuid, p_reason text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.audit(p_workspace_id uuid, p_entity_type text, p_entity_id uuid, p_action text, p_changes jsonb, p_actor text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor text := COALESCE(p_actor, CASE WHEN app_servicio.is_system() THEN 'system' ELSE 'user' END);
BEGIN
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, performed_by, actor_type, actor_label)
  VALUES (p_workspace_id, p_entity_type, p_entity_id, p_action, p_changes,
          CASE WHEN v_actor = 'user' THEN auth.uid() END,
          CASE WHEN v_actor = 'client' THEN 'system' ELSE v_actor END,
          CASE WHEN v_actor = 'client' THEN 'cliente' END);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.audit(p_workspace_id uuid, p_entity_type text, p_entity_id uuid, p_action text, p_changes jsonb, p_actor text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.audit(p_workspace_id uuid, p_entity_type text, p_entity_id uuid, p_action text, p_changes jsonb, p_actor text) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.booking_area_clase_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  PERFORM app_servicio.ensure_clase_type(NEW.workspace_id);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'app_servicio.booking_area_clase_hook: %', SQLERRM;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.booking_area_clase_hook() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.booking_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  -- `record` y no el tipo de la tabla del modulo: un tipo se resuelve al ENTRAR a la funcion, antes del bloque que
  -- atrapa los errores, y un problema con la tabla haria fallar la operacion de BAIOS (verify-services, sv2).
  v_when text;
  it record;
  v_count integer;
  v_signed uuid;
  v_prev_system text := COALESCE(current_setting('app_servicio.system', true), '');
BEGIN
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    PERFORM app_servicio.as_system();
    IF NEW.contact_id IS NULL OR NEW.status LIKE 'cancelled%' THEN
      PERFORM set_config('app_servicio.system', v_prev_system, true);
      RETURN NULL;
    END IF;
    -- booked: al agendar. attended: al pasar a un resultado (status_group = outcome).
    v_when := CASE WHEN TG_OP = 'INSERT' THEN 'booked'
                   WHEN NEW.status_group = 'outcome' AND OLD.status_group IS DISTINCT FROM 'outcome' THEN 'attended' END;
    IF v_when IS NOT NULL THEN
      -- El paso que viene en el link de la agenda, solo si es del mismo contacto.
      IF (NEW.utm ->> 'svc_item') ~* '^[0-9a-f-]{36}$' THEN
        SELECT i.id INTO v_signed FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id
         WHERE i.id = (NEW.utm ->> 'svc_item')::uuid AND s.contact_id = NEW.contact_id AND s.workspace_id = NEW.workspace_id;
      END IF;
      SELECT count(DISTINCT i.service_id) INTO v_count
        FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id JOIN app_servicio.service_phases ph ON ph.id = i.phase_id
       WHERE s.workspace_id = NEW.workspace_id AND s.contact_id = NEW.contact_id AND s.status = 'active' AND i.status = 'pending'
         AND i.kind = 'booking' AND i.ref ->> 'event_type_id' = NEW.event_type_id::text AND COALESCE(i.ref ->> 'complete_on', 'booked') = v_when
         AND ph.status <> 'completed' AND (v_signed IS NULL OR i.id = v_signed);
      IF v_count > 0 THEN
        SELECT i.* INTO it
          FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id JOIN app_servicio.service_phases ph ON ph.id = i.phase_id
         WHERE s.workspace_id = NEW.workspace_id AND s.contact_id = NEW.contact_id AND s.status = 'active' AND i.status = 'pending'
           AND i.kind = 'booking' AND i.ref ->> 'event_type_id' = NEW.event_type_id::text AND COALESCE(i.ref ->> 'complete_on', 'booked') = v_when
           AND ph.status <> 'completed' AND (v_signed IS NULL OR i.id = v_signed)
         ORDER BY s.created_at, (ph.status = 'in_progress') DESC, ph.position, i.position LIMIT 1;
        IF v_count > 1 THEN
          PERFORM app_servicio.audit(NEW.workspace_id, 'service_item', it.id, 'svc.item_ambiguous',
            jsonb_build_object('service_id', it.service_id, 'event_type_id', NEW.event_type_id, 'services', v_count), 'system');
        END IF;
        PERFORM app_servicio.svc_mark_item(it.id, 'booking_' || v_when, 'client', NULL);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'booking', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  PERFORM set_config('app_servicio.system', v_prev_system, true);
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.booking_hook() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.can_see_service_row(s app_servicio.services)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(
    public.is_workspace_member(s.workspace_id)
    AND public.has_permission(s.workspace_id, 'services.view')
    AND (
      public.permission_scope(s.workspace_id, 'services') = 'all'
      OR s.owner_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.contacts c
        WHERE c.id = s.contact_id AND (c.setter_id = auth.uid() OR c.vendedor_id = auth.uid())
      )
    ),
    false);
$function$;
REVOKE ALL ON FUNCTION app_servicio.can_see_service_row(s app_servicio.services) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.can_see_service_row(s app_servicio.services) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.can_see_service(p_service_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE((SELECT app_servicio.can_see_service_row(s) FROM app_servicio.services s WHERE s.id = p_service_id), false);
$function$;
REVOKE ALL ON FUNCTION app_servicio.can_see_service(p_service_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.can_see_service(p_service_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.can_see_audit_entity(p_entity_type text, p_entity_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(CASE p_entity_type
    WHEN 'service' THEN app_servicio.can_see_service(p_entity_id)
    WHEN 'service_phase' THEN (SELECT app_servicio.can_see_service(ph.service_id) FROM app_servicio.service_phases ph WHERE ph.id = p_entity_id)
    WHEN 'service_item' THEN (SELECT app_servicio.can_see_service(i.service_id) FROM app_servicio.service_items i WHERE i.id = p_entity_id)
    ELSE false END, false);
$function$;
REVOKE ALL ON FUNCTION app_servicio.can_see_audit_entity(p_entity_type text, p_entity_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.can_see_audit_entity(p_entity_type text, p_entity_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.can_view_as_student(p_workspace_id uuid, p_contact_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(
    public.is_workspace_member(p_workspace_id)
    AND public.has_permission(p_workspace_id, 'portal.view_as')
    AND (
      public.permission_scope(p_workspace_id, 'services') = 'all'
      OR EXISTS (
        SELECT 1 FROM public.contacts c
        WHERE c.id = p_contact_id AND c.workspace_id = p_workspace_id
          AND (c.setter_id = auth.uid() OR c.vendedor_id = auth.uid())
      )
      OR EXISTS (
        SELECT 1 FROM app_servicio.services s
        WHERE s.workspace_id = p_workspace_id AND s.contact_id = p_contact_id AND s.owner_user_id = auth.uid()
      )
    ),
    false);
$function$;
REVOKE ALL ON FUNCTION app_servicio.can_view_as_student(p_workspace_id uuid, p_contact_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.can_view_as_student(p_workspace_id uuid, p_contact_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.community_can_post_check(p_contact_id uuid, p_product_id uuid, p_space text, p_program_item_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_settings jsonb;
  v_item jsonb := NULL;
  it record;
  v_access boolean := false;
  v_muted boolean := false;
BEGIN
  SELECT portal_settings INTO v_settings FROM public.products WHERE id = p_product_id;
  IF p_contact_id IS NOT NULL THEN
    SELECT bool_or(a.starts_at <= now() AND (a.ends_at IS NULL OR a.ends_at > now()) AND a.revoked_at IS NULL
                   AND a.suspended_overdue_at IS NULL AND a.suspended_pause_at IS NULL),
           bool_or(a.muted_at IS NOT NULL)
      INTO v_access, v_muted
      FROM app_servicio_portal.portal_access a
     WHERE a.contact_id = p_contact_id AND a.product_id = p_product_id AND a.section = 'community';
  END IF;
  IF p_program_item_id IS NOT NULL THEN
    SELECT id, status, comments_enabled INTO it FROM app_servicio.program_items WHERE id = p_program_item_id AND product_id = p_product_id AND kind = 'lesson';
    IF it.id IS NOT NULL THEN
      v_item := jsonb_build_object('active', it.status = 'active', 'commentsEnabled', it.comments_enabled,
        'unlocked', CASE WHEN p_contact_id IS NULL THEN true ELSE COALESCE((app_servicio.program_item_unlocked(p_contact_id, it.id) ->> 'unlocked')::boolean, false) END);
    END IF;
  END IF;
  RETURN app_servicio.community_can_post_plan(jsonb_build_object(
    'author', CASE WHEN p_contact_id IS NULL THEN 'team' ELSE 'student' END,
    'sectionOn', app_servicio.portal_section_enabled(p_product_id, 'community'),
    'hasAccess', COALESCE(v_access, false),
    'muted', COALESCE(v_muted, false),
    'space', (SELECT x FROM jsonb_array_elements(app_servicio.community_spaces(p_product_id)) x WHERE x ->> 'key' = p_space LIMIT 1),
    'lessonComment', p_program_item_id IS NOT NULL,
    'lessonCommentsOn', COALESCE(v_settings #>> '{community,lesson_comments}', 'true') <> 'false',
    'item', v_item));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.community_can_post_check(p_contact_id uuid, p_product_id uuid, p_space text, p_program_item_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.community_can_post_check(p_contact_id uuid, p_product_id uuid, p_space text, p_program_item_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.community_can_post_plan(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_team boolean := p ->> 'author' = 'team';
  v_item jsonb := CASE WHEN jsonb_typeof(p -> 'item') = 'object' THEN p -> 'item' END;
  v_space jsonb := CASE WHEN jsonb_typeof(p -> 'space') = 'object' THEN p -> 'space' END;
BEGIN
  IF COALESCE((p ->> 'lessonComment')::boolean, false) THEN
    IF v_item IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'No existe la clase'); END IF;
    IF NOT COALESCE((p ->> 'lessonCommentsOn')::boolean, false) OR NOT COALESCE((v_item ->> 'commentsEnabled')::boolean, false) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'Los comentarios de esta clase están apagados');
    END IF;
    IF v_team THEN RETURN jsonb_build_object('ok', true); END IF;
    IF COALESCE((p ->> 'muted')::boolean, false) THEN RETURN jsonb_build_object('ok', false, 'reason', 'Estás silenciado en la comunidad'); END IF;
    IF NOT COALESCE((v_item ->> 'active')::boolean, false) OR NOT COALESCE((v_item ->> 'unlocked')::boolean, false) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'Esta clase todavía no está abierta');
    END IF;
    RETURN jsonb_build_object('ok', true);
  END IF;
  IF v_space IS NULL OR COALESCE((v_space ->> 'archived')::boolean, false) THEN RETURN jsonb_build_object('ok', false, 'reason', 'No existe ese espacio'); END IF;
  IF v_team THEN RETURN jsonb_build_object('ok', true); END IF;
  IF NOT COALESCE((p ->> 'sectionOn')::boolean, false) THEN RETURN jsonb_build_object('ok', false, 'reason', 'La comunidad está apagada'); END IF;
  IF NOT COALESCE((p ->> 'hasAccess')::boolean, false) THEN RETURN jsonb_build_object('ok', false, 'reason', 'No tenés acceso a la comunidad'); END IF;
  IF COALESCE((p ->> 'muted')::boolean, false) THEN RETURN jsonb_build_object('ok', false, 'reason', 'Estás silenciado en la comunidad'); END IF;
  IF COALESCE((v_space ->> 'team_only')::boolean, false) THEN RETURN jsonb_build_object('ok', false, 'reason', 'En este espacio publica solo el equipo'); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.community_can_post_plan(p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.community_can_post_plan(p jsonb) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.community_can_post(p_contact_id uuid, p_product_id uuid, p_space text, p_program_item_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE((app_servicio.community_can_post_check(p_contact_id, p_product_id, p_space, p_program_item_id) ->> 'ok')::boolean, false);
$function$;
REVOKE ALL ON FUNCTION app_servicio.community_can_post(p_contact_id uuid, p_product_id uuid, p_space text, p_program_item_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.community_can_post(p_contact_id uuid, p_product_id uuid, p_space text, p_program_item_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.community_feed(p_product_id uuid, p jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws uuid;
  v_filter text := COALESCE(p ->> 'filter', 'all');
  v_limit integer := LEAST(100, GREATEST(1, COALESCE((p ->> 'limit')::integer, 30)));
BEGIN
  SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF NOT app_servicio.is_system() THEN PERFORM app_servicio.require_permission(v_ws, 'community.view'); END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY (row ->> 'pinned') DESC, (row ->> 'created_at') DESC)
      FROM (
        SELECT jsonb_build_object(
          'id', t.id, 'space_key', t.space_key, 'program_item_id', t.program_item_id, 'body', t.body, 'media', t.media,
          'author_contact_id', t.author_contact_id, 'author_name', c.display_name, 'author_user_id', t.author_user_id, 'as_business', t.as_business,
          'pinned', t.pinned_at IS NOT NULL, 'hidden', t.hidden_at IS NOT NULL, 'hidden_reason', t.hidden_reason, 'seen', t.team_seen_at IS NOT NULL,
          'deleted', t.deleted_at IS NOT NULL, 'created_at', t.created_at, 'edited_at', t.edited_at,
          'unanswered', app_servicio.community_is_unanswered(t.id),
          'reactions', COALESCE((SELECT jsonb_object_agg(k.kind, k.n) FROM (SELECT kind, count(*)::int n FROM app_servicio_portal.community_reactions WHERE post_id = t.id AND kind <> 'report' GROUP BY kind) k), '{}'::jsonb),
          'reports', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.report_reason, 'created_at', r.created_at)) FROM app_servicio_portal.community_reactions r WHERE r.post_id = t.id AND r.kind = 'report' AND r.resolved_at IS NULL), '[]'::jsonb),
          'replies', COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'id', x.id, 'body', x.body, 'author_contact_id', x.author_contact_id, 'author_name', xc.display_name, 'author_user_id', x.author_user_id,
              'as_business', x.as_business, 'hidden', x.hidden_at IS NOT NULL, 'created_at', x.created_at) ORDER BY x.created_at)
            FROM app_servicio_portal.community_posts x LEFT JOIN public.contacts xc ON xc.id = x.author_contact_id
           WHERE x.parent_id = t.id AND x.deleted_at IS NULL), '[]'::jsonb)) AS row
          FROM app_servicio_portal.community_posts t
          LEFT JOIN public.contacts c ON c.id = t.author_contact_id
         WHERE t.product_id = p_product_id AND t.parent_id IS NULL AND t.deleted_at IS NULL
           AND (NULLIF(p ->> 'space', '') IS NULL OR t.space_key = p ->> 'space')
           AND (NULLIF(p ->> 'program_item_id', '') IS NULL OR t.program_item_id = (p ->> 'program_item_id')::uuid)
           AND (NULLIF(p ->> 'before', '') IS NULL OR t.created_at < (p ->> 'before')::timestamptz)
           AND (v_filter <> 'unanswered' OR (t.created_at >= now() - interval '30 days' AND app_servicio.community_is_unanswered(t.id)))
           AND (v_filter <> 'reported' OR EXISTS (SELECT 1 FROM app_servicio_portal.community_reactions r WHERE r.post_id = t.id AND r.kind = 'report' AND r.resolved_at IS NULL))
         ORDER BY t.pinned_at DESC NULLS LAST, t.created_at DESC
         LIMIT v_limit) q), '[]'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.community_feed(p_product_id uuid, p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.community_feed(p_product_id uuid, p jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.community_is_unanswered(p_post_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM app_servicio_portal.community_posts p
     WHERE p.id = p_post_id AND p.parent_id IS NULL AND p.author_contact_id IS NOT NULL AND p.deleted_at IS NULL AND p.hidden_at IS NULL
       AND p.team_seen_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM app_servicio_portal.community_posts r
                        WHERE r.parent_id = p.id AND r.author_contact_id IS NULL AND r.deleted_at IS NULL));
$function$;
REVOKE ALL ON FUNCTION app_servicio.community_is_unanswered(p_post_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.community_is_unanswered(p_post_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.community_item_counts(p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws uuid;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RETURN '{}'::jsonb; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.is_workspace_member(v_ws) AND (public.has_permission(v_ws, 'community.view') OR public.has_permission(v_ws, 'program.manage'))) THEN
    RETURN '{}'::jsonb;
  END IF;
  RETURN jsonb_build_object(
    'unanswered', app_servicio.community_unanswered(p_product_id, 30),
    'reported', (SELECT count(DISTINCT r.post_id)::int FROM app_servicio_portal.community_reactions r JOIN app_servicio_portal.community_posts t ON t.id = r.post_id
                  WHERE t.product_id = p_product_id AND r.kind = 'report' AND r.resolved_at IS NULL AND t.deleted_at IS NULL),
    'by_item', COALESCE((SELECT jsonb_object_agg(item, n) FROM (
        SELECT t.program_item_id AS item, count(*)::int n FROM app_servicio_portal.community_posts t
         WHERE t.product_id = p_product_id AND t.program_item_id IS NOT NULL AND t.created_at >= now() - interval '30 days'
           AND app_servicio.community_is_unanswered(t.id) GROUP BY 1) z), '{}'::jsonb));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.community_item_counts(p_product_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.community_item_counts(p_product_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.community_mark_seen(p_post_id uuid, p_seen boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws uuid;
BEGIN
  SELECT workspace_id INTO v_ws FROM app_servicio_portal.community_posts WHERE id = p_post_id;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'No existe ese post' USING ERRCODE = 'CO002'; END IF;
  PERFORM app_servicio.require_permission(v_ws, 'community.reply');
  UPDATE app_servicio_portal.community_posts SET team_seen_at = CASE WHEN p_seen THEN COALESCE(team_seen_at, now()) END WHERE id = p_post_id;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.community_mark_seen(p_post_id uuid, p_seen boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.community_mark_seen(p_post_id uuid, p_seen boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.community_moderate(p_post_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  t record;
BEGIN
  SELECT id, workspace_id, product_id, parent_id INTO t FROM app_servicio_portal.community_posts WHERE id = p_post_id;
  IF t.id IS NULL THEN RAISE EXCEPTION 'No existe ese post' USING ERRCODE = 'CO002'; END IF;
  PERFORM app_servicio.require_permission(t.workspace_id, 'community.moderate');
  IF p_action = 'pin' THEN
    IF t.parent_id IS NOT NULL THEN RAISE EXCEPTION 'Solo se fija un post' USING ERRCODE = 'CO002'; END IF;
    UPDATE app_servicio_portal.community_posts SET pinned_at = now() WHERE id = t.id;
  ELSIF p_action = 'unpin' THEN
    UPDATE app_servicio_portal.community_posts SET pinned_at = NULL WHERE id = t.id;
  ELSIF p_action = 'hide' THEN
    IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'CO002'; END IF;
    UPDATE app_servicio_portal.community_posts SET hidden_at = now(), hidden_by = auth.uid(), hidden_reason = btrim(p_reason) WHERE id = t.id;
  ELSIF p_action = 'unhide' THEN
    UPDATE app_servicio_portal.community_posts SET hidden_at = NULL, hidden_by = NULL, hidden_reason = NULL WHERE id = t.id;
  ELSIF p_action = 'delete' THEN
    UPDATE app_servicio_portal.community_posts SET deleted_at = COALESCE(deleted_at, now()) WHERE id = t.id;
  ELSE
    RAISE EXCEPTION 'Acción desconocida' USING ERRCODE = 'CO002';
  END IF;
  PERFORM app_servicio.audit(t.workspace_id, 'product', t.product_id, 'community.' || p_action, jsonb_build_object('post_id', t.id, 'reason', NULLIF(btrim(COALESCE(p_reason, '')), '')));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.community_moderate(p_post_id uuid, p_action text, p_reason text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.community_moderate(p_post_id uuid, p_action text, p_reason text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.community_post_structure()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  par record;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT id, parent_id, product_id, space_key, program_item_id, workspace_id INTO par FROM app_servicio_portal.community_posts WHERE id = NEW.parent_id;
    IF par.id IS NULL OR par.parent_id IS NOT NULL OR par.product_id <> NEW.product_id THEN
      RAISE EXCEPTION 'Un comentario va debajo de un post, no de otro comentario' USING ERRCODE = 'CO001';
    END IF;
    NEW.space_key := par.space_key;
    NEW.program_item_id := par.program_item_id;
    NEW.workspace_id := par.workspace_id;
  END IF;
  IF NEW.program_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app_servicio.program_items i WHERE i.id = NEW.program_item_id AND i.product_id = NEW.product_id AND i.kind = 'lesson') THEN
    RAISE EXCEPTION 'La clase no es de este programa' USING ERRCODE = 'CO001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = NEW.product_id AND p.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'El programa no es de este negocio' USING ERRCODE = 'CO001';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.community_post_structure() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.community_resolve_report(p_reaction_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  r record;
BEGIN
  SELECT id, workspace_id, post_id, kind INTO r FROM app_servicio_portal.community_reactions WHERE id = p_reaction_id;
  IF r.id IS NULL OR r.kind <> 'report' THEN RAISE EXCEPTION 'No existe ese reporte' USING ERRCODE = 'CO002'; END IF;
  PERFORM app_servicio.require_permission(r.workspace_id, 'community.moderate');
  UPDATE app_servicio_portal.community_reactions SET resolved_at = COALESCE(resolved_at, now()), resolved_by = auth.uid() WHERE id = r.id;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.community_resolve_report(p_reaction_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.community_resolve_report(p_reaction_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.community_set_muted(p_product_id uuid, p_contact_id uuid, p_muted boolean, p_reason text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws uuid;
  n integer;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'No existe el programa' USING ERRCODE = 'CO002'; END IF;
  PERFORM app_servicio.require_permission(v_ws, 'community.moderate');
  IF p_muted AND NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'CO002'; END IF;
  UPDATE app_servicio_portal.portal_access SET muted_at = CASE WHEN p_muted THEN COALESCE(muted_at, now()) END
   WHERE contact_id = p_contact_id AND product_id = p_product_id AND section = 'community';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'Ese estudiante no tiene acceso a la comunidad' USING ERRCODE = 'CO002'; END IF;
  PERFORM app_servicio.audit(v_ws, 'contact', p_contact_id, CASE WHEN p_muted THEN 'community.muted' ELSE 'community.unmuted' END,
    jsonb_build_object('product_id', p_product_id, 'reason', NULLIF(btrim(COALESCE(p_reason, '')), '')));
  RETURN n;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.community_set_muted(p_product_id uuid, p_contact_id uuid, p_muted boolean, p_reason text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.community_set_muted(p_product_id uuid, p_contact_id uuid, p_muted boolean, p_reason text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.community_spaces(p_product_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(p.portal_settings #> '{community,spaces}') = 'array' THEN p.portal_settings #> '{community,spaces}'
                ELSE '[{"key":"anuncios","name":"Anuncios","team_only":true},{"key":"general","name":"General"},{"key":"victorias","name":"Victorias"}]'::jsonb END) x
         WHERE x ->> 'key' IS DISTINCT FROM 'clases'), '[]'::jsonb)
    FROM public.products p WHERE p.id = p_product_id;
$function$;
REVOKE ALL ON FUNCTION app_servicio.community_spaces(p_product_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.community_spaces(p_product_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.community_team_post(p_product_id uuid, p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws uuid;
  v_parent_id uuid := NULL;
  v_space text := p ->> 'space_key';
  v_item uuid := NULLIF(p ->> 'program_item_id', '')::uuid;
  v_check jsonb;
  v_id uuid;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'No existe el programa' USING ERRCODE = 'CO002'; END IF;
  PERFORM app_servicio.require_permission(v_ws, 'community.reply');
  IF NULLIF(btrim(p ->> 'body'), '') IS NULL THEN RAISE EXCEPTION 'Escribí el mensaje' USING ERRCODE = 'CO002'; END IF;
  IF NULLIF(p ->> 'parent_id', '') IS NOT NULL THEN
    SELECT id, space_key, program_item_id INTO v_parent_id, v_space, v_item FROM app_servicio_portal.community_posts
     WHERE id = (p ->> 'parent_id')::uuid AND product_id = p_product_id AND deleted_at IS NULL;
    IF v_parent_id IS NULL THEN RAISE EXCEPTION 'No existe ese post' USING ERRCODE = 'CO002'; END IF;
  ELSE
    IF v_item IS NOT NULL THEN v_space := 'clases'; END IF;
    v_check := app_servicio.community_can_post_check(NULL, p_product_id, v_space, v_item);
    IF NOT COALESCE((v_check ->> 'ok')::boolean, false) THEN RAISE EXCEPTION '%', v_check ->> 'reason' USING ERRCODE = 'CO002'; END IF;
  END IF;
  INSERT INTO app_servicio_portal.community_posts (workspace_id, product_id, space_key, parent_id, program_item_id, author_user_id, as_business, body)
  VALUES (v_ws, p_product_id, v_space, v_parent_id, v_item, auth.uid(), COALESCE((p ->> 'as_business')::boolean, false), btrim(p ->> 'body'))
  RETURNING id INTO v_id;
  PERFORM app_servicio.audit(v_ws, 'product', p_product_id, CASE WHEN v_parent_id IS NULL THEN 'community.posted' ELSE 'community.replied' END,
    jsonb_build_object('post_id', v_id, 'parent_id', v_parent_id, 'space_key', v_space));
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.community_team_post(p_product_id uuid, p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.community_team_post(p_product_id uuid, p jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.community_unanswered(p_product_id uuid, p_days integer DEFAULT 30)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT count(*)::int FROM app_servicio_portal.community_posts p
   WHERE p.product_id = p_product_id AND p.created_at >= now() - make_interval(days => GREATEST(1, LEAST(COALESCE(p_days, 30), 365)))
     AND app_servicio.community_is_unanswered(p.id);
$function$;
REVOKE ALL ON FUNCTION app_servicio.community_unanswered(p_product_id uuid, p_days integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.community_unanswered(p_product_id uuid, p_days integer) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.config_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'workspaces' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.services_enabled := false;
      NEW.portal_settings := '{}'::jsonb;
      NEW.portal_settings_rev := 0;
    ELSIF NEW.services_enabled IS DISTINCT FROM OLD.services_enabled
       OR NEW.portal_settings IS DISTINCT FROM OLD.portal_settings
       OR NEW.portal_settings_rev IS DISTINCT FROM OLD.portal_settings_rev THEN
      RAISE EXCEPTION 'La configuración del módulo se cambia desde sus pantallas' USING ERRCODE = 'SV003';
    END IF;
  ELSIF TG_TABLE_NAME = 'products' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.portal_enabled := false;
      NEW.portal_settings := '{}'::jsonb;
      NEW.portal_settings_rev := 0;
    ELSIF NEW.portal_enabled IS DISTINCT FROM OLD.portal_enabled
       OR NEW.portal_settings IS DISTINCT FROM OLD.portal_settings
       OR NEW.portal_settings_rev IS DISTINCT FROM OLD.portal_settings_rev THEN
      RAISE EXCEPTION 'La configuración del módulo se cambia desde sus pantallas' USING ERRCODE = 'SV003';
    END IF;
  ELSIF TG_TABLE_NAME = 'product_variants' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.journey_template := '{"v":1,"phases":[]}'::jsonb;
      NEW.journey_template_rev := 0;
      NEW.service_settings := '{}'::jsonb;
      NEW.service_settings_rev := 0;
      NEW.portal_settings := '{}'::jsonb;
      NEW.portal_settings_rev := 0;
    ELSIF NEW.journey_template IS DISTINCT FROM OLD.journey_template
       OR NEW.journey_template_rev IS DISTINCT FROM OLD.journey_template_rev
       OR NEW.service_settings IS DISTINCT FROM OLD.service_settings
       OR NEW.service_settings_rev IS DISTINCT FROM OLD.service_settings_rev
       OR NEW.portal_settings IS DISTINCT FROM OLD.portal_settings
       OR NEW.portal_settings_rev IS DISTINCT FROM OLD.portal_settings_rev THEN
      RAISE EXCEPTION 'La configuración del módulo se cambia desde sus pantallas' USING ERRCODE = 'SV003';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.config_guard() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.contact_email_portal_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_email text;
BEGIN
  BEGIN
    IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
    v_email := NULLIF(lower(btrim(COALESCE(NEW.email, ''))), '');
    IF v_email IS NULL OR v_email IS NOT DISTINCT FROM NULLIF(lower(btrim(COALESCE(OLD.email, ''))), '') THEN RETURN NULL; END IF;
    IF NOT EXISTS (SELECT 1 FROM app_servicio_portal.portal_accounts WHERE workspace_id = NEW.workspace_id AND contact_id = NEW.id) THEN RETURN NULL; END IF;
    IF EXISTS (SELECT 1 FROM app_servicio_portal.portal_accounts WHERE workspace_id = NEW.workspace_id AND email = v_email AND contact_id <> NEW.id) THEN
      INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, actor_type, actor_label)
      VALUES (NEW.workspace_id, 'contact', NEW.id, 'portal.account_email_conflict', '{}'::jsonb, 'system', 'servicios');
      RETURN NULL;
    END IF;
    UPDATE app_servicio_portal.portal_accounts SET email = v_email, updated_at = now() WHERE workspace_id = NEW.workspace_id AND contact_id = NEW.id;
    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, actor_type, actor_label)
    VALUES (NEW.workspace_id, 'contact', NEW.id, 'portal.account_email_changed', '{}'::jsonb, 'system', 'servicios');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'contact_email_portal_hook: %', SQLERRM;
    BEGIN
      INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, actor_type, actor_label)
      VALUES (NEW.workspace_id, 'contact', NEW.id, 'svc.hook_failed', jsonb_build_object('hook', 'contact_email', 'error', left(SQLSTATE || ' ' || SQLERRM, 300)), 'system', 'servicios');
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'contact_email_portal_hook (audit): %', SQLERRM;
    END;
  END;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.contact_email_portal_hook() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.contacts_portal_summary(p_contact_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  IF p_contact_ids IS NULL OR cardinality(p_contact_ids) = 0 THEN RETURN '[]'::jsonb; END IF;
  IF cardinality(p_contact_ids) > 500 THEN RAISE EXCEPTION 'Hasta 500 contactos por consulta' USING ERRCODE = 'SV004'; END IF;
  -- Solo los contactos con algun servicio que quien llama puede ver (el mismo alcance de Clientes).
  SELECT array_agg(DISTINCT s.contact_id) INTO v_ids
    FROM app_servicio.services s
   WHERE s.contact_id = ANY (p_contact_ids) AND (app_servicio.is_system() OR app_servicio.can_see_service_row(s));
  IF v_ids IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'contact_id', c,
      'account_status', pa.status,
      'last_login_at', pa.last_login_at,
      'invite_sent_at', pa.invite_sent_at,
      'pending_reviews', (
        SELECT count(*) FROM public.form_submissions fs JOIN public.forms f ON f.id = fs.form_id
         WHERE fs.contact_id = c AND f.type = 'activity' AND fs.context = 'portal'
           AND (fs.review_status IS NULL OR fs.review_status = 'pending')),
      'access_expiring_on', (
        SELECT min(app_servicio.local_date(x.ends_at, x.workspace_id)) FROM app_servicio_portal.portal_access x
         WHERE x.contact_id = c AND x.revoked_at IS NULL AND x.ends_at IS NOT NULL
           AND x.ends_at >= now() AND x.ends_at < now() + interval '7 days')))
      FROM unnest(v_ids) c
      LEFT JOIN LATERAL (
        SELECT a.status, a.last_login_at, a.invite_sent_at FROM app_servicio_portal.portal_accounts a
         WHERE a.contact_id = c ORDER BY a.created_at DESC LIMIT 1) pa ON true
  ), '[]'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.contacts_portal_summary(p_contact_ids uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.contacts_portal_summary(p_contact_ids uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.contract_version()
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$ SELECT '1'::text; $function$;
REVOKE ALL ON FUNCTION app_servicio.contract_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.contract_version() TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.emit_service(p_service_id uuid, p_event text, p_extra jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NOT NULL THEN PERFORM app_servicio.emit(s, p_event, p_extra); END IF;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.emit_service(p_service_id uuid, p_event text, p_extra jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.emit_service(p_service_id uuid, p_event text, p_extra jsonb) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.emit(p_service app_servicio.services, p_event text, p_extra jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT app_servicio.module_on(p_service.workspace_id) THEN RETURN; END IF;
  PERFORM public.emit_automation_event(p_service.workspace_id, p_event, p_service.contact_id,
    jsonb_build_object('service_id', p_service.id, 'product_id', p_service.product_id, 'variant_id', p_service.product_variant_id,
                       'service_status', p_service.status) || COALESCE(p_extra, '{}'::jsonb));
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'app_servicio.emit %: %', p_event, SQLERRM;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.emit(p_service app_servicio.services, p_event text, p_extra jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.emit(p_service app_servicio.services, p_event text, p_extra jsonb) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.end_of_day(p_day date, p_tz text)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT ((p_day + 1)::timestamp AT TIME ZONE COALESCE(NULLIF(p_tz, ''), 'UTC')) - interval '1 second';
$function$;
REVOKE ALL ON FUNCTION app_servicio.end_of_day(p_day date, p_tz text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.end_of_day(p_day date, p_tz text) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.attendance_base_members(p_live_session_id uuid, p_occurs_on date)
 RETURNS TABLE(contact_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH ls AS (SELECT * FROM app_servicio.live_sessions WHERE id = p_live_session_id),
  day_end AS (SELECT app_servicio.end_of_day(p_occurs_on, ls.timezone) AS t FROM ls)
  SELECT DISTINCT s.contact_id
    FROM ls, day_end, app_servicio.services s
   WHERE s.product_id = ls.product_id AND s.status IN ('active', 'paused', 'completed')
     AND app_servicio.attendance_base_plan(jsonb_build_object(
       'base', ls.attendance_base,
       'sessionVariantIds', to_jsonb(ls.variant_ids),
       'occursOn', p_occurs_on,
       'member', jsonb_build_object(
         'calendarAccess', EXISTS (SELECT 1 FROM app_servicio_portal.portal_access a
                                    WHERE a.service_id = s.id AND a.section = 'calendar' AND a.starts_at <= day_end.t
                                      AND (a.ends_at IS NULL OR a.ends_at >= day_end.t) AND (a.revoked_at IS NULL OR a.revoked_at > day_end.t)),
         'variantId', s.product_variant_id,
         'serviceStartsOn', s.starts_on,
         'phaseKeyOnDate', (SELECT ph.template_key FROM app_servicio.service_phases ph
                             WHERE ph.service_id = s.id AND ph.started_at IS NOT NULL AND ph.started_at <= day_end.t
                               AND (ph.completed_at IS NULL OR ph.completed_at > day_end.t)
                             ORDER BY ph.started_at DESC LIMIT 1))));
$function$;
REVOKE ALL ON FUNCTION app_servicio.attendance_base_members(p_live_session_id uuid, p_occurs_on date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.attendance_base_members(p_live_session_id uuid, p_occurs_on date) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.ensure_clase_type(p_workspace_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.booking_categories (workspace_id, parent_id, name, color, position, is_system, description, system_key)
  SELECT a.workspace_id, a.id, 'Clase', a.color,
         COALESCE((SELECT max(c.position) + 1 FROM public.booking_categories c WHERE c.parent_id = a.id), 0),
         true, 'Clase grupal o sesión en vivo de un programa para sus estudiantes', 'servicio.clase'
    FROM public.booking_categories a
   WHERE a.workspace_id = p_workspace_id AND a.system_key = 'servicio' AND a.archived_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.booking_categories x WHERE x.workspace_id = a.workspace_id AND x.system_key = 'servicio.clase')
   LIMIT 1;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.ensure_clase_type(p_workspace_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.ensure_clase_type(p_workspace_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.grading_passed(p_scale text, p_value jsonb, p_pass_at jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  words text[] := ARRAY['muy_malo', 'malo', 'regular', 'bueno', 'muy_bueno', 'excelente'];
  lo integer; hi integer; v numeric; at numeric; i integer; j integer;
BEGIN
  IF p_scale = 'pass' THEN
    IF jsonb_typeof(p_value) = 'string' AND p_value #>> '{}' IN ('approved', 'not_approved') THEN RETURN p_value #>> '{}' = 'approved'; END IF;
    RETURN NULL;
  END IF;
  IF p_scale = 'words' THEN
    IF jsonb_typeof(p_value) <> 'string' OR NOT (p_value #>> '{}' = ANY (words)) THEN RETURN NULL; END IF;
    i := array_position(words, p_value #>> '{}');
    j := CASE WHEN jsonb_typeof(p_pass_at) = 'string' AND p_pass_at #>> '{}' = ANY (words) THEN array_position(words, p_pass_at #>> '{}') ELSE 4 END;
    RETURN i >= j;
  END IF;
  IF p_scale = 'stars' THEN lo := 1; hi := 5; at := 3;
  ELSIF p_scale = 'n10' THEN lo := 1; hi := 10; at := 6;
  ELSIF p_scale = 'n100' THEN lo := 1; hi := 100; at := 70;
  ELSE RETURN NULL; END IF;
  IF jsonb_typeof(p_value) <> 'number' THEN RETURN NULL; END IF;
  v := (p_value #>> '{}')::numeric;
  IF v <> trunc(v) OR v < lo OR v > hi THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_pass_at) = 'number' THEN at := (p_pass_at #>> '{}')::numeric; END IF;
  RETURN v >= at;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.grading_passed(p_scale text, p_value jsonb, p_pass_at jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.grading_passed(p_scale text, p_value jsonb, p_pass_at jsonb) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.hook_failed(p_workspace_id uuid, p_hook text, p_error text, p_entity_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RAISE WARNING 'app_servicio %: %', p_hook, p_error;
  BEGIN
    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, actor_type, actor_label)
    VALUES (p_workspace_id, 'service_hook', COALESCE(p_entity_id, p_workspace_id), 'svc.hook_failed',
            jsonb_build_object('hook', p_hook, 'error', left(p_error, 300)), 'system', 'servicios');
    PERFORM app_servicio.notify_admins(p_workspace_id, 'svc_hook_failed', 'Algo del módulo de Servicios no se pudo hacer solo',
      'Revisalo a mano. El detalle quedó en la actividad.', 'service_hook', p_entity_id, jsonb_build_object('hook', p_hook));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_servicio.hook_failed: %', SQLERRM;
  END;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.hook_failed(p_workspace_id uuid, p_hook text, p_error text, p_entity_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.hook_failed(p_workspace_id uuid, p_hook text, p_error text, p_entity_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.is_system()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NULL OR COALESCE(current_setting('app_servicio.system', true), '') = 'on';
$function$;
REVOKE ALL ON FUNCTION app_servicio.is_system() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.is_system() TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.j_date(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'string' AND (p #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$';
$function$;
REVOKE ALL ON FUNCTION app_servicio.j_date(p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.j_date(p jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.j_int(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'number' AND (p::text)::numeric = trunc((p::text)::numeric);
$function$;
REVOKE ALL ON FUNCTION app_servicio.j_int(p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.j_int(p jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.j_num(p jsonb)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN p IS NOT NULL AND jsonb_typeof(p) = 'number' THEN (p::text)::numeric END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.j_num(p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.j_num(p jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.j_uuid(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'string'
    AND (p #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$function$;
REVOKE ALL ON FUNCTION app_servicio.j_uuid(p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.j_uuid(p jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.journey_item_ref_problems(p_item jsonb, p_nm text, p_ws uuid, p_product uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v text[] := ARRAY[]::text[];
  v_kind text := p_item ->> 'kind';
  v_ref jsonb := CASE WHEN jsonb_typeof(p_item -> 'ref') = 'object' THEN p_item -> 'ref' ELSE '{}'::jsonb END;
  v_co text := v_ref ->> 'complete_on';
  v_form jsonb;
  v_want text;
  v_grading boolean;
  v_ok boolean;
  -- F125: el boton y «ver su respuesta».
  v_link_kind boolean := v_kind = ANY (ARRAY['team_task','student_task','checkbox']);
  v_btn jsonb;
  v_label jsonb;
  v_url jsonb;
  v_url_ok boolean := false;
  v_url_bad boolean := false;
BEGIN
  IF v_kind = ANY (ARRAY['form','survey','contract','activity','quiz']) THEN
    IF NOT app_servicio.j_uuid(v_ref -> 'form_id') THEN
      v := v || format('«%s»: elegí el formulario', p_nm);
    ELSE
      IF v_ref ? 'complete_on' AND NOT COALESCE(v_co = ANY (CASE v_kind
          WHEN 'form' THEN ARRAY['submitted','reviewed'] WHEN 'survey' THEN ARRAY['submitted','reviewed']
          WHEN 'contract' THEN ARRAY['submitted'] WHEN 'activity' THEN ARRAY['submitted','reviewed','passed']
          ELSE ARRAY['passed','finished'] END), false) THEN
        v := v || format('«%s»: elegí cuándo se completa', p_nm);
      END IF;
      IF p_ws IS NOT NULL THEN
        SELECT to_jsonb(f) INTO v_form FROM public.forms f WHERE f.id = (v_ref ->> 'form_id')::uuid AND f.workspace_id = p_ws;
        IF v_form IS NULL THEN
          v := v || format('«%s»: el formulario no existe', p_nm);
        ELSE
          v_want := CASE v_kind WHEN 'form' THEN 'custom' ELSE v_kind END;
          IF v_form ->> 'type' IS DISTINCT FROM v_want THEN v := v || format('«%s»: el formulario no es del tipo del paso', p_nm); END IF;
          IF v_kind IN ('quiz','activity') AND p_product IS NOT NULL AND (v_form ->> 'product_id') IS DISTINCT FROM p_product::text THEN
            v := v || CASE v_kind WHEN 'quiz' THEN 'la evaluación tiene que ser de este programa' ELSE 'la actividad tiene que ser de este programa' END;
          END IF;
          IF v_kind = 'activity' AND v_co = 'passed' THEN
            SELECT COALESCE((fv.definition #>> '{grading,enabled}')::boolean, false) INTO v_grading
              FROM public.form_versions fv WHERE fv.id = (v_form ->> 'current_version_id')::uuid;
            IF NOT COALESCE(v_grading, false) THEN v := v || format('«%s»: «al aprobar» necesita una actividad con calificación', p_nm); END IF;
          END IF;
        END IF;
      END IF;
    END IF;
  ELSIF v_kind = 'booking' THEN
    IF NOT app_servicio.j_uuid(v_ref -> 'event_type_id') THEN
      v := v || format('«%s»: elegí el tipo de reunión', p_nm);
    ELSIF p_ws IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.event_types e WHERE e.id = (v_ref ->> 'event_type_id')::uuid AND e.workspace_id = p_ws) THEN
      v := v || format('«%s»: el tipo de reunión no existe', p_nm);
    END IF;
    IF v_ref ? 'complete_on' AND NOT COALESCE(v_co = ANY (ARRAY['booked','attended']), false) THEN v := v || format('«%s»: elegí cuándo se completa', p_nm); END IF;
  ELSIF v_kind IN ('program_item','open_module') THEN
    IF NOT app_servicio.j_uuid(v_ref -> 'program_item_id') THEN
      v := v || format('«%s»: elegí el módulo o la clase', p_nm);
    ELSIF p_product IS NOT NULL THEN
      v_ok := false;
      IF to_regclass('app_servicio.program_items') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM app_servicio.program_items WHERE id = $1 AND product_id = $2)'
          INTO v_ok USING (v_ref ->> 'program_item_id')::uuid, p_product;
      END IF;
      IF NOT v_ok THEN v := v || format('«%s»: el módulo o la clase no es de este programa', p_nm); END IF;
    END IF;
  ELSIF v_kind = 'certificate' THEN
    IF NOT app_servicio.j_uuid(v_ref -> 'template_id') THEN
      v := v || 'Elegí la plantilla del certificado'::text;
    ELSIF p_ws IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.design_templates t WHERE t.id = (v_ref ->> 'template_id')::uuid AND t.workspace_id = p_ws AND t.doc_type = 'certificado'
    ) THEN
      v := v || format('«%s»: la plantilla no es de un certificado de este negocio', p_nm);
    END IF;
  ELSIF v_kind = 'open_section' THEN
    IF NOT COALESCE(v_ref ->> 'section' = ANY (ARRAY['program','calendar','challenge','certificate','assistant','community','affiliates']), false) THEN
      v := v || format('«%s»: elegí la sección', p_nm);
    END IF;
  END IF;

  -- ── El boton del paso (F125). Mismo orden que buttonProblems (TS). ──
  IF v_ref ? 'button' THEN
    v_btn := v_ref -> 'button';
    IF jsonb_typeof(v_btn) IS DISTINCT FROM 'object' THEN
      v := v || format('«%s»: el botón no es válido', p_nm);
    ELSE
      v_label := v_btn -> 'label';
      IF v_label IS NOT NULL AND jsonb_typeof(v_label) <> 'null' AND v_label <> '""'::jsonb THEN
        IF jsonb_typeof(v_label) <> 'string' OR char_length(v_label #>> '{}') > 40 OR (v_label #>> '{}') ~ '[\r\n]' THEN
          v := v || format('«%s»: el texto del botón tiene hasta 40 caracteres, en una línea', p_nm);
        END IF;
      END IF;
      v_url := v_btn -> 'url';
      IF v_url IS NOT NULL AND jsonb_typeof(v_url) <> 'null' AND v_url <> '""'::jsonb THEN
        IF NOT v_link_kind THEN
          v := v || format('«%s»: este paso ya lleva a su destino', p_nm);
        ELSIF jsonb_typeof(v_url) <> 'string' OR (v_url #>> '{}') !~ '^https://\S+$' OR char_length(v_url #>> '{}') > 2000 THEN
          v := v || format('«%s»: el link del botón tiene que empezar con https:// y no llevar espacios', p_nm);
          v_url_bad := true;
        ELSE
          v_url_ok := true;
        END IF;
      END IF;
    END IF;
  END IF;
  IF p_item -> 'portal_button' = 'true'::jsonb THEN
    IF p_item -> 'visible_to_client' = 'false'::jsonb THEN
      v := v || format('«%s»: para mostrar el botón, el cliente tiene que ver el paso', p_nm);
    ELSIF v_link_kind AND NOT v_url_ok AND NOT v_url_bad THEN
      v := v || format('«%s»: pegá el link del botón', p_nm);
    END IF;
  END IF;
  IF v_ref ? 'show_response' THEN
    IF jsonb_typeof(v_ref -> 'show_response') <> 'boolean' THEN
      v := v || format('«%s»: «El cliente puede ver su respuesta» no es válido', p_nm);
    ELSIF NOT (v_kind = ANY (ARRAY['form','survey','activity','quiz','contract'])) THEN
      v := v || format('«%s»: «El cliente puede ver su respuesta» es solo para pasos con formulario', p_nm);
    END IF;
  END IF;
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.journey_item_ref_problems(p_item jsonb, p_nm text, p_ws uuid, p_product uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.journey_item_ref_problems(p_item jsonb, p_nm text, p_ws uuid, p_product uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.journey_recurrence_problems(p_item jsonb, p_nm text)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v text[] := ARRAY[]::text[];
  r jsonb := p_item -> 'recurrence';
BEGIN
  IF r IS NULL OR jsonb_typeof(r) = 'null' THEN RETURN v; END IF;
  IF jsonb_typeof(r) <> 'object' THEN RETURN ARRAY[format('«%s»: la repetición no es válida', p_nm)]; END IF;
  IF NOT COALESCE(r ->> 'every' = ANY (ARRAY['day','week','n_days']), false) THEN v := v || format('«%s»: elegí cada cuánto se repite', p_nm); END IF;
  IF r ->> 'every' = 'n_days' AND NOT (app_servicio.j_int(r -> 'n') AND app_servicio.j_num(r -> 'n') BETWEEN 1 AND 365) THEN
    v := v || format('«%s»: elegí cada cuántos días se repite', p_nm);
  END IF;
  IF NOT COALESCE(r ->> 'until' = ANY (ARRAY['phase_end','service_end','n_days','n_times']), false) THEN v := v || format('«%s»: elegí hasta cuándo se repite', p_nm); END IF;
  IF r ->> 'until' IN ('n_days','n_times') AND NOT (app_servicio.j_int(r -> 'n_until') AND app_servicio.j_num(r -> 'n_until') BETWEEN 1 AND 1000) THEN
    v := v || format('«%s»: elegí cuántas veces o días', p_nm);
  END IF;
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.journey_recurrence_problems(p_item jsonb, p_nm text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.journey_recurrence_problems(p_item jsonb, p_nm text) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.keep_contacts_with_services()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Dentro de una cascada (se borra el negocio entero) no se saltea nada.
  IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  BEGIN
    IF EXISTS (SELECT 1 FROM app_servicio.services s WHERE s.contact_id = OLD.id) THEN
      RETURN NULL;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_servicio.keep_contacts_with_services: %', SQLERRM;
  END;
  RETURN OLD;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.keep_contacts_with_services() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.live_attendance_overview(p_product_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws uuid;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.is_workspace_member(v_ws)
       AND (public.has_permission(v_ws, 'attendance.manage') OR public.has_permission(v_ws, 'live_sessions.manage') OR public.has_permission(v_ws, 'portal.view'))) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF p_to < p_from OR p_to - p_from > 120 THEN RAISE EXCEPTION 'El período es de hasta 120 días' USING ERRCODE = 'CA001'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'live_session_id', o.live_session_id, 'occurs_on', o.occurs_on, 'starts_at', o.starts_at, 'ends_at', o.ends_at, 'status', o.status,
      'base', COALESCE((SELECT jsonb_agg(b.contact_id) FROM app_servicio.attendance_base_members(o.live_session_id, o.occurs_on) b), '[]'::jsonb),
      'attended', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'contact_id', a.contact_id, 'source', a.source, 'added_manually', a.added_manually))
                              FROM app_servicio_portal.live_attendance a WHERE a.live_session_id = o.live_session_id AND a.occurs_on = o.occurs_on AND a.removed_at IS NULL), '[]'::jsonb),
      'clicks', COALESCE((SELECT jsonb_agg(jsonb_build_object('contact_id', c.contact_id, 'clicked_at', c.clicked_at))
                            FROM app_servicio.link_clicks c WHERE c.target_type = 'live_session' AND c.target_id = o.live_session_id AND c.target_date = o.occurs_on AND NOT c.is_bot), '[]'::jsonb))
      ORDER BY o.starts_at)
      FROM app_servicio.live_session_occurrences(p_product_id, p_from, p_to) o
     WHERE o.status <> 'cancelled' AND o.starts_at <= now()), '[]'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.live_attendance_overview(p_product_id uuid, p_from date, p_to date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.live_attendance_overview(p_product_id uuid, p_from date, p_to date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.live_attendance_window(p_starts timestamp with time zone, p_ends timestamp with time zone, p_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT p_at >= p_starts - interval '10 minutes' AND p_at <= p_ends + interval '30 minutes';
$function$;
REVOKE ALL ON FUNCTION app_servicio.live_attendance_window(p_starts timestamp with time zone, p_ends timestamp with time zone, p_at timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.live_attendance_window(p_starts timestamp with time zone, p_ends timestamp with time zone, p_at timestamp with time zone) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.live_date_save(p_live_session_id uuid, p_occurs_on date, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  ls record;
  cur record;
BEGIN
  SELECT id, workspace_id INTO ls FROM app_servicio.live_sessions WHERE id = p_live_session_id;
  IF ls.id IS NULL THEN RAISE EXCEPTION 'No existe la sesión' USING ERRCODE = 'CA002'; END IF;
  IF NOT app_servicio.is_system() AND NOT public.has_permission(ls.workspace_id, 'live_sessions.manage') THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  SELECT * INTO cur FROM app_servicio.live_session_dates WHERE live_session_id = ls.id AND occurs_on = p_occurs_on FOR UPDATE;
  IF app_servicio.is_system() AND cur.recording_source = 'manual' AND (p ? 'recording_url' OR p ? 'recording_call_id') THEN
    p := p - 'recording_url' - 'recording_call_id' - 'recording_source';
  END IF;
  -- La grabacion elegida tiene que ser del mismo negocio (el id viene del navegador).
  IF NULLIF(p ->> 'recording_call_id', '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.id = (p ->> 'recording_call_id')::uuid AND c.workspace_id = ls.workspace_id) THEN
    RAISE EXCEPTION 'No existe esa grabación' USING ERRCODE = 'CA002';
  END IF;
  INSERT INTO app_servicio.live_session_dates (workspace_id, live_session_id, occurs_on, status, moved_to, recording_url, recording_call_id, recording_source, recording_active, note)
  VALUES (ls.workspace_id, ls.id, p_occurs_on, COALESCE(p ->> 'status', 'normal'), NULLIF(p ->> 'moved_to', '')::timestamptz,
          NULLIF(p ->> 'recording_url', ''), NULLIF(p ->> 'recording_call_id', '')::uuid, NULLIF(p ->> 'recording_source', ''),
          COALESCE((p ->> 'recording_active')::boolean, true), NULLIF(p ->> 'note', ''))
  ON CONFLICT (live_session_id, occurs_on) DO UPDATE SET
    status = CASE WHEN p ? 'status' THEN p ->> 'status' ELSE app_servicio.live_session_dates.status END,
    moved_to = CASE WHEN p ? 'moved_to' THEN NULLIF(p ->> 'moved_to', '')::timestamptz ELSE app_servicio.live_session_dates.moved_to END,
    recording_url = CASE WHEN p ? 'recording_url' THEN NULLIF(p ->> 'recording_url', '') ELSE app_servicio.live_session_dates.recording_url END,
    recording_call_id = CASE WHEN p ? 'recording_call_id' THEN NULLIF(p ->> 'recording_call_id', '')::uuid ELSE app_servicio.live_session_dates.recording_call_id END,
    recording_source = CASE WHEN p ? 'recording_source' THEN NULLIF(p ->> 'recording_source', '') ELSE app_servicio.live_session_dates.recording_source END,
    recording_active = CASE WHEN p ? 'recording_active' THEN (p ->> 'recording_active')::boolean ELSE app_servicio.live_session_dates.recording_active END,
    note = CASE WHEN p ? 'note' THEN NULLIF(p ->> 'note', '') ELSE app_servicio.live_session_dates.note END,
    updated_at = now();
  PERFORM app_servicio.audit(ls.workspace_id, 'live_session', ls.id, 'live_session.date_saved', jsonb_build_object('occurs_on', p_occurs_on, 'keys', (SELECT jsonb_agg(k) FROM jsonb_object_keys(p) k)));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.live_date_save(p_live_session_id uuid, p_occurs_on date, p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.live_date_save(p_live_session_id uuid, p_occurs_on date, p jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.live_occurrences_plan(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  s jsonb := p -> 'session';
  v_from date := (p ->> 'from')::date;
  v_to date := (p ->> 'to')::date;
  v_tz text := COALESCE(NULLIF(s ->> 'timezone', ''), 'UTC');
  v_dur integer := COALESCE((s ->> 'duration_minutes')::integer, 60);
  v_out jsonb := '[]'::jsonb;
  v_start date; v_last date; d date; v_anchor date; v_every integer;
  v_at timestamptz; v_day date;
  ex jsonb;
  v_days integer[];
BEGIN
  IF s ->> 'kind' = 'single' THEN
    IF NULLIF(s ->> 'single_at', '') IS NULL THEN RETURN v_out; END IF;
    v_at := (s ->> 'single_at')::timestamptz;
    v_day := (v_at AT TIME ZONE v_tz)::date;
    IF v_day < v_from OR v_day > v_to THEN RETURN v_out; END IF;
    ex := (SELECT x FROM jsonb_array_elements(COALESCE(p -> 'exceptions', '[]'::jsonb)) x WHERE x ->> 'occurs_on' = v_day::text LIMIT 1);
    IF ex ->> 'status' = 'moved' AND NULLIF(ex ->> 'moved_to', '') IS NOT NULL THEN v_at := (ex ->> 'moved_to')::timestamptz; END IF;
    RETURN jsonb_build_array(jsonb_build_object('occursOn', v_day::text,
      'startsAt', to_char(v_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'endsAt', to_char((v_at + make_interval(mins => v_dur)) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'status', COALESCE(ex ->> 'status', 'normal')));
  END IF;
  IF NULLIF(s ->> 'starts_on', '') IS NULL OR NULLIF(s ->> 'start_time', '') IS NULL OR jsonb_array_length(COALESCE(s -> 'weekdays', '[]'::jsonb)) = 0 THEN RETURN v_out; END IF;
  v_days := ARRAY(SELECT (x)::integer FROM jsonb_array_elements_text(s -> 'weekdays') x);
  v_every := LEAST(4, GREATEST(1, COALESCE((s ->> 'every_weeks')::integer, 1)));
  v_start := (s ->> 'starts_on')::date;
  v_anchor := v_start - (extract(isodow FROM v_start)::integer - 1);
  d := GREATEST(v_from, v_start);
  v_last := CASE WHEN NULLIF(s ->> 'ends_on', '') IS NOT NULL AND (s ->> 'ends_on')::date < v_to THEN (s ->> 'ends_on')::date ELSE v_to END;
  WHILE d <= v_last LOOP
    IF extract(isodow FROM d)::integer = ANY (v_days) AND ((d - v_anchor) / 7) % v_every = 0 THEN
      v_at := (d + (s ->> 'start_time')::time) AT TIME ZONE v_tz;
      ex := (SELECT x FROM jsonb_array_elements(COALESCE(p -> 'exceptions', '[]'::jsonb)) x WHERE x ->> 'occurs_on' = d::text LIMIT 1);
      IF ex ->> 'status' = 'moved' AND NULLIF(ex ->> 'moved_to', '') IS NOT NULL THEN v_at := (ex ->> 'moved_to')::timestamptz; END IF;
      v_out := v_out || jsonb_build_array(jsonb_build_object('occursOn', d::text,
        'startsAt', to_char(v_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'endsAt', to_char((v_at + make_interval(mins => v_dur)) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'status', COALESCE(ex ->> 'status', 'normal')));
    END IF;
    d := d + 1;
  END LOOP;
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.live_occurrences_plan(p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.live_occurrences_plan(p jsonb) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.live_session_archive(p_live_session_id uuid, p_archived boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  ls record;
BEGIN
  SELECT id, workspace_id, product_id INTO ls FROM app_servicio.live_sessions WHERE id = p_live_session_id;
  IF ls.id IS NULL THEN RAISE EXCEPTION 'No existe la sesión' USING ERRCODE = 'CA002'; END IF;
  IF NOT app_servicio.is_system() AND NOT public.has_permission(ls.workspace_id, 'live_sessions.manage') THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  UPDATE app_servicio.live_sessions SET archived_at = CASE WHEN p_archived THEN COALESCE(archived_at, now()) END, updated_at = now() WHERE id = ls.id;
  PERFORM app_servicio.audit(ls.workspace_id, 'product', ls.product_id, CASE WHEN p_archived THEN 'live_session.archived' ELSE 'live_session.restored' END, jsonb_build_object('live_session_id', ls.id));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.live_session_archive(p_live_session_id uuid, p_archived boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.live_session_archive(p_live_session_id uuid, p_archived boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.live_session_attendance(p_live_session_id uuid, p_occurs_on date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  ls record;
BEGIN
  SELECT id, workspace_id INTO ls FROM app_servicio.live_sessions WHERE id = p_live_session_id;
  IF ls.id IS NULL THEN RETURN NULL; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.is_workspace_member(ls.workspace_id)
       AND (public.has_permission(ls.workspace_id, 'attendance.manage') OR public.has_permission(ls.workspace_id, 'live_sessions.manage') OR public.has_permission(ls.workspace_id, 'portal.view'))) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  RETURN jsonb_build_object(
    'base', COALESCE((SELECT jsonb_agg(b.contact_id) FROM app_servicio.attendance_base_members(ls.id, p_occurs_on) b), '[]'::jsonb),
    'attended', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'contact_id', a.contact_id, 'source', a.source, 'added_manually', a.added_manually))
                            FROM app_servicio_portal.live_attendance a WHERE a.live_session_id = ls.id AND a.occurs_on = p_occurs_on AND a.removed_at IS NULL), '[]'::jsonb),
    'clicks', COALESCE((SELECT jsonb_agg(jsonb_build_object('contact_id', c.contact_id, 'clicked_at', c.clicked_at))
                          FROM app_servicio.link_clicks c WHERE c.target_type = 'live_session' AND c.target_id = ls.id AND c.target_date = p_occurs_on AND NOT c.is_bot), '[]'::jsonb));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.live_session_attendance(p_live_session_id uuid, p_occurs_on date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.live_session_attendance(p_live_session_id uuid, p_occurs_on date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.live_session_occurrences(p_product_id uuid, p_from date, p_to date)
 RETURNS TABLE(live_session_id uuid, occurs_on date, starts_at timestamp with time zone, ends_at timestamp with time zone, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT ls.id, (o ->> 'occursOn')::date, (o ->> 'startsAt')::timestamptz, (o ->> 'endsAt')::timestamptz, o ->> 'status'
    FROM app_servicio.live_sessions ls
    CROSS JOIN LATERAL jsonb_array_elements(app_servicio.live_occurrences_plan(jsonb_build_object(
      'session', jsonb_build_object('kind', ls.kind, 'weekdays', to_jsonb(ls.weekdays), 'every_weeks', ls.every_weeks, 'starts_on', ls.starts_on,
                                    'ends_on', ls.ends_on, 'single_at', ls.single_at, 'start_time', to_char(ls.start_time, 'HH24:MI'),
                                    'duration_minutes', ls.duration_minutes, 'timezone', ls.timezone),
      'exceptions', COALESCE((SELECT jsonb_agg(jsonb_build_object('occurs_on', d.occurs_on, 'status', d.status, 'moved_to', d.moved_to))
                                FROM app_servicio.live_session_dates d WHERE d.live_session_id = ls.id), '[]'::jsonb),
      'from', p_from, 'to', p_to))) o
   WHERE ls.product_id = p_product_id AND ls.archived_at IS NULL
     AND (app_servicio.is_system() OR (public.is_workspace_member(ls.workspace_id)
          AND (public.has_permission(ls.workspace_id, 'live_sessions.manage') OR public.has_permission(ls.workspace_id, 'services.view') OR public.has_permission(ls.workspace_id, 'portal.view'))));
$function$;
REVOKE ALL ON FUNCTION app_servicio.live_session_occurrences(p_product_id uuid, p_from date, p_to date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.live_session_occurrences(p_product_id uuid, p_from date, p_to date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.live_session_save(p_product_id uuid, p_session_id uuid, p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws uuid;
  v_id uuid := p_session_id;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'No existe el producto' USING ERRCODE = 'CA002'; END IF;
  IF NOT app_servicio.is_system() AND NOT public.has_permission(v_ws, 'live_sessions.manage') THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF p ? 'host_user_id' AND NULLIF(p ->> 'host_user_id', '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = v_ws AND m.user_id = (p ->> 'host_user_id')::uuid) THEN
    RAISE EXCEPTION 'El anfitrión tiene que ser del equipo' USING ERRCODE = 'CA002';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO app_servicio.live_sessions (workspace_id, product_id, title, kind, weekdays, every_weeks, starts_on, ends_on, single_at, start_time,
      duration_minutes, timezone, variant_ids, host_user_id, meeting_url, keyword, track_clicks, click_counts_as_attendance, attendance_base, created_by)
    VALUES (v_ws, p_product_id, btrim(p ->> 'title'), p ->> 'kind',
      CASE WHEN jsonb_typeof(p -> 'weekdays') = 'array' THEN ARRAY(SELECT (x)::integer FROM jsonb_array_elements_text(p -> 'weekdays') x) END,
      NULLIF(p ->> 'every_weeks', '')::integer, NULLIF(p ->> 'starts_on', '')::date, NULLIF(p ->> 'ends_on', '')::date,
      NULLIF(p ->> 'single_at', '')::timestamptz, NULLIF(p ->> 'start_time', '')::time, COALESCE(NULLIF(p ->> 'duration_minutes', '')::integer, 60),
      COALESCE(NULLIF(p ->> 'timezone', ''), app_servicio.ws_tz(v_ws)),
      CASE WHEN jsonb_typeof(p -> 'variant_ids') = 'array' THEN ARRAY(SELECT (x)::uuid FROM jsonb_array_elements_text(p -> 'variant_ids') x) END,
      NULLIF(p ->> 'host_user_id', '')::uuid, NULLIF(p ->> 'meeting_url', ''), NULLIF(p ->> 'keyword', ''),
      COALESCE((p ->> 'track_clicks')::boolean, true), COALESCE((p ->> 'click_counts_as_attendance')::boolean, false),
      COALESCE(p -> 'attendance_base', '{"type":"active"}'::jsonb), CASE WHEN app_servicio.is_system() THEN NULL ELSE auth.uid() END)
    RETURNING id INTO v_id;
  ELSE
    UPDATE app_servicio.live_sessions SET
      title = btrim(p ->> 'title'), kind = p ->> 'kind',
      weekdays = CASE WHEN jsonb_typeof(p -> 'weekdays') = 'array' THEN ARRAY(SELECT (x)::integer FROM jsonb_array_elements_text(p -> 'weekdays') x) END,
      every_weeks = NULLIF(p ->> 'every_weeks', '')::integer, starts_on = NULLIF(p ->> 'starts_on', '')::date, ends_on = NULLIF(p ->> 'ends_on', '')::date,
      single_at = NULLIF(p ->> 'single_at', '')::timestamptz, start_time = NULLIF(p ->> 'start_time', '')::time,
      duration_minutes = COALESCE(NULLIF(p ->> 'duration_minutes', '')::integer, duration_minutes), timezone = COALESCE(NULLIF(p ->> 'timezone', ''), timezone),
      variant_ids = CASE WHEN jsonb_typeof(p -> 'variant_ids') = 'array' THEN ARRAY(SELECT (x)::uuid FROM jsonb_array_elements_text(p -> 'variant_ids') x) END,
      host_user_id = NULLIF(p ->> 'host_user_id', '')::uuid, meeting_url = NULLIF(p ->> 'meeting_url', ''), keyword = NULLIF(p ->> 'keyword', ''),
      track_clicks = COALESCE((p ->> 'track_clicks')::boolean, track_clicks),
      click_counts_as_attendance = COALESCE((p ->> 'click_counts_as_attendance')::boolean, click_counts_as_attendance),
      attendance_base = COALESCE(p -> 'attendance_base', attendance_base), updated_at = now()
    WHERE id = v_id AND product_id = p_product_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'No existe la sesión' USING ERRCODE = 'CA002'; END IF;
  END IF;
  PERFORM app_servicio.audit(v_ws, 'product', p_product_id, 'live_session.saved', jsonb_build_object('live_session_id', v_id));
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.live_session_save(p_product_id uuid, p_session_id uuid, p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.live_session_save(p_product_id uuid, p_session_id uuid, p jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.member_removed_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_n integer;
  v_name text;
BEGIN
  IF NOT app_servicio.module_on(OLD.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    UPDATE app_servicio.services SET flags = flags || '{"owner_departed": true}'::jsonb
     WHERE workspace_id = OLD.workspace_id AND owner_user_id = OLD.user_id AND status IN ('active', 'paused', 'pending_confirmation');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      SELECT COALESCE(NULLIF(u.raw_user_meta_data ->> 'full_name', ''), 'Una persona') INTO v_name FROM auth.users u WHERE u.id = OLD.user_id;
      PERFORM app_servicio.notify_admins(OLD.workspace_id, 'svc_owner_departed',
        format('%s tiene %s servicios: reasignalos', COALESCE(v_name, 'Una persona'), v_n),
        'Dejó el equipo y quedaron a su nombre. Reasignalos desde Clientes.', 'workspace', OLD.workspace_id,
        jsonb_build_object('user_id', OLD.user_id, 'services', v_n));
      PERFORM app_servicio.audit(OLD.workspace_id, 'workspace', OLD.workspace_id, 'svc.owner_departed', jsonb_build_object('user_id', OLD.user_id, 'services', v_n), 'system');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(OLD.workspace_id, 'workspace_member', SQLSTATE || ' ' || SQLERRM, OLD.workspace_id);
  END;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.member_removed_hook() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.merge_contacts_hook(p_main uuid, p_duplicate uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws uuid;
  v_out jsonb := '{}'::jsonb;
  n integer;
  acc_main uuid;
  acc_dup uuid;
  dupe record;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.contacts WHERE id = p_main;
  -- Servicios: los dos quedan (si son del mismo producto y estan activos, se avisa).
  UPDATE app_servicio.services SET contact_id = p_main, updated_at = now() WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('services', n);
  FOR dupe IN SELECT product_id, count(*) c FROM app_servicio.services WHERE contact_id = p_main AND status IN ('active', 'paused') GROUP BY product_id HAVING count(*) > 1 LOOP
    PERFORM app_servicio.notify_admins(v_ws, 'svc_merge_two_services', 'Dos servicios del mismo producto',
      'Al unir dos contactos quedaron dos servicios activos del mismo producto. Revisá si hay que cancelar uno.', 'contact', p_main,
      jsonb_build_object('product_id', dupe.product_id));
  END LOOP;
  -- La cuenta del portal: si los dos tienen, queda la del principal; la otra se suspende y sus sesiones se revocan.
  SELECT id INTO acc_main FROM app_servicio_portal.portal_accounts WHERE contact_id = p_main;
  SELECT id INTO acc_dup FROM app_servicio_portal.portal_accounts WHERE contact_id = p_duplicate;
  IF acc_dup IS NOT NULL THEN
    IF acc_main IS NULL THEN
      UPDATE app_servicio_portal.portal_accounts SET contact_id = p_main, updated_at = now() WHERE id = acc_dup;
      v_out := v_out || jsonb_build_object('portal_accounts', 1);
    ELSE
      UPDATE app_servicio_portal.portal_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE account_id = acc_dup;
      UPDATE app_servicio_portal.portal_accounts SET status = 'suspended', suspended_at = COALESCE(suspended_at, now()),
             suspended_reason = 'Se unió con otro contacto', updated_at = now() WHERE id = acc_dup;
      v_out := v_out || jsonb_build_object('portal_accounts_suspended', 1);
    END IF;
  END IF;
  UPDATE app_servicio_portal.portal_sessions SET preview_contact_id = p_main WHERE preview_contact_id = p_duplicate;
  UPDATE app_servicio_portal.portal_access SET contact_id = p_main, updated_at = now() WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('portal_access', n);
  -- Avance: si los dos vieron la misma clase, queda la fecha mas vieja.
  UPDATE app_servicio_portal.program_progress m
     SET viewed_at = LEAST(m.viewed_at, d.viewed_at), completed_at = LEAST(m.completed_at, d.completed_at),
         unlocked_at = LEAST(m.unlocked_at, d.unlocked_at), last_position_seconds = GREATEST(m.last_position_seconds, d.last_position_seconds), updated_at = now()
    FROM app_servicio_portal.program_progress d
   WHERE m.contact_id = p_main AND d.contact_id = p_duplicate AND d.program_item_id = m.program_item_id;
  DELETE FROM app_servicio_portal.program_progress d
   WHERE d.contact_id = p_duplicate AND EXISTS (SELECT 1 FROM app_servicio_portal.program_progress m WHERE m.contact_id = p_main AND m.program_item_id = d.program_item_id);
  UPDATE app_servicio_portal.program_progress SET contact_id = p_main, updated_at = now() WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('program_progress', n);
  -- Asistencia: una por sesion y fecha.
  DELETE FROM app_servicio_portal.live_attendance d
   WHERE d.contact_id = p_duplicate AND d.removed_at IS NULL
     AND EXISTS (SELECT 1 FROM app_servicio_portal.live_attendance m WHERE m.contact_id = p_main AND m.live_session_id = d.live_session_id
                   AND m.occurs_on = d.occurs_on AND m.removed_at IS NULL);
  UPDATE app_servicio_portal.live_attendance SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('live_attendance', n);
  UPDATE app_servicio.link_clicks SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('link_clicks', n);
  -- Comunidad: los posts pasan al principal; una reaccion repetida queda una.
  UPDATE app_servicio_portal.community_posts SET author_contact_id = p_main WHERE author_contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('community_posts', n);
  DELETE FROM app_servicio_portal.community_reactions d
   WHERE d.contact_id = p_duplicate
     AND EXISTS (SELECT 1 FROM app_servicio_portal.community_reactions m WHERE m.contact_id = p_main AND m.post_id = d.post_id AND m.kind = d.kind);
  UPDATE app_servicio_portal.community_reactions SET contact_id = p_main WHERE contact_id = p_duplicate;
  -- Las conversaciones con el tutor.
  UPDATE public.ai_threads SET contact_id = p_main, updated_at = now() WHERE contact_id = p_duplicate AND channel = 'portal';
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('ai_threads_portal', n);
  -- La extension de proyectos (Corrida C), si existe.
  IF to_regprocedure('app_servicio_proyectos.merge_contacts_hook(uuid,uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT app_servicio_proyectos.merge_contacts_hook($1, $2)' INTO dupe USING p_main, p_duplicate;
  END IF;
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.merge_contacts_hook(p_main uuid, p_duplicate uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.merge_contacts_hook(p_main uuid, p_duplicate uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.module_enabled_clase_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT app_servicio.module_on(NEW.id) THEN RETURN NULL; END IF;
  PERFORM app_servicio.ensure_clase_type(NEW.id);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'app_servicio.module_enabled_clase_hook: %', SQLERRM;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.module_enabled_clase_hook() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.module_on(p_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE((SELECT w.services_enabled FROM public.workspaces w WHERE w.id = p_workspace_id), false);
$function$;
REVOKE ALL ON FUNCTION app_servicio.module_on(p_workspace_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.module_on(p_workspace_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.notify_admins(p_workspace_id uuid, p_type text, p_title text, p_body text, p_entity_type text, p_entity_id uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT m.user_id FROM public.workspace_members m WHERE m.workspace_id = p_workspace_id AND m.role IN ('owner', 'admin') LOOP
    PERFORM app_servicio.notify(p_workspace_id, r.user_id, p_type, p_title, p_body, p_entity_type, p_entity_id, p_metadata);
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.notify_admins(p_workspace_id uuid, p_type text, p_title text, p_body text, p_entity_type text, p_entity_id uuid, p_metadata jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.notify_admins(p_workspace_id uuid, p_type text, p_title text, p_body text, p_entity_type text, p_entity_id uuid, p_metadata jsonb) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.notify(p_workspace_id uuid, p_recipient uuid, p_type text, p_title text, p_body text, p_entity_type text, p_entity_id uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_recipient IS NULL THEN RETURN; END IF;
  INSERT INTO public.notifications (workspace_id, type, title, body, entity_type, entity_id, metadata, recipient_id)
  VALUES (p_workspace_id, p_type, p_title, p_body, p_entity_type, p_entity_id, COALESCE(p_metadata, '{}'::jsonb), p_recipient);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.notify(p_workspace_id uuid, p_recipient uuid, p_type text, p_title text, p_body text, p_entity_type text, p_entity_id uuid, p_metadata jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.notify(p_workspace_id uuid, p_recipient uuid, p_type text, p_title text, p_body text, p_entity_type text, p_entity_id uuid, p_metadata jsonb) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.payment_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s record;
  v_prev_system text := COALESCE(current_setting('app_servicio.system', true), '');
BEGIN
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    PERFORM app_servicio.as_system();
    IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') THEN
      BEGIN
        PERFORM app_servicio.svc_evaluate_auto_creation(NEW.id);
      EXCEPTION
        WHEN SQLSTATE 'SV013' THEN NULL;  -- otro pago de la misma venta lo creo en el mismo instante
      END;
    ELSIF TG_OP = 'UPDATE' AND OLD.status = 'paid' AND NEW.status <> 'paid' AND NEW.type <> 'refund' THEN
      -- Un cobro revertido despues de creado el servicio: el servicio queda (F10).
      FOR s IN SELECT * FROM app_servicio.services WHERE sale_id = NEW.sale_id AND status NOT IN ('cancelled') LOOP
        PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.payment_reverted', jsonb_build_object('payment_id', NEW.id), 'system');
        PERFORM app_servicio.notify(s.workspace_id, s.owner_user_id, 'svc_payment_reverted', 'Se revirtió un pago de un servicio',
          'El servicio sigue igual. Revisá la venta.', 'service', s.id);
        PERFORM app_servicio.notify_admins(s.workspace_id, 'svc_payment_reverted', 'Se revirtió un pago de un servicio',
          'El servicio sigue igual. Revisá la venta.', 'service', s.id);
      END LOOP;
    END IF;
    -- Un pago que entra o sale de mora cambia el semaforo.
    IF TG_OP = 'UPDATE' AND (OLD.status = 'overdue' OR NEW.status = 'overdue') AND OLD.status IS DISTINCT FROM NEW.status THEN
      FOR s IN SELECT id FROM app_servicio.services WHERE sale_id = NEW.sale_id LOOP
        PERFORM app_servicio.svc_compute_light(s.id);
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'payment', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  -- La marca de "sistema" vale solo mientras corre el enganche.
  PERFORM set_config('app_servicio.system', v_prev_system, true);
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.payment_hook() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.phase_certificate_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  it record;
BEGIN
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  FOR it IN SELECT i.id FROM app_servicio.service_items i
             WHERE i.phase_id = NEW.id AND i.kind = 'certificate' AND i.status = 'pending' AND NOT i.is_recurring_template
               AND COALESCE((i.ref ->> 'auto_issue')::boolean, false) LOOP
    INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
    VALUES ('svc_certificate_issue', jsonb_build_object('service_id', NEW.service_id, 'workspace_id', NEW.workspace_id, 'item_id', it.id), now(),
            'svc_certificate_issue:' || it.id::text)
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'app_servicio.phase_certificate_hook: %', SQLERRM;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.phase_certificate_hook() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.portal_access_pick(p jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT r ->> 'id'
    FROM jsonb_array_elements(COALESCE(p -> 'rows', '[]'::jsonb)) r
   WHERE NULLIF(r ->> 'revoked_at', '') IS NULL AND NULLIF(r ->> 'suspended_overdue_at', '') IS NULL AND NULLIF(r ->> 'suspended_pause_at', '') IS NULL
     AND (r ->> 'starts_at')::timestamptz <= (p ->> 'now')::timestamptz
     AND (NULLIF(r ->> 'ends_at', '') IS NULL OR (r ->> 'ends_at')::timestamptz >= (p ->> 'now')::timestamptz)
   ORDER BY (NULLIF(r ->> 'ends_at', '') IS NULL) DESC, (NULLIF(r ->> 'ends_at', ''))::timestamptz DESC NULLS LAST, r ->> 'id' COLLATE "C"
   LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_access_pick(p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.portal_access_pick(p jsonb) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.portal_access_until_reached(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT COALESCE(p #>> '{until,type}' IN ('phase_completed', 'item_completed')
         AND p #>> '{event,type}' = p #>> '{until,type}'
         AND NULLIF(p #>> '{until,ref}', '') IS NOT NULL
         AND p #>> '{event,ref}' = p #>> '{until,ref}', false);
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_access_until_reached(p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.portal_access_until_reached(p jsonb) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.portal_access_window(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  o jsonb := COALESCE(NULLIF(p #> '{rule,opens}', 'null'::jsonb), '{"type":"service_start"}'::jsonb);
  u jsonb := NULLIF(p #> '{rule,until}', 'null'::jsonb);
  t text := COALESCE(o ->> 'type', 'service_start');
  ev text := p #>> '{event,type}';
  ev_ref text := p #>> '{event,ref}';
  v_today date := (p ->> 'today')::date;
  v_starts date := NULLIF(p ->> 'startsOn', '')::date;
  v_ends date := NULLIF(p ->> 'endsOn', '')::date;
  v_days integer;
  v_open boolean := false;
  v_until_day date;
BEGIN
  IF t = 'service_start' THEN
    v_open := ev IN ('service_start', 'tick');
  ELSIF t = 'days_after_start' THEN
    v_days := CASE WHEN jsonb_typeof(o -> 'days') = 'number' AND (o ->> 'days')::numeric > 0 THEN (o ->> 'days')::numeric::integer ELSE 0 END;
    v_open := ev IN ('service_start', 'tick') AND v_starts IS NOT NULL AND v_today >= v_starts + v_days;
  ELSIF t = 'fixed_date' THEN
    v_open := ev IN ('service_start', 'tick') AND NULLIF(o ->> 'date', '') IS NOT NULL AND v_today >= (o ->> 'date')::date;
  ELSIF t IN ('phase_completed', 'item_completed', 'module_completed') THEN
    v_open := ev = t AND NULLIF(o ->> 'ref', '') IS NOT NULL AND ev_ref = o ->> 'ref';
  ELSIF t = 'challenge_started' THEN
    v_open := ev = 'challenge_started';
  END IF;
  IF NOT v_open THEN RETURN jsonb_build_object('action', 'none'); END IF;
  v_until_day := app_servicio.portal_until_day(u, v_today, v_ends);
  IF v_until_day IS NOT NULL AND v_until_day < v_today THEN RETURN jsonb_build_object('action', 'none'); END IF;
  RETURN jsonb_build_object('action', 'open', 'endsOn', to_char(v_until_day, 'YYYY-MM-DD'), 'untilType', COALESCE(u ->> 'type', 'service'));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_access_window(p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.portal_access_window(p jsonb) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.portal_add_months(p_day date, p_n integer)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT (p_day + make_interval(months => p_n))::date;
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_add_months(p_day date, p_n integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.portal_add_months(p_day date, p_n integer) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.portal_admin_account(p_workspace_id uuid, p_contact_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  acc record;
BEGIN
  IF NOT app_servicio.is_system() AND NOT (
       (public.has_permission(p_workspace_id, 'services.view') OR public.has_permission(p_workspace_id, 'portal.accounts') OR public.has_permission(p_workspace_id, 'portal.view_as'))
       AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = p_contact_id AND c.workspace_id = p_workspace_id AND public.can_see_contact(c))) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  SELECT id, status, invite_sent_at, invite_expires_at, last_login_at, suspended_reason INTO acc
    FROM app_servicio_portal.portal_accounts WHERE workspace_id = p_workspace_id AND contact_id = p_contact_id;
  IF acc.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id', acc.id, 'status', acc.status, 'invite_sent_at', acc.invite_sent_at, 'invite_expires_at', acc.invite_expires_at,
                            'last_login_at', acc.last_login_at, 'suspended_reason', acc.suspended_reason);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_admin_account(p_workspace_id uuid, p_contact_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.portal_admin_account(p_workspace_id uuid, p_contact_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.portal_admin_create_preview_pass(p_workspace_id uuid, p_contact_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_token text;
  v_account uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_permission(p_workspace_id, 'portal.view_as') AND app_servicio.can_view_as_student(p_workspace_id, p_contact_id)) THEN
    RAISE EXCEPTION 'No existe' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = p_contact_id AND c.workspace_id = p_workspace_id AND c.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'No existe' USING ERRCODE = 'P0002';
  END IF;
  SELECT id INTO v_account FROM app_servicio_portal.portal_accounts WHERE workspace_id = p_workspace_id AND contact_id = p_contact_id;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO app_servicio_portal.portal_sessions (workspace_id, account_id, kind, token_hash, expires_at, preview_user_id, preview_contact_id)
  VALUES (p_workspace_id, v_account, 'preview_pass', app_servicio.portal_token_hash(v_token), now() + interval '60 seconds', auth.uid(), p_contact_id);
  PERFORM app_servicio.audit(p_workspace_id, 'contact', p_contact_id, 'portal.view_as', '{}'::jsonb);
  RETURN jsonb_build_object('token', v_token, 'expires_at', now() + interval '60 seconds');
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_admin_create_preview_pass(p_workspace_id uuid, p_contact_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.portal_admin_create_preview_pass(p_workspace_id uuid, p_contact_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.portal_admin_invite(p_workspace_id uuid, p_contact_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  acc record;
  v_id uuid;
  v_token text;
  v_today date;
  v_count integer;
BEGIN
  IF NOT app_servicio.is_system() AND NOT (public.has_permission(p_workspace_id, 'portal.accounts') AND app_servicio.can_view_as_student(p_workspace_id, p_contact_id)) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = p_contact_id AND c.workspace_id = p_workspace_id AND c.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'No existe el contacto' USING ERRCODE = 'AC003';
  END IF;
  v_id := app_servicio.svc_ensure_portal_account(p_workspace_id, p_contact_id);
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('status', CASE WHEN EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = p_contact_id AND NULLIF(btrim(c.email), '') IS NOT NULL)
                                              THEN 'email_conflict' ELSE 'no_email' END);
  END IF;
  SELECT * INTO acc FROM app_servicio_portal.portal_accounts WHERE id = v_id FOR UPDATE;
  IF acc.status = 'suspended' THEN RETURN jsonb_build_object('status', 'suspended'); END IF;
  v_today := app_servicio.today_in(p_workspace_id);
  IF acc.invite_sent_at IS NOT NULL AND acc.invite_sent_at > now() - interval '1 minute' THEN
    RETURN jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', GREATEST(1, ceil(extract(epoch FROM acc.invite_sent_at + interval '1 minute' - now()))::integer));
  END IF;
  v_count := CASE WHEN acc.invite_sent_at IS NOT NULL AND app_servicio.local_date(acc.invite_sent_at, p_workspace_id) = v_today THEN acc.invite_sent_count_day ELSE 0 END;
  IF v_count >= 5 THEN RETURN jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', 86400); END IF;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  UPDATE app_servicio_portal.portal_accounts
     SET invite_token_hash = app_servicio.portal_token_hash(v_token), invite_expires_at = now() + interval '7 days',
         invite_sent_at = now(), invite_sent_count_day = v_count + 1, updated_at = now()
   WHERE id = v_id;
  PERFORM app_servicio.audit(p_workspace_id, 'contact', p_contact_id, 'portal.invited', jsonb_build_object('account_id', v_id, 'count_today', v_count + 1));
  RETURN jsonb_build_object('status', 'ok', 'token', v_token, 'account_id', v_id, 'email', acc.email, 'expires_at', now() + interval '7 days');
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_admin_invite(p_workspace_id uuid, p_contact_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.portal_admin_invite(p_workspace_id uuid, p_contact_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.portal_admin_reactivate_account(p_account_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  acc record;
BEGIN
  SELECT * INTO acc FROM app_servicio_portal.portal_accounts WHERE id = p_account_id FOR UPDATE;
  IF acc.id IS NULL THEN RAISE EXCEPTION 'No existe la cuenta' USING ERRCODE = 'AC003'; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.has_permission(acc.workspace_id, 'portal.accounts') AND app_servicio.can_view_as_student(acc.workspace_id, acc.contact_id)) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  UPDATE app_servicio_portal.portal_accounts SET status = CASE WHEN last_login_at IS NULL THEN 'invited' ELSE 'active' END,
         suspended_at = NULL, suspended_reason = NULL, updated_at = now()
   WHERE id = acc.id AND status = 'suspended';
  PERFORM app_servicio.audit(acc.workspace_id, 'contact', acc.contact_id, 'portal.account_reactivated', '{}'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_admin_reactivate_account(p_account_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.portal_admin_reactivate_account(p_account_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.portal_admin_save_program_settings(p_product_id uuid, p_patch jsonb, p_rev integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_row public.products;
  v_new jsonb;
  v_problems text[];
  k text;
BEGIN
  SELECT * INTO v_row FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe el producto' USING ERRCODE = 'SV002'; END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'El cambio no es válido' USING ERRCODE = 'SV001'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    PERFORM app_servicio.require_permission(v_row.workspace_id, CASE k
      WHEN 'sections' THEN 'portal.sections'
      WHEN 'terms' THEN 'portal.sections'
      WHEN 'affiliates' THEN 'portal.sections'
      WHEN 'community' THEN 'community.spaces'
      WHEN 'assistant' THEN 'tutor.manage'
      ELSE 'portal.sections' END);
  END LOOP;
  v_new := COALESCE(v_row.portal_settings, '{}'::jsonb) || p_patch;
  v_problems := app_servicio.validate_program_portal_settings(v_new, p_product_id);
  IF array_length(v_problems, 1) > 0 THEN
    RETURN jsonb_build_object('status', 'invalid', 'problems', to_jsonb(v_problems));
  END IF;
  UPDATE public.products
     SET portal_settings = v_new, portal_settings_rev = portal_settings_rev + 1
   WHERE id = p_product_id AND portal_settings_rev = p_rev;
  IF NOT FOUND THEN
    SELECT * INTO v_row FROM public.products WHERE id = p_product_id;
    RETURN jsonb_build_object('status', 'conflict', 'current', v_row.portal_settings, 'rev', v_row.portal_settings_rev);
  END IF;
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, performed_by, actor_type)
  VALUES (v_row.workspace_id, 'product', p_product_id, 'svc.config_saved',
          jsonb_build_object('part', 'program', 'keys', (SELECT jsonb_agg(x) FROM jsonb_object_keys(p_patch) x)), auth.uid(), 'user');
  RETURN jsonb_build_object('status', 'ok', 'rev', p_rev + 1, 'current', v_new);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_admin_save_program_settings(p_product_id uuid, p_patch jsonb, p_rev integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.portal_admin_save_program_settings(p_product_id uuid, p_patch jsonb, p_rev integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.portal_admin_save_settings(p_workspace_id uuid, p_patch jsonb, p_rev integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_row public.workspaces;
  v_new jsonb;
  v_problems text[];
BEGIN
  PERFORM app_servicio.require_permission(p_workspace_id, 'portal.settings');
  SELECT * INTO v_row FROM public.workspaces WHERE id = p_workspace_id;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'El cambio no es válido' USING ERRCODE = 'SV001'; END IF;
  v_new := (COALESCE(v_row.portal_settings, '{}'::jsonb) || (p_patch - 'extensions')) - 'extensions';
  IF v_row.portal_settings ? 'extensions' THEN v_new := v_new || jsonb_build_object('extensions', v_row.portal_settings -> 'extensions'); END IF;
  IF v_new ? 'host' AND jsonb_typeof(v_new -> 'host') = 'string' THEN v_new := jsonb_set(v_new, '{host}', to_jsonb(lower(btrim(v_new ->> 'host')))); END IF;
  v_problems := app_servicio.validate_workspace_portal_settings(v_new, p_workspace_id);
  IF array_length(v_problems, 1) > 0 THEN
    RETURN jsonb_build_object('status', 'invalid', 'problems', to_jsonb(v_problems));
  END IF;
  BEGIN
    UPDATE public.workspaces
       SET portal_settings = v_new, portal_settings_rev = portal_settings_rev + 1
     WHERE id = p_workspace_id AND portal_settings_rev = p_rev;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Esa dirección ya la usa otro negocio' USING ERRCODE = 'AC010';
  END;
  IF NOT FOUND THEN
    SELECT * INTO v_row FROM public.workspaces WHERE id = p_workspace_id;
    RETURN jsonb_build_object('status', 'conflict', 'current', v_row.portal_settings - 'extensions', 'rev', v_row.portal_settings_rev);
  END IF;
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, performed_by, actor_type)
  VALUES (p_workspace_id, 'workspace', p_workspace_id, 'portal.settings_saved',
          jsonb_build_object('keys', (SELECT jsonb_agg(x) FROM jsonb_object_keys(p_patch) x)), auth.uid(), 'user');
  RETURN jsonb_build_object('status', 'ok', 'rev', p_rev + 1, 'current', v_new - 'extensions');
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_admin_save_settings(p_workspace_id uuid, p_patch jsonb, p_rev integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.portal_admin_save_settings(p_workspace_id uuid, p_patch jsonb, p_rev integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.portal_admin_save_variant_portal(p_variant_id uuid, p_settings jsonb, p_rev integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_row public.product_variants;
  v_problems text[];
BEGIN
  SELECT * INTO v_row FROM public.product_variants WHERE id = p_variant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe la variante' USING ERRCODE = 'SV002'; END IF;
  IF app_servicio.portal_sections_part(p_settings) IS DISTINCT FROM app_servicio.portal_sections_part(v_row.portal_settings) THEN
    PERFORM app_servicio.require_permission(v_row.workspace_id, 'portal.sections');
  END IF;
  IF app_servicio.portal_rules_part(p_settings) IS DISTINCT FROM app_servicio.portal_rules_part(v_row.portal_settings) THEN
    PERFORM app_servicio.require_permission(v_row.workspace_id, 'portal.access_rules');
  END IF;
  -- Sin cambios: igual pide alguno de los dos (no se guarda nada con una sesion cualquiera).
  IF NOT (public.has_permission(v_row.workspace_id, 'portal.sections') OR public.has_permission(v_row.workspace_id, 'portal.access_rules')) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  v_problems := app_servicio.validate_variant_portal_settings(p_settings, p_variant_id);
  IF array_length(v_problems, 1) > 0 THEN
    RETURN jsonb_build_object('status', 'invalid', 'problems', to_jsonb(v_problems));
  END IF;
  UPDATE public.product_variants
     SET portal_settings = p_settings, portal_settings_rev = portal_settings_rev + 1
   WHERE id = p_variant_id AND portal_settings_rev = p_rev;
  IF NOT FOUND THEN
    SELECT * INTO v_row FROM public.product_variants WHERE id = p_variant_id;
    RETURN jsonb_build_object('status', 'conflict', 'current', v_row.portal_settings, 'rev', v_row.portal_settings_rev);
  END IF;
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, performed_by, actor_type)
  VALUES (v_row.workspace_id, 'product_variant', p_variant_id, 'svc.config_saved',
          jsonb_build_object('part', 'portal', 'old', v_row.portal_settings, 'new', p_settings), auth.uid(), 'user');
  RETURN jsonb_build_object('status', 'ok', 'rev', p_rev + 1, 'current', p_settings);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_admin_save_variant_portal(p_variant_id uuid, p_settings jsonb, p_rev integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.portal_admin_save_variant_portal(p_variant_id uuid, p_settings jsonb, p_rev integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.portal_admin_service_accesses(p_service_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
BEGIN
  s := app_servicio.svc_get(p_service_id);
  PERFORM app_servicio.require_service(s, 'services.view');
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'section', a.section, 'product_id', a.product_id, 'starts_at', a.starts_at,
            'ends_at', a.ends_at, 'until_type', a.until_type, 'source', a.source, 'reason', a.reason, 'revoked_at', a.revoked_at,
            'revoke_reason', a.revoke_reason, 'suspended_overdue_at', a.suspended_overdue_at, 'suspended_pause_at', a.suspended_pause_at)
            ORDER BY a.created_at)
     FROM app_servicio_portal.portal_access a WHERE a.service_id = s.id), '[]'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_admin_service_accesses(p_service_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.portal_admin_service_accesses(p_service_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.portal_admin_suspend_account(p_account_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  acc record;
BEGIN
  SELECT * INTO acc FROM app_servicio_portal.portal_accounts WHERE id = p_account_id FOR UPDATE;
  IF acc.id IS NULL THEN RAISE EXCEPTION 'No existe la cuenta' USING ERRCODE = 'AC003'; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.has_permission(acc.workspace_id, 'portal.accounts') AND app_servicio.can_view_as_student(acc.workspace_id, acc.contact_id)) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'AC001'; END IF;
  UPDATE app_servicio_portal.portal_accounts SET status = 'suspended', suspended_at = now(), suspended_reason = btrim(p_reason),
         invite_token_hash = NULL, invite_expires_at = NULL, updated_at = now()
   WHERE id = acc.id;
  UPDATE app_servicio_portal.portal_sessions SET revoked_at = now() WHERE account_id = acc.id AND revoked_at IS NULL;
  PERFORM app_servicio.audit(acc.workspace_id, 'contact', acc.contact_id, 'portal.account_suspended', jsonb_build_object('reason', btrim(p_reason)));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_admin_suspend_account(p_account_id uuid, p_reason text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.portal_admin_suspend_account(p_account_id uuid, p_reason text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.portal_form_after_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_type text;
  v_product uuid;
  sv record;
  v_prev_system text := COALESCE(current_setting('app_servicio.system', true), '');
BEGIN
  IF NEW.context IS DISTINCT FROM 'portal' OR NEW.contact_id IS NULL OR NEW.status <> 'received' THEN RETURN NULL; END IF;
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    PERFORM app_servicio.as_system();
    SELECT f.type, f.product_id INTO v_type, v_product FROM public.forms f WHERE f.id = NEW.form_id;
    IF v_type = 'quiz' THEN
      PERFORM app_servicio.svc_complete_portal_form(NEW.workspace_id, NEW.contact_id, NEW.form_id, 'quiz',
        CASE WHEN COALESCE((NEW.grade ->> 'passed')::boolean, false) AND COALESCE((NEW.grade ->> 'counted')::boolean, true) THEN ARRAY['finished', 'passed'] ELSE ARRAY['finished'] END,
        'quiz_submission');
    ELSIF v_type = 'activity' THEN
      PERFORM app_servicio.svc_complete_portal_form(NEW.workspace_id, NEW.contact_id, NEW.form_id, 'activity', ARRAY['submitted'], 'activity_submission');
    END IF;
    FOR sv IN SELECT id FROM app_servicio.services WHERE contact_id = NEW.contact_id AND product_id = v_product AND status IN ('active', 'paused') LOOP
      IF v_type = 'activity' THEN
        PERFORM app_servicio.emit_service(sv.id, 'task_submission_received', jsonb_build_object('form_id', NEW.form_id, 'submission_id', NEW.id));
      ELSIF v_type = 'quiz' AND COALESCE((NEW.grade ->> 'counted')::boolean, true) THEN
        PERFORM app_servicio.emit_service(sv.id, CASE WHEN COALESCE((NEW.grade ->> 'passed')::boolean, false) THEN 'quiz_passed' ELSE 'quiz_failed' END,
          jsonb_build_object('form_id', NEW.form_id, 'submission_id', NEW.id, 'pct', NEW.grade -> 'pct'));
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'portal_form', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  PERFORM set_config('app_servicio.system', v_prev_system, true);
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_form_after_hook() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.portal_form_before_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_type text;
  v_def jsonb;
BEGIN
  BEGIN
    SELECT f.type INTO v_type FROM public.forms f WHERE f.id = NEW.form_id;
    IF v_type IS NULL OR v_type NOT IN ('quiz', 'activity', 'terms') THEN RETURN NEW; END IF;
    IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NEW; END IF;
    NEW.context := 'portal';
    IF v_type = 'terms' THEN RETURN NEW; END IF;
    NEW.attempt := 1 + (SELECT count(*) FROM public.form_submissions fs WHERE fs.form_id = NEW.form_id AND fs.contact_id IS NOT DISTINCT FROM NEW.contact_id AND fs.status = 'received');
    IF v_type = 'quiz' THEN
      SELECT fv.definition INTO v_def FROM public.form_versions fv WHERE fv.id = NEW.form_version_id;
      NEW.grade := app_servicio.quiz_grade_plan(jsonb_build_object('settings', COALESCE(v_def -> 'quiz', '{}'::jsonb), 'answers', COALESCE(NEW.answers, '{}'::jsonb), 'attempt', NEW.attempt));
      NEW.review_status := 'graded';
    ELSE
      NEW.review_status := 'pending';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'portal_form_before_hook: %', SQLERRM;
  END;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_form_before_hook() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.portal_invite_token_valid(p_hash text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (SELECT 1 FROM app_servicio_portal.portal_accounts a
                  WHERE a.invite_token_hash = p_hash AND a.invite_expires_at > now() AND a.status <> 'suspended');
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_invite_token_valid(p_hash text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.portal_invite_token_valid(p_hash text) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.portal_rules_part(p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('section', s ->> 'section') || (s - 'section' - 'included') ORDER BY s ->> 'section'), '[]'::jsonb)
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p -> 'sections') = 'array' THEN p -> 'sections' ELSE '[]'::jsonb END) s;
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_rules_part(p jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.portal_section_enabled(p_product_id uuid, p_section text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE((SELECT COALESCE((pr.portal_settings #>> ARRAY['sections', p_section])::boolean, true)
                     FROM public.products pr WHERE pr.id = p_product_id), false)
     AND p_section IN ('program', 'calendar', 'challenge', 'certificate', 'assistant', 'community', 'affiliates');
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_section_enabled(p_product_id uuid, p_section text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.portal_section_enabled(p_product_id uuid, p_section text) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.portal_access_effective(p_contact_id uuid, p_product_id uuid, p_section text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT (app_servicio.portal_access_pick(jsonb_build_object('now', now(), 'rows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', a.id, 'starts_at', a.starts_at, 'ends_at', a.ends_at, 'revoked_at', a.revoked_at,
                                        'suspended_overdue_at', a.suspended_overdue_at, 'suspended_pause_at', a.suspended_pause_at))
      FROM app_servicio_portal.portal_access a
     WHERE a.contact_id = p_contact_id AND a.product_id = p_product_id AND a.section = p_section), '[]'::jsonb))))::uuid
   WHERE app_servicio.portal_section_enabled(p_product_id, p_section);
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_access_effective(p_contact_id uuid, p_product_id uuid, p_section text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.portal_access_effective(p_contact_id uuid, p_product_id uuid, p_section text) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.portal_section_rule_problems(p_rule jsonb)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v text[] := ARRAY[]::text[];
  sec text := p_rule ->> 'section';
  o jsonb; u jsonb; c jsonb; l jsonb; a jsonb;
BEGIN
  v := v || app_servicio.unknown_keys(p_rule, ARRAY['section','included','display','content','opens','until','limits','ai_limit_usd']);
  IF NOT COALESCE(sec = ANY (ARRAY['program','calendar','challenge','certificate','assistant','community','affiliates','fame','projects']), false) THEN
    RETURN v || ('sección desconocida: ' || COALESCE(sec, 'undefined'));
  END IF;
  IF NOT COALESCE(sec = ANY (ARRAY['program','calendar','challenge','certificate','assistant','community','affiliates']), false) THEN
    RETURN v || 'Todavía no está disponible'::text;
  END IF;
  IF p_rule ? 'display' AND NOT COALESCE(p_rule ->> 'display' = ANY (ARRAY['locked','coming_soon','hidden']), false) THEN v := v || (sec || ': elegí cómo se ve mientras está cerrada'); END IF;
  IF p_rule ? 'content' THEN
    c := p_rule -> 'content';
    IF NOT (jsonb_typeof(c) = 'object' AND (c -> 'modules' = '"all"'::jsonb OR (jsonb_typeof(c -> 'modules') = 'array' AND jsonb_array_length(c -> 'modules') > 0
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c -> 'modules') m WHERE NOT app_servicio.j_uuid(m))))) THEN
      v := v || (sec || ': elegí el contenido incluido');
    ELSIF sec <> 'program' THEN
      v := v || (sec || ': solo el Programa elige contenido');
    END IF;
  END IF;
  IF p_rule ? 'opens' THEN
    o := p_rule -> 'opens';
    IF jsonb_typeof(o) <> 'object' OR NOT COALESCE(o ->> 'type' = ANY (ARRAY['service_start','days_after_start','fixed_date','phase_completed','item_completed',
         'module_completed','challenge_started','journey_item','automation']), false) THEN
      v := v || (sec || ': elegí cuándo se abre');
    ELSE
      IF o ->> 'type' = 'days_after_start' AND NOT (app_servicio.j_int(o -> 'days') AND app_servicio.j_num(o -> 'days') BETWEEN 1 AND 3650) THEN v := v || (sec || ': elegí cuántos días después del inicio'); END IF;
      IF o ->> 'type' = 'fixed_date' AND NOT app_servicio.j_date(o -> 'date') THEN v := v || (sec || ': elegí la fecha en que se abre'); END IF;
      IF o ->> 'type' IN ('phase_completed','item_completed','module_completed') AND NOT (jsonb_typeof(o -> 'ref') = 'string' AND o ->> 'ref' <> '') THEN
        v := v || (sec || ': elegí qué la abre');
      END IF;
    END IF;
  END IF;
  IF p_rule ? 'until' THEN
    u := p_rule -> 'until';
    IF jsonb_typeof(u) <> 'object' OR NOT COALESCE(u ->> 'type' = ANY (ARRAY['service','days','months','fixed_date','phase_completed','item_completed','forever']), false) THEN
      v := v || (sec || ': elegí hasta cuándo dura');
    ELSE
      IF u ->> 'type' IN ('days','months') AND NOT (app_servicio.j_int(u -> 'n') AND app_servicio.j_num(u -> 'n') BETWEEN 1 AND 3650) THEN v := v || (sec || ': elegí cuánto dura'); END IF;
      IF u ->> 'type' = 'fixed_date' AND NOT app_servicio.j_date(u -> 'date') THEN v := v || (sec || ': elegí la fecha en que termina'); END IF;
      IF u ->> 'type' IN ('phase_completed','item_completed') AND NOT (jsonb_typeof(u -> 'ref') = 'string' AND u ->> 'ref' <> '') THEN v := v || (sec || ': elegí qué la termina'); END IF;
    END IF;
  END IF;
  IF p_rule ? 'limits' THEN
    l := p_rule -> 'limits';
    IF jsonb_typeof(l) <> 'object' OR (l ? 'community_can_post' AND jsonb_typeof(l -> 'community_can_post') <> 'boolean') THEN v := v || (sec || ': los límites no son válidos'); END IF;
  END IF;
  IF p_rule ? 'ai_limit_usd' AND jsonb_typeof(p_rule -> 'ai_limit_usd') <> 'null' THEN
    a := p_rule -> 'ai_limit_usd';
    IF NOT (jsonb_typeof(a) = 'number' AND app_servicio.j_num(a) BETWEEN 0 AND 10000) THEN v := v || (sec || ': el límite de IA va de 0 a 10.000 dólares');
    ELSIF sec <> 'assistant' THEN v := v || (sec || ': solo el Asistente IA tiene límite de gasto');
    END IF;
  END IF;
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_section_rule_problems(p_rule jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.portal_section_rule_problems(p_rule jsonb) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.portal_section_rule(p_variant_id uuid, p_section text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT x FROM public.product_variants v, jsonb_array_elements(COALESCE(v.portal_settings -> 'sections', '[]'::jsonb)) x
   WHERE v.id = p_variant_id AND x ->> 'section' = p_section AND COALESCE((x ->> 'included')::boolean, true)
   LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_section_rule(p_variant_id uuid, p_section text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.portal_section_rule(p_variant_id uuid, p_section text) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.portal_sections_part(p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object('enabled', p -> 'enabled', 'ask_terms', p -> 'ask_terms', 'sections',
    COALESCE((SELECT jsonb_agg(jsonb_build_object('section', s ->> 'section', 'included', s -> 'included') ORDER BY s ->> 'section')
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p -> 'sections') = 'array' THEN p -> 'sections' ELSE '[]'::jsonb END) s), '[]'::jsonb));
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_sections_part(p jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.portal_terms_pending(p_contact_id uuid, p_product_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  t jsonb;
  v_form uuid;
BEGIN
  SELECT pr.portal_settings -> 'terms' INTO t FROM public.products pr WHERE pr.id = p_product_id;
  v_form := NULLIF(t ->> 'form_id', '')::uuid;
  RETURN app_servicio.portal_terms_plan(jsonb_build_object(
    'enabled', COALESCE((t ->> 'enabled')::boolean, false),
    'formId', v_form,
    'askAgainOnChange', COALESCE((t ->> 'ask_again_on_change')::boolean, true),
    'variantsAsk', COALESCE((SELECT jsonb_agg(COALESCE((v.portal_settings ->> 'ask_terms')::boolean, true))
                               FROM app_servicio.services s JOIN public.product_variants v ON v.id = s.product_variant_id
                              WHERE s.contact_id = p_contact_id AND s.product_id = p_product_id AND s.status IN ('active', 'paused')), '[]'::jsonb),
    'acceptedVersionIds', COALESCE((SELECT jsonb_agg(DISTINCT fs.form_version_id::text) FROM public.form_submissions fs
                                    WHERE fs.form_id = v_form AND fs.contact_id = p_contact_id AND fs.status = 'received'), '[]'::jsonb),
    'currentVersionId', (SELECT fv.id::text FROM public.form_versions fv WHERE fv.form_id = v_form ORDER BY fv.version_number DESC LIMIT 1)));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_terms_pending(p_contact_id uuid, p_product_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.portal_terms_pending(p_contact_id uuid, p_product_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.portal_terms_plan(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN NOT COALESCE((p ->> 'enabled')::boolean, false) OR NULLIF(p ->> 'formId', '') IS NULL THEN false
    WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p -> 'variantsAsk', '[]'::jsonb)) x WHERE x = 'true'::jsonb) THEN false
    WHEN jsonb_array_length(COALESCE(p -> 'acceptedVersionIds', '[]'::jsonb)) = 0 THEN true
    WHEN COALESCE((p ->> 'askAgainOnChange')::boolean, false) AND NULLIF(p ->> 'currentVersionId', '') IS NOT NULL
         AND NOT (COALESCE(p -> 'acceptedVersionIds', '[]'::jsonb) ? (p ->> 'currentVersionId')) THEN true
    ELSE false END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_terms_plan(p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.portal_terms_plan(p jsonb) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.portal_token_hash(p_token text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_token_hash(p_token text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.portal_token_hash(p_token text) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.portal_until_day(p_until jsonb, p_today date, p_ends_on date)
 RETURNS date
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  t text := COALESCE(p_until ->> 'type', 'service');
  n numeric := CASE WHEN jsonb_typeof(p_until -> 'n') = 'number' THEN (p_until ->> 'n')::numeric END;
BEGIN
  IF t = 'service' THEN RETURN p_ends_on; END IF;
  IF t = 'days' THEN RETURN CASE WHEN n > 0 THEN p_today + n::integer END; END IF;
  IF t = 'months' THEN RETURN CASE WHEN n > 0 THEN app_servicio.portal_add_months(p_today, n::integer) END; END IF;
  IF t = 'fixed_date' THEN RETURN NULLIF(p_until ->> 'date', '')::date; END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.portal_until_day(p_until jsonb, p_today date, p_ends_on date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.portal_until_day(p_until jsonb, p_today date, p_ends_on date) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.product_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v text[];
BEGIN
  v := app_servicio.validate_program_portal_settings(NEW.portal_settings, NEW.id);
  IF array_length(v, 1) > 0 THEN
    RAISE EXCEPTION 'La configuración no es válida: %', array_to_string(v, '; ') USING ERRCODE = 'SV001';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.product_validate() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.program_card_metrics(p_product_ids uuid[], p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws uuid;
  v_days integer := CASE WHEN p_days IN (7, 30) THEN p_days ELSE 30 END;
  v_from timestamptz := now() - make_interval(days => CASE WHEN p_days IN (7, 30) THEN p_days ELSE 30 END);
BEGIN
  SELECT DISTINCT workspace_id INTO v_ws FROM public.products WHERE id = ANY (p_product_ids) LIMIT 1;
  IF v_ws IS NULL THEN RETURN '{}'::jsonb; END IF;
  IF EXISTS (SELECT 1 FROM public.products WHERE id = ANY (p_product_ids) AND workspace_id <> v_ws) THEN
    RAISE EXCEPTION 'Los programas tienen que ser del mismo negocio' USING ERRCODE = 'SV004';
  END IF;
  IF NOT app_servicio.is_system() AND NOT (public.is_workspace_member(v_ws) AND (public.has_permission(v_ws, 'services.view') OR public.has_permission(v_ws, 'program.manage'))) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  RETURN COALESCE((SELECT jsonb_object_agg(pr.id, jsonb_build_object(
    'new_students', CASE WHEN app_servicio.portal_section_enabled(pr.id, 'program') THEN (
        SELECT count(DISTINCT a.contact_id)::int FROM app_servicio_portal.portal_access a JOIN app_servicio.services sv ON sv.id = a.service_id
         WHERE a.product_id = pr.id AND a.section = 'program' AND a.starts_at >= v_from AND a.starts_at <= now() AND NOT sv.is_test) END,
    'lessons_completed', CASE WHEN app_servicio.portal_section_enabled(pr.id, 'program') THEN (
        SELECT count(*)::int FROM app_servicio_portal.program_progress g JOIN app_servicio.program_items i ON i.id = g.program_item_id
         WHERE i.product_id = pr.id AND i.kind = 'lesson' AND g.completed_at >= v_from
           AND NOT EXISTS (SELECT 1 FROM app_servicio.services sv WHERE sv.contact_id = g.contact_id AND sv.product_id = pr.id AND sv.is_test)) END,
    'to_review', (SELECT count(*)::int FROM public.form_submissions fs JOIN public.forms f ON f.id = fs.form_id JOIN public.form_versions v ON v.id = fs.form_version_id
         WHERE f.product_id = pr.id AND f.type = 'activity' AND fs.review_status = 'pending'
           AND NOT COALESCE((v.definition #>> '{grading,enabled}')::boolean, false)),
    'to_grade', (SELECT count(*)::int FROM public.form_submissions fs JOIN public.forms f ON f.id = fs.form_id JOIN public.form_versions v ON v.id = fs.form_version_id
         WHERE f.product_id = pr.id AND f.type = 'activity' AND fs.review_status = 'pending'
           AND COALESCE((v.definition #>> '{grading,enabled}')::boolean, false)),
    'certificates', CASE WHEN app_servicio.portal_section_enabled(pr.id, 'certificate') THEN (
        SELECT count(*)::int FROM public.designs dz JOIN public.design_templates t ON t.id = dz.template_id
          JOIN app_servicio.services sv ON sv.id::text = dz.subject_ref ->> 'id'
         WHERE dz.workspace_id = v_ws AND t.doc_type = 'certificado' AND dz.subject_ref ->> 'module' = 'service' AND sv.product_id = pr.id
           AND NOT sv.is_test AND dz.status IN ('queued', 'rendering', 'ready') AND dz.created_at >= v_from) END,
    'community_posts', CASE WHEN app_servicio.portal_section_enabled(pr.id, 'community') THEN (
        SELECT count(*)::int FROM app_servicio_portal.community_posts c
         WHERE c.product_id = pr.id AND c.parent_id IS NULL AND c.deleted_at IS NULL AND c.hidden_at IS NULL AND c.created_at >= v_from) END,
    'attendance_pct', CASE WHEN app_servicio.portal_section_enabled(pr.id, 'calendar') THEN (
        SELECT CASE WHEN sum(x.base) > 0 THEN round(100.0 * sum(x.att) / sum(x.base))::int END FROM (
          SELECT (SELECT count(*) FROM app_servicio.attendance_base_members(ls.id, (o ->> 'occursOn')::date)) AS base,
                 (SELECT count(*) FROM app_servicio_portal.live_attendance la
                   WHERE la.live_session_id = ls.id AND la.occurs_on = (o ->> 'occursOn')::date AND la.removed_at IS NULL
                     AND la.contact_id IN (SELECT b.contact_id FROM app_servicio.attendance_base_members(ls.id, (o ->> 'occursOn')::date) b)) AS att
            FROM app_servicio.live_sessions ls
            CROSS JOIN LATERAL jsonb_array_elements(app_servicio.live_occurrences_plan(jsonb_build_object(
              'session', jsonb_build_object('kind', ls.kind, 'weekdays', to_jsonb(ls.weekdays), 'every_weeks', ls.every_weeks, 'starts_on', ls.starts_on,
                                            'ends_on', ls.ends_on, 'single_at', ls.single_at, 'start_time', to_char(ls.start_time, 'HH24:MI'),
                                            'duration_minutes', ls.duration_minutes, 'timezone', ls.timezone),
              'exceptions', COALESCE((SELECT jsonb_agg(jsonb_build_object('occurs_on', z.occurs_on, 'status', z.status, 'moved_to', z.moved_to))
                                        FROM app_servicio.live_session_dates z WHERE z.live_session_id = ls.id), '[]'::jsonb),
              'from', (v_from AT TIME ZONE ls.timezone)::date, 'to', (now() AT TIME ZONE ls.timezone)::date))) o
           WHERE ls.product_id = pr.id AND ls.archived_at IS NULL AND o ->> 'status' <> 'cancelled'
             AND (o ->> 'endsAt')::timestamptz + interval '30 minutes' < now()) x) END,
    'inactive_14d', (SELECT count(DISTINCT a.contact_id)::int FROM app_servicio_portal.portal_access a
         JOIN app_servicio.services sv ON sv.id = a.service_id
         LEFT JOIN app_servicio_portal.portal_accounts pa ON pa.contact_id = a.contact_id AND pa.workspace_id = a.workspace_id
        WHERE a.product_id = pr.id AND a.revoked_at IS NULL AND a.starts_at <= now() - interval '14 days' AND (a.ends_at IS NULL OR a.ends_at > now())
          AND NOT sv.is_test AND (pa.last_login_at IS NULL OR pa.last_login_at < now() - interval '14 days')),
    'days', v_days))
    FROM public.products pr WHERE pr.id = ANY (p_product_ids)), '{}'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.program_card_metrics(p_product_ids uuid[], p_days integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.program_card_metrics(p_product_ids uuid[], p_days integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.program_create_item(p_product_id uuid, p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws uuid;
  v_id uuid;
  v_parent uuid := NULLIF(p ->> 'parent_id', '')::uuid;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'No existe el producto' USING ERRCODE = 'PR002'; END IF;
  PERFORM app_servicio.program_require(v_ws, 'program.manage');
  INSERT INTO app_servicio.program_items (workspace_id, product_id, parent_id, kind, lesson_type, title, description, position, created_by)
  VALUES (v_ws, p_product_id, v_parent, p ->> 'kind', NULLIF(p ->> 'lesson_type', ''), btrim(COALESCE(p ->> 'title', '')), NULLIF(p ->> 'description', ''),
          COALESCE((SELECT max(position) + 1 FROM app_servicio.program_items WHERE product_id = p_product_id AND parent_id IS NOT DISTINCT FROM v_parent), 0),
          CASE WHEN app_servicio.is_system() THEN NULL ELSE auth.uid() END)
  RETURNING id INTO v_id;
  PERFORM app_servicio.audit(v_ws, 'product', p_product_id, 'program.item_created', jsonb_build_object('item_id', v_id, 'kind', p ->> 'kind'));
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.program_create_item(p_product_id uuid, p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.program_create_item(p_product_id uuid, p jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.program_duplicate_tutor(p_agent_id uuid, p_dest_product_id uuid, p_replace boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  src public.agents;
  dest record;
  v_id uuid;
BEGIN
  SELECT * INTO src FROM public.agents WHERE id = p_agent_id AND type = 'student_tutor' AND deleted_at IS NULL;
  IF src.id IS NULL THEN RAISE EXCEPTION 'Solo se duplica el tutor de un programa' USING ERRCODE = 'IA001'; END IF;
  SELECT id, workspace_id, name, tutor_agent_id INTO dest FROM public.products WHERE id = p_dest_product_id FOR UPDATE;
  IF dest.id IS NULL OR dest.workspace_id <> src.workspace_id THEN RAISE EXCEPTION 'No existe el programa' USING ERRCODE = 'SV002'; END IF;
  IF NOT app_servicio.is_system() THEN PERFORM app_servicio.require_permission(src.workspace_id, 'tutor.manage'); END IF;
  IF (src.config ->> 'program_id') = dest.id::text THEN RAISE EXCEPTION 'Elegí otro programa' USING ERRCODE = 'IA001'; END IF;
  IF dest.tutor_agent_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.agents a WHERE a.id = dest.tutor_agent_id AND a.deleted_at IS NULL) THEN
    IF NOT p_replace THEN RAISE EXCEPTION 'Ese programa ya tiene tutor' USING ERRCODE = 'IA001'; END IF;
    UPDATE public.agents SET deleted_at = now(), is_enabled = false, updated_at = now() WHERE id = dest.tutor_agent_id;
    UPDATE public.products SET tutor_agent_id = NULL WHERE id = dest.id;
  END IF;
  INSERT INTO public.agents (workspace_id, name, type, is_enabled, system_prompt, provider, model, fallback_provider, fallback_model, temperature,
                             max_output_tokens, knowledge_enabled, knowledge_tags, knowledge_fallback, daily_cost_limit_usd, daily_cost_limit_action,
                             monthly_cost_limit_usd, monthly_cost_limit_action, guardrails, config, created_by)
  VALUES (src.workspace_id, left('Tutor · ' || dest.name, 80), 'student_tutor', src.is_enabled, src.system_prompt, src.provider, src.model,
          src.fallback_provider, src.fallback_model, src.temperature, src.max_output_tokens, true, ARRAY['programa:' || dest.id::text],
          src.knowledge_fallback, src.daily_cost_limit_usd, src.daily_cost_limit_action, src.monthly_cost_limit_usd, src.monthly_cost_limit_action,
          src.guardrails, jsonb_build_object('program_id', dest.id), CASE WHEN app_servicio.is_system() THEN NULL ELSE auth.uid() END)
  RETURNING id INTO v_id;
  UPDATE public.products SET tutor_agent_id = v_id WHERE id = dest.id;
  -- Los documentos generales del programa de origen (sin clase) tambien son del destino.
  UPDATE public.knowledge_base SET tags = array_append(tags, 'programa:' || dest.id::text), updated_at = now()
   WHERE workspace_id = src.workspace_id AND deleted_at IS NULL AND program_item_id IS NULL AND NOT internal_only
     AND tags @> ARRAY['programa:' || (src.config ->> 'program_id')] AND NOT (tags @> ARRAY['programa:' || dest.id::text]);
  PERFORM app_servicio.audit(src.workspace_id, 'product', dest.id, 'tutor.duplicated', jsonb_build_object('from_agent_id', src.id, 'agent_id', v_id, 'replaced', p_replace));
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.program_duplicate_tutor(p_agent_id uuid, p_dest_product_id uuid, p_replace boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.program_duplicate_tutor(p_agent_id uuid, p_dest_product_id uuid, p_replace boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.program_ensure_tutor(p_product_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  pr record;
  v_id uuid;
BEGIN
  SELECT id, workspace_id, name, tutor_agent_id INTO pr FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF pr.id IS NULL THEN RAISE EXCEPTION 'No existe el programa' USING ERRCODE = 'SV002'; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.is_workspace_member(pr.workspace_id)
       AND (public.has_permission(pr.workspace_id, 'tutor.manage') OR public.has_permission(pr.workspace_id, 'portal.sections'))) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF NOT app_servicio.module_on(pr.workspace_id) THEN RAISE EXCEPTION 'El módulo de Servicios está apagado' USING ERRCODE = 'SV005'; END IF;
  IF pr.tutor_agent_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.agents a WHERE a.id = pr.tutor_agent_id AND a.deleted_at IS NULL) THEN
    UPDATE public.agents SET is_enabled = true, updated_at = now() WHERE id = pr.tutor_agent_id AND NOT is_enabled;
    RETURN pr.tutor_agent_id;
  END IF;
  INSERT INTO public.agents (workspace_id, name, type, is_enabled, knowledge_enabled, knowledge_tags, daily_cost_limit_action, monthly_cost_limit_action, config, created_by)
  VALUES (pr.workspace_id, left('Tutor · ' || pr.name, 80), 'student_tutor', true, true, ARRAY['programa:' || pr.id::text], 'notify', 'notify',
          jsonb_build_object('program_id', pr.id), CASE WHEN app_servicio.is_system() THEN NULL ELSE auth.uid() END)
  RETURNING id INTO v_id;
  UPDATE public.products SET tutor_agent_id = v_id WHERE id = pr.id;
  PERFORM app_servicio.audit(pr.workspace_id, 'product', pr.id, 'tutor.created', jsonb_build_object('agent_id', v_id));
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.program_ensure_tutor(p_product_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.program_ensure_tutor(p_product_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.program_item_unlocked(p_contact_id uuid, p_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  it record;
  v_chain jsonb := '[]'::jsonb;
  cur record;
  v_module uuid;
  v_all boolean := false;
  v_included uuid[] := ARRAY[]::uuid[];
  v_services uuid[];
  v_access uuid;
  v_start date;
  v_ctx jsonb;
BEGIN
  SELECT id, workspace_id, product_id INTO it FROM app_servicio.program_items WHERE id = p_item_id;
  IF it.id IS NULL THEN RETURN NULL; END IF;
  -- La cadena, de abajo hacia arriba.
  SELECT id, parent_id, kind, status, unlock_rule INTO cur FROM app_servicio.program_items WHERE id = p_item_id;
  WHILE cur.id IS NOT NULL LOOP
    v_chain := jsonb_build_array(jsonb_build_object('id', cur.id, 'status', cur.status, 'rule', cur.unlock_rule)) || v_chain;
    IF cur.kind = 'module' THEN v_module := cur.id; END IF;
    EXIT WHEN cur.parent_id IS NULL;
    SELECT id, parent_id, kind, status, unlock_rule INTO cur FROM app_servicio.program_items WHERE id = cur.parent_id;
  END LOOP;
  -- Lo que incluye la variante: union de los servicios vigentes del contacto en este producto.
  SELECT array_agg(s.id) INTO v_services FROM app_servicio.services s
   WHERE s.contact_id = p_contact_id AND s.product_id = it.product_id AND s.status IN ('active', 'paused', 'completed');
  SELECT bool_or(COALESCE(x -> 'content' ->> 'modules', 'all') = 'all' OR jsonb_typeof(x -> 'content' -> 'modules') IS DISTINCT FROM 'array'),
         COALESCE(array_agg(DISTINCT m::uuid) FILTER (WHERE m IS NOT NULL), ARRAY[]::uuid[])
    INTO v_all, v_included
    FROM app_servicio.services s
    JOIN public.product_variants v ON v.id = s.product_variant_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.portal_settings -> 'sections', '[]'::jsonb)) x
    LEFT JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(x -> 'content' -> 'modules') = 'array' THEN x -> 'content' -> 'modules' ELSE '[]'::jsonb END) m ON true
   WHERE s.id = ANY (COALESCE(v_services, ARRAY[]::uuid[])) AND x ->> 'section' = 'program';
  IF v_module IS NOT NULL AND NOT COALESCE(v_all, false) THEN
    v_chain := jsonb_set(v_chain, '{0,included}', to_jsonb(v_module = ANY (v_included)));
  END IF;
  v_access := app_servicio.portal_access_effective(p_contact_id, it.product_id, 'program');
  SELECT app_servicio.local_date(a.starts_at, it.workspace_id) INTO v_start FROM app_servicio_portal.portal_access a WHERE a.id = v_access;
  v_ctx := jsonb_build_object(
    'today', app_servicio.today_in(it.workspace_id),
    'accessStartsOn', v_start,
    'completed', COALESCE((SELECT jsonb_agg(pp.program_item_id::text) FROM app_servicio_portal.program_progress pp WHERE pp.contact_id = p_contact_id AND pp.completed_at IS NOT NULL), '[]'::jsonb)
               || COALESCE((SELECT jsonb_agg(i.template_key) FROM app_servicio.service_items i WHERE i.service_id = ANY (COALESCE(v_services, ARRAY[]::uuid[])) AND i.status = 'completed'), '[]'::jsonb),
    'inactiveIds', COALESCE((SELECT jsonb_agg(pi.id::text) FROM app_servicio.program_items pi WHERE pi.product_id = it.product_id AND pi.status <> 'active'), '[]'::jsonb),
    'challengeStarted', EXISTS (SELECT 1 FROM app_servicio.service_phases ph WHERE ph.service_id = ANY (COALESCE(v_services, ARRAY[]::uuid[])) AND ph.challenge IS NOT NULL AND ph.status IN ('in_progress', 'completed')),
    'unlockedIds', COALESCE((SELECT jsonb_agg(pp.program_item_id::text) FROM app_servicio_portal.program_progress pp WHERE pp.contact_id = p_contact_id AND pp.unlocked_at IS NOT NULL), '[]'::jsonb));
  RETURN app_servicio.program_unlock_plan(jsonb_build_object('chain', v_chain, 'ctx', v_ctx));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.program_item_unlocked(p_contact_id uuid, p_item_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.program_item_unlocked(p_contact_id uuid, p_item_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.program_items_structure()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  p record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.products pr WHERE pr.id = NEW.product_id AND pr.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'El producto no es de este negocio' USING ERRCODE = 'PR001';
  END IF;
  IF NEW.kind = 'module' THEN
    IF NEW.parent_id IS NOT NULL THEN RAISE EXCEPTION 'Un módulo no cuelga de nada' USING ERRCODE = 'PR001'; END IF;
  ELSE
    SELECT id, kind, product_id INTO p FROM app_servicio.program_items WHERE id = NEW.parent_id;
    IF p.id IS NULL OR p.product_id <> NEW.product_id THEN RAISE EXCEPTION 'Elegí dónde va (un módulo de este programa)' USING ERRCODE = 'PR001'; END IF;
    IF NEW.kind = 'submodule' AND p.kind <> 'module' THEN RAISE EXCEPTION 'Un submódulo cuelga de un módulo' USING ERRCODE = 'PR001'; END IF;
    IF NEW.kind = 'lesson' AND p.kind NOT IN ('module', 'submodule') THEN RAISE EXCEPTION 'Una clase cuelga de un módulo o un submódulo' USING ERRCODE = 'PR001'; END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.kind <> OLD.kind AND EXISTS (SELECT 1 FROM app_servicio.program_items c WHERE c.parent_id = NEW.id) THEN
    RAISE EXCEPTION 'No se cambia el tipo de algo que tiene contenido adentro' USING ERRCODE = 'PR001';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.program_items_structure() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.program_live_recordings(p_product_id uuid)
 RETURNS TABLE(live_session_id uuid, title text, occurs_on date, recording_url text, recording_call_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT ls.id, ls.title, d.occurs_on, d.recording_url, d.recording_call_id
    FROM app_servicio.live_sessions ls JOIN app_servicio.live_session_dates d ON d.live_session_id = ls.id
   WHERE ls.product_id = p_product_id AND ls.archived_at IS NULL AND d.status <> 'cancelled' AND d.recording_active
     AND (d.recording_url IS NOT NULL OR d.recording_call_id IS NOT NULL)
   ORDER BY d.occurs_on DESC;
$function$;
REVOKE ALL ON FUNCTION app_servicio.program_live_recordings(p_product_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.program_live_recordings(p_product_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.program_progress_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  it record;
  par record;
  sv record;
  si record;
  v_total integer;
  v_done integer;
BEGIN
  BEGIN
    IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
    IF NEW.completed_at IS NULL OR (TG_OP = 'UPDATE' AND OLD.completed_at IS NOT NULL) THEN RETURN NULL; END IF;
    PERFORM app_servicio.as_system();
    SELECT id, kind, parent_id, product_id, status INTO it FROM app_servicio.program_items WHERE id = NEW.program_item_id;
    IF it.id IS NULL THEN RETURN NULL; END IF;
    -- Avisos y pasos del camino de los servicios de la persona en este producto.
    FOR sv IN SELECT id FROM app_servicio.services WHERE contact_id = NEW.contact_id AND product_id = it.product_id AND status IN ('active', 'paused') LOOP
      PERFORM app_servicio.emit_service(sv.id, CASE WHEN it.kind = 'lesson' THEN 'program_lesson_completed' ELSE 'program_module_completed' END,
                                        jsonb_build_object('program_item_id', it.id));
      FOR si IN SELECT id FROM app_servicio.service_items
                 WHERE service_id = sv.id AND status = 'pending' AND kind = 'program_item' AND ref ->> 'program_item_id' = it.id::text LOOP
        PERFORM app_servicio.svc_complete_item(si.id);
      END LOOP;
      IF it.kind = 'module' THEN PERFORM app_servicio.svc_apply_access_event(sv.id, 'module_completed', it.id::text); END IF;
    END LOOP;
    -- El padre queda completo cuando todas sus clases y submodulos ACTIVOS y obligatorios lo estan.
    IF it.parent_id IS NOT NULL THEN
      SELECT id, kind INTO par FROM app_servicio.program_items WHERE id = it.parent_id;
      SELECT count(*) FILTER (WHERE c.required), count(*) FILTER (WHERE c.required AND pp.completed_at IS NOT NULL)
        INTO v_total, v_done
        FROM app_servicio.program_items c
        LEFT JOIN app_servicio_portal.program_progress pp ON pp.program_item_id = c.id AND pp.contact_id = NEW.contact_id
       WHERE c.parent_id = par.id AND c.status = 'active';
      IF v_total > 0 AND v_done = v_total THEN
        INSERT INTO app_servicio_portal.program_progress (workspace_id, contact_id, program_item_id, completed_at)
        VALUES (NEW.workspace_id, NEW.contact_id, par.id, now())
        ON CONFLICT (contact_id, program_item_id) DO UPDATE SET completed_at = COALESCE(app_servicio_portal.program_progress.completed_at, now()), updated_at = now();
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'program_progress_hook: %', SQLERRM;
    BEGIN
      INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, actor_type, actor_label)
      VALUES (NEW.workspace_id, 'contact', NEW.contact_id, 'svc.hook_failed', jsonb_build_object('hook', 'program_progress', 'error', left(SQLSTATE || ' ' || SQLERRM, 300)), 'system', 'servicios');
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'program_progress_hook (audit): %', SQLERRM;
    END;
  END;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.program_progress_hook() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.program_reorder(p_product_id uuid, p_parent_id uuid, p_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws uuid;
  i integer;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'No existe el producto' USING ERRCODE = 'PR002'; END IF;
  PERFORM app_servicio.program_require(v_ws, 'program.manage');
  IF (SELECT count(*) FROM app_servicio.program_items WHERE product_id = p_product_id AND parent_id IS NOT DISTINCT FROM p_parent_id AND id = ANY (p_ids))
     <> cardinality(p_ids) THEN
    RAISE EXCEPTION 'Eso no es de este lugar del programa' USING ERRCODE = 'PR001';
  END IF;
  FOR i IN 1 .. cardinality(p_ids) LOOP
    UPDATE app_servicio.program_items SET position = i - 1 WHERE id = p_ids[i];
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.program_reorder(p_product_id uuid, p_parent_id uuid, p_ids uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.program_reorder(p_product_id uuid, p_parent_id uuid, p_ids uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.program_require(p_workspace_id uuid, p_key text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF app_servicio.is_system() THEN RETURN; END IF;
  IF NOT public.has_permission(p_workspace_id, p_key) THEN RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004'; END IF;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.program_require(p_workspace_id uuid, p_key text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.program_require(p_workspace_id uuid, p_key text) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.program_set_status(p_item_id uuid, p_status text, p_children boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  it record;
  n integer := 0;
BEGIN
  SELECT id, workspace_id, product_id, status INTO it FROM app_servicio.program_items WHERE id = p_item_id FOR UPDATE;
  IF it.id IS NULL THEN RAISE EXCEPTION 'No existe' USING ERRCODE = 'PR002'; END IF;
  PERFORM app_servicio.program_require(it.workspace_id, 'program.activate');
  IF p_status NOT IN ('inactive', 'active', 'archived') THEN RAISE EXCEPTION 'Estado no válido' USING ERRCODE = 'PR002'; END IF;
  UPDATE app_servicio.program_items SET status = p_status WHERE id = it.id;
  IF p_children AND p_status = 'active' THEN
    WITH RECURSIVE sub AS (
      SELECT id FROM app_servicio.program_items WHERE parent_id = it.id
      UNION ALL SELECT c.id FROM app_servicio.program_items c JOIN sub ON c.parent_id = sub.id)
    UPDATE app_servicio.program_items SET status = 'active' WHERE id IN (SELECT id FROM sub) AND status = 'inactive';
    GET DIAGNOSTICS n = ROW_COUNT;
  END IF;
  PERFORM app_servicio.audit(it.workspace_id, 'product', it.product_id, 'program.item_status',
    jsonb_build_object('item_id', it.id, 'status', jsonb_build_object('old', it.status, 'new', p_status), 'children', n));
  RETURN n;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.program_set_status(p_item_id uuid, p_status text, p_children boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.program_set_status(p_item_id uuid, p_status text, p_children boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.program_tutor_set_enabled(p_product_id uuid, p_enabled boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  pr record;
BEGIN
  SELECT id, workspace_id, tutor_agent_id INTO pr FROM public.products WHERE id = p_product_id;
  IF pr.id IS NULL THEN RAISE EXCEPTION 'No existe el programa' USING ERRCODE = 'SV002'; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.is_workspace_member(pr.workspace_id)
       AND (public.has_permission(pr.workspace_id, 'tutor.manage') OR public.has_permission(pr.workspace_id, 'portal.sections'))) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF p_enabled THEN RETURN app_servicio.program_ensure_tutor(p_product_id); END IF;
  IF pr.tutor_agent_id IS NOT NULL THEN
    UPDATE public.agents SET is_enabled = false, updated_at = now() WHERE id = pr.tutor_agent_id AND is_enabled;
  END IF;
  RETURN pr.tutor_agent_id;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.program_tutor_set_enabled(p_product_id uuid, p_enabled boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.program_tutor_set_enabled(p_product_id uuid, p_enabled boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.program_unlock_plan(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  chain jsonb := COALESCE(p -> 'chain', '[]'::jsonb);
  ctx jsonb := COALESCE(p -> 'ctx', '{}'::jsonb);
  v_today date := (ctx ->> 'today')::date;
  v_start date := NULLIF(ctx ->> 'accessStartsOn', '')::date;
  n integer := jsonb_array_length(chain);
  i integer;
  node jsonb;
  r jsonb;
  t text;
  v_open boolean;
  v_opens date;
  v_display text;
  v_visible boolean;
  v_own boolean;
  v_reason text;
  v_hidden jsonb := jsonb_build_object('visible', false, 'unlocked', false, 'included', true, 'display', 'hidden', 'reason', NULL, 'opensOn', NULL);
BEGIN
  IF n = 0 THEN RETURN v_hidden; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(chain) x WHERE x ->> 'status' <> 'active') THEN RETURN v_hidden; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(chain) x WHERE x ? 'included' AND (x ->> 'included')::boolean = false) THEN
    RETURN v_hidden || jsonb_build_object('included', false);
  END IF;
  FOR i IN 0 .. n - 1 LOOP
    node := chain -> i;
    r := COALESCE(NULLIF(node -> 'rule', 'null'::jsonb), '{"type":"open"}'::jsonb);
    t := COALESCE(r ->> 'type', 'open');
    v_opens := CASE
      WHEN t = 'fixed_date' THEN NULLIF(r ->> 'date', '')::date
      WHEN t = 'days_after_start' AND v_start IS NOT NULL THEN v_start + CASE WHEN jsonb_typeof(r -> 'days') = 'number' AND (r ->> 'days')::numeric > 0 THEN (r ->> 'days')::numeric::integer ELSE 0 END
      ELSE NULL END;
    v_open := COALESCE(ctx -> 'unlockedIds', '[]'::jsonb) ? (node ->> 'id')
      OR CASE t
        WHEN 'open' THEN true
        WHEN 'fixed_date' THEN v_opens IS NOT NULL AND v_today >= v_opens
        WHEN 'days_after_start' THEN v_opens IS NOT NULL AND v_today >= v_opens
        WHEN 'after_complete' THEN NULLIF(r ->> 'id', '') IS NOT NULL
             AND (COALESCE(ctx -> 'completed', '[]'::jsonb) ? (r ->> 'id') OR COALESCE(ctx -> 'inactiveIds', '[]'::jsonb) ? (r ->> 'id'))
        WHEN 'challenge_started' THEN COALESCE((ctx ->> 'challengeStarted')::boolean, false)
        ELSE false END;
    CONTINUE WHEN v_open;
    v_display := COALESCE(NULLIF(r ->> 'display', ''), CASE WHEN t = 'fixed_date' THEN 'coming_soon' ELSE 'locked' END);
    v_own := i = n - 1;
    v_visible := CASE WHEN v_own THEN v_display <> 'hidden' ELSE v_display = 'locked' END;
    IF NOT v_visible THEN RETURN v_hidden; END IF;
    v_reason := CASE
      WHEN v_display = 'coming_soon' AND NULLIF(r ->> 'coming_soon_text', '') IS NOT NULL THEN r ->> 'coming_soon_text'
      WHEN t IN ('fixed_date', 'days_after_start') THEN CASE WHEN v_opens IS NULL THEN 'Se abre cuando empiece tu acceso' ELSE 'Se abre el ' || to_char(v_opens, 'DD/MM/YYYY') END
      WHEN t = 'after_complete' THEN 'Se abre cuando completes lo anterior'
      WHEN t = 'challenge_started' THEN 'Se abre cuando empiece el Reto'
      ELSE COALESCE(NULLIF(r ->> 'locked_text', ''), 'Todavía no está disponible') END;
    RETURN jsonb_build_object('visible', true, 'unlocked', false, 'included', true, 'display', v_display, 'reason', v_reason,
                              'opensOn', CASE WHEN v_own AND v_opens IS NOT NULL THEN to_char(v_opens, 'YYYY-MM-DD') END);
  END LOOP;
  RETURN jsonb_build_object('visible', true, 'unlocked', true, 'included', true, 'display', 'open', 'reason', NULL, 'opensOn', NULL);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.program_unlock_plan(p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.program_unlock_plan(p jsonb) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.program_update_item(p_item_id uuid, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  it record;
BEGIN
  SELECT id, workspace_id, product_id INTO it FROM app_servicio.program_items WHERE id = p_item_id FOR UPDATE;
  IF it.id IS NULL THEN RAISE EXCEPTION 'No existe' USING ERRCODE = 'PR002'; END IF;
  PERFORM app_servicio.program_require(it.workspace_id, 'program.manage');
  IF p ? 'form_id' AND NULLIF(p ->> 'form_id', '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.forms f WHERE f.id = (p ->> 'form_id')::uuid AND f.workspace_id = it.workspace_id) THEN
    RAISE EXCEPTION 'Ese formulario no es de este negocio' USING ERRCODE = 'PR002';
  END IF;
  IF p ? 'source_call_id' AND NULLIF(p ->> 'source_call_id', '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.id = (p ->> 'source_call_id')::uuid AND c.workspace_id = it.workspace_id) THEN
    RAISE EXCEPTION 'Esa grabación no es de este negocio' USING ERRCODE = 'PR002';
  END IF;
  UPDATE app_servicio.program_items SET
    title = CASE WHEN p ? 'title' THEN btrim(p ->> 'title') ELSE title END,
    description = CASE WHEN p ? 'description' THEN NULLIF(p ->> 'description', '') ELSE description END,
    lesson_type = CASE WHEN p ? 'lesson_type' AND kind = 'lesson' THEN p ->> 'lesson_type' ELSE lesson_type END,
    video_url = CASE WHEN p ? 'video_url' THEN NULLIF(p ->> 'video_url', '') ELSE video_url END,
    video_embed_url = CASE WHEN p ? 'video_embed_url' THEN NULLIF(p ->> 'video_embed_url', '') ELSE video_embed_url END,
    duration_seconds = CASE WHEN p ? 'duration_seconds' THEN NULLIF(p ->> 'duration_seconds', '')::integer ELSE duration_seconds END,
    html_content = CASE WHEN p ? 'html_content' THEN NULLIF(p ->> 'html_content', '') ELSE html_content END,
    document_path = CASE WHEN p ? 'document_path' THEN NULLIF(p ->> 'document_path', '') ELSE document_path END,
    form_id = CASE WHEN p ? 'form_id' THEN NULLIF(p ->> 'form_id', '')::uuid ELSE form_id END,
    resources = CASE WHEN p ? 'resources' THEN p -> 'resources' ELSE resources END,
    cover_path = CASE WHEN p ? 'cover_path' THEN NULLIF(p ->> 'cover_path', '') ELSE cover_path END,
    thumbnail_path = CASE WHEN p ? 'thumbnail_path' THEN NULLIF(p ->> 'thumbnail_path', '') ELSE thumbnail_path END,
    thumbnail_url = CASE WHEN p ? 'thumbnail_url' THEN NULLIF(p ->> 'thumbnail_url', '') ELSE thumbnail_url END,
    comments_enabled = CASE WHEN p ? 'comments_enabled' THEN (p ->> 'comments_enabled')::boolean ELSE comments_enabled END,
    unlock_rule = CASE WHEN p ? 'unlock_rule' THEN p -> 'unlock_rule' ELSE unlock_rule END,
    required = CASE WHEN p ? 'required' THEN (p ->> 'required')::boolean ELSE required END,
    source_call_id = CASE WHEN p ? 'source_call_id' THEN NULLIF(p ->> 'source_call_id', '')::uuid ELSE source_call_id END
  WHERE id = it.id;
  PERFORM app_servicio.audit(it.workspace_id, 'product', it.product_id, 'program.item_updated',
    jsonb_build_object('item_id', it.id, 'keys', (SELECT jsonb_agg(k) FROM jsonb_object_keys(p) k)));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.program_update_item(p_item_id uuid, p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.program_update_item(p_item_id uuid, p jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.quiz_grade_plan(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  qs jsonb := COALESCE(p #> '{settings,questions}', '{}'::jsonb);
  ans jsonb := COALESCE(p -> 'answers', '{}'::jsonb);
  v_key text;
  q jsonb;
  v_points numeric;
  v_given text[];
  v_correct text[];
  v_exact boolean;
  v_got numeric;
  v_hits integer;
  v_total numeric := 0;
  v_earned numeric := 0;
  v_per jsonb := '{}'::jsonb;
  v_pct numeric;
  v_pass numeric := COALESCE(CASE WHEN jsonb_typeof(p #> '{settings,pass_pct}') = 'number' THEN (p #>> '{settings,pass_pct}')::numeric END, 70);
  v_attempts integer := COALESCE(CASE WHEN jsonb_typeof(p #> '{settings,attempts}') = 'number' AND (p #>> '{settings,attempts}')::numeric > 0 THEN (p #>> '{settings,attempts}')::numeric::integer END, 1);
BEGIN
  FOR v_key IN SELECT k FROM jsonb_object_keys(qs) k ORDER BY k COLLATE "C" LOOP
    q := qs -> v_key;
    v_points := CASE WHEN jsonb_typeof(q -> 'points') = 'number' AND (q ->> 'points')::numeric > 0 THEN (q ->> 'points')::numeric ELSE 0 END;
    v_total := v_total + v_points;
    v_given := CASE jsonb_typeof(ans -> v_key)
      WHEN 'array' THEN ARRAY(SELECT DISTINCT x FROM jsonb_array_elements_text(ans -> v_key) x)
      WHEN 'string' THEN CASE WHEN ans ->> v_key <> '' THEN ARRAY[ans ->> v_key] ELSE ARRAY[]::text[] END
      ELSE ARRAY[]::text[] END;
    v_correct := ARRAY(SELECT DISTINCT x FROM jsonb_array_elements_text(COALESCE(q -> 'correct', '[]'::jsonb)) x);
    v_exact := v_given <@ v_correct AND v_correct <@ v_given;
    v_got := 0;
    IF v_exact THEN
      v_got := v_points;
    ELSIF COALESCE((q ->> 'partial')::boolean, false) AND cardinality(v_correct) > 0 THEN
      v_hits := (SELECT count(*) FROM unnest(v_given) g WHERE g = ANY (v_correct));
      v_got := GREATEST(0, round(v_points * (v_hits - (cardinality(v_given) - v_hits)) / cardinality(v_correct), 2));
    END IF;
    v_earned := v_earned + v_got;
    v_per := v_per || jsonb_build_object(v_key, jsonb_build_object('earned', v_got, 'points', v_points, 'correct', v_exact));
  END LOOP;
  v_pct := CASE WHEN v_total > 0 THEN round(v_earned / v_total * 100, 2) ELSE 0 END;
  RETURN jsonb_build_object('total', round(v_total, 2), 'earned', round(v_earned, 2), 'pct', v_pct, 'passed', v_pct >= v_pass,
                            'counted', COALESCE((p ->> 'attempt')::integer, 1) <= v_attempts, 'per_question', v_per);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.quiz_grade_plan(p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.quiz_grade_plan(p jsonb) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.require_permission(p_workspace_id uuid, p_key text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_workspace_member(p_workspace_id) OR NOT public.has_permission(p_workspace_id, p_key) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.require_permission(p_workspace_id uuid, p_key text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.require_permission(p_workspace_id uuid, p_key text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.require_service(p_service app_servicio.services, p_key text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF app_servicio.is_system() THEN RETURN; END IF;
  IF NOT public.has_permission(p_service.workspace_id, p_key) OR NOT app_servicio.can_see_service_row(p_service) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.require_service(p_service app_servicio.services, p_key text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.require_service(p_service app_servicio.services, p_key text) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.sale_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  -- `record` y no el tipo de la tabla del modulo: un tipo se resuelve al ENTRAR a la funcion, antes del bloque que
  -- atrapa los errores, y un problema con la tabla haria fallar la operacion de BAIOS (verify-services, sv2).
  s record;
  v_prev_system text := COALESCE(current_setting('app_servicio.system', true), '');
BEGIN
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    PERFORM app_servicio.as_system();
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('cancelled', 'refunded') THEN
      FOR s IN SELECT * FROM app_servicio.services WHERE sale_id = NEW.id LOOP
        IF s.status = 'completed' THEN
          PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.sale_closed_after_completion', jsonb_build_object('sale_status', NEW.status), 'system');
          PERFORM app_servicio.notify_admins(s.workspace_id, 'svc_sale_closed', 'Se canceló la venta de un servicio completado',
            'El servicio queda completado. Revisalo si hace falta.', 'service', s.id);
        ELSIF s.status NOT IN ('cancelled', 'renewed') THEN
          PERFORM app_servicio.svc_cancel_core(s.id,
            CASE WHEN NEW.status = 'refunded' THEN 'reembolso' ELSE COALESCE(nullif(btrim(NEW.cancellation_reason), ''), 'Venta cancelada') END,
            CASE WHEN NEW.status = 'refunded' THEN 'refunded' ELSE 'cancelled' END);
        END IF;
      END LOOP;
      -- Una venta que extendio un servicio no se revierte sola (F115): aviso con "Revertir la extension".
      FOR s IN SELECT * FROM app_servicio.services WHERE NEW.id = ANY (extension_sale_ids) LOOP
        PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.extension_sale_closed', jsonb_build_object('sale_id', NEW.id, 'sale_status', NEW.status), 'system');
        PERFORM app_servicio.notify_admins(s.workspace_id, 'svc_extension_sale_closed', 'Se canceló una venta que extendió un servicio',
          'Podés revertir la extensión desde la ficha del servicio.', 'service', s.id, jsonb_build_object('sale_id', NEW.id));
      END LOOP;
    END IF;
    -- La venta cambio despues: el servicio no cambia solo (F10, §14f).
    IF NEW.product_variant_id IS DISTINCT FROM OLD.product_variant_id OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
       OR (NEW.product_snapshot ->> 'product_id') IS DISTINCT FROM (OLD.product_snapshot ->> 'product_id') THEN
      FOR s IN SELECT * FROM app_servicio.services WHERE sale_id = NEW.id AND status NOT IN ('cancelled') LOOP
        UPDATE app_servicio.services SET flags = flags || '{"sale_changed": true}'::jsonb WHERE id = s.id;
        PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.sale_changed', jsonb_build_object('sale_id', NEW.id), 'system');
        PERFORM app_servicio.notify(s.workspace_id, s.owner_user_id, 'svc_sale_changed', 'La venta cambió: revisá el servicio',
          COALESCE(s.product_snapshot ->> 'product_name', ''), 'service', s.id);
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'sale', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  PERFORM set_config('app_servicio.system', v_prev_system, true);
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.sale_hook() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.service_attendance(p_service_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
  v_from date;
  v_to date;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL THEN RETURN NULL; END IF;
  IF NOT app_servicio.is_system() AND NOT app_servicio.can_see_service_row(s) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF s.starts_on IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_to := LEAST(app_servicio.today_in(s.workspace_id), COALESCE(s.ends_on, app_servicio.today_in(s.workspace_id)));
  -- Hasta un año para atras: una ficha no necesita mas y la cuenta queda acotada.
  v_from := GREATEST(s.starts_on, v_to - 366);
  IF v_to < v_from THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'live_session_id', o.live_session_id, 'title', ls.title, 'occurs_on', o.occurs_on, 'starts_at', o.starts_at,
      'attended', a.id IS NOT NULL, 'source', a.source) ORDER BY o.starts_at DESC)
      FROM app_servicio.live_session_occurrences(s.product_id, v_from, v_to) o
      JOIN app_servicio.live_sessions ls ON ls.id = o.live_session_id
      LEFT JOIN app_servicio_portal.live_attendance a
        ON a.live_session_id = o.live_session_id AND a.occurs_on = o.occurs_on AND a.contact_id = s.contact_id AND a.removed_at IS NULL
     WHERE o.status <> 'cancelled' AND o.starts_at <= now()
       AND (a.id IS NOT NULL OR EXISTS (SELECT 1 FROM app_servicio.attendance_base_members(o.live_session_id, o.occurs_on) b WHERE b.contact_id = s.contact_id))
  ), '[]'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.service_attendance(p_service_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.service_attendance(p_service_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.service_classroom(p_service_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL THEN RETURN NULL; END IF;
  IF NOT app_servicio.is_system() AND NOT app_servicio.can_see_service_row(s) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  RETURN jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'parent_id', i.parent_id, 'kind', i.kind, 'lesson_type', i.lesson_type, 'title', i.title,
        'position', i.position, 'required', i.required,
        'viewed_at', pp.viewed_at, 'completed_at', pp.completed_at,
        -- La ultima entrega de una actividad o evaluacion de esa persona (sin revelar respuestas ni notas internas).
        'submission', CASE WHEN i.form_id IS NULL THEN NULL ELSE (
          SELECT jsonb_build_object('created_at', fs.created_at, 'review_status', fs.review_status)
            FROM public.form_submissions fs
           WHERE fs.form_id = i.form_id AND fs.contact_id = s.contact_id AND fs.workspace_id = s.workspace_id
           ORDER BY fs.created_at DESC LIMIT 1) END,
        -- Solo los modulos llevan su apertura: una clase hereda la de su modulo y el portal decide el resto.
        'unlock', CASE WHEN i.kind = 'module' THEN app_servicio.program_item_unlocked(s.contact_id, i.id) END)
        ORDER BY i.position, i.created_at)
        FROM app_servicio.program_items i
        LEFT JOIN app_servicio_portal.program_progress pp ON pp.program_item_id = i.id AND pp.contact_id = s.contact_id
       WHERE i.product_id = s.product_id AND i.workspace_id = s.workspace_id AND i.status = 'active'), '[]'::jsonb));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.service_classroom(p_service_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.service_classroom(p_service_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.set_module_enabled(p_workspace_id uuid, p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_before boolean;
  v_active integer;
BEGIN
  SELECT services_enabled INTO v_before FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe el negocio' USING ERRCODE = 'SV002';
  END IF;
  SELECT count(*) INTO v_active FROM app_servicio.services
   WHERE workspace_id = p_workspace_id AND status IN ('active', 'paused', 'pending_confirmation');
  IF v_before IS DISTINCT FROM p_enabled THEN
    UPDATE public.workspaces SET services_enabled = p_enabled WHERE id = p_workspace_id;
    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, actor_type, actor_label)
    VALUES (p_workspace_id, 'workspace', p_workspace_id, 'svc.module_toggled',
            jsonb_build_object('services_enabled', jsonb_build_object('old', v_before, 'new', p_enabled), 'active_services', v_active),
            'system', 'plataforma');
  END IF;
  RETURN jsonb_build_object(
    'enabled', p_enabled,
    'changed', v_before IS DISTINCT FROM p_enabled,
    'active_services', v_active,
    'message', CASE WHEN NOT p_enabled AND v_active > 0
      THEN format('Hay %s servicios activos: quedan como están, pero no avanzan solos mientras el módulo esté apagado', v_active)
      ELSE NULL END
  );
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.set_module_enabled(p_workspace_id uuid, p_enabled boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.set_module_enabled(p_workspace_id uuid, p_enabled boolean) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.signature_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_contact uuid;
  v_item uuid;
  v_prev_system text := COALESCE(current_setting('app_servicio.system', true), '');
BEGIN
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    PERFORM app_servicio.as_system();
    SELECT fs.contact_id, fs.service_item_id INTO v_contact, v_item FROM public.form_submissions fs WHERE fs.id = NEW.submission_id;
    v_contact := COALESCE(NEW.contact_id, v_contact);
    IF v_contact IS NOT NULL THEN
      PERFORM app_servicio.svc_complete_by_form(NEW.workspace_id, v_contact, NEW.form_id, v_item, 'contract', 'contract_signature');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'contract_signature', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  PERFORM set_config('app_servicio.system', v_prev_system, true);
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.signature_hook() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.submission_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_type text;
  v_done uuid;
  v_owner uuid;
  v_prev_system text := COALESCE(current_setting('app_servicio.system', true), '');
BEGIN
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    PERFORM app_servicio.as_system();
    IF NEW.status = 'received' AND NEW.contact_id IS NOT NULL THEN
      SELECT f.type INTO v_type FROM public.forms f WHERE f.id = NEW.form_id;
      IF v_type IN ('custom', 'survey') THEN
        v_done := app_servicio.svc_complete_by_form(NEW.workspace_id, NEW.contact_id, NEW.form_id, NEW.service_item_id,
                    CASE v_type WHEN 'survey' THEN 'survey' ELSE 'form' END, 'form_submission');
        -- Un link firmado que no se pudo ubicar: no completa nada y avisa al responsable (F17).
        IF v_done IS NULL AND (NEW.meta ? 'service_item_id' OR NEW.service_id IS NOT NULL) THEN
          -- service_id no tiene clave foranea (00331): solo cuenta un servicio de este negocio y este contacto.
          SELECT s.owner_user_id INTO v_owner FROM app_servicio.services s
           WHERE s.id = NEW.service_id AND s.workspace_id = NEW.workspace_id AND s.contact_id = NEW.contact_id;
          PERFORM app_servicio.notify(NEW.workspace_id, v_owner, 'svc_item_unmatched', 'Llegó una respuesta que no se pudo ubicar',
            'No completó ningún paso del camino. Revisala.', 'form_submission', NEW.id);
          PERFORM app_servicio.audit(NEW.workspace_id, 'form_submission', NEW.id, 'svc.item_unmatched', jsonb_build_object('form_id', NEW.form_id), 'system');
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'form_submission', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  PERFORM set_config('app_servicio.system', v_prev_system, true);
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.submission_hook() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.submission_item_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- `service_item_id` no tiene clave foranea (00331): este trigger es lo unico que lo pone. Al insertar, solo
-- con un paso que existe y es del mismo negocio, contacto y servicio; si no, NULL. Despues no cambia nunca.
DECLARE
  v_item uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.service_item_id := OLD.service_item_id;
    RETURN NEW;
  END IF;
  NEW.service_item_id := NULL;
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NEW; END IF;
  BEGIN
    IF NEW.meta ? 'service_item_id' AND (NEW.meta ->> 'service_item_id') ~* '^[0-9a-f-]{36}$' THEN
      SELECT i.id INTO v_item FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id
       WHERE i.id = (NEW.meta ->> 'service_item_id')::uuid AND s.workspace_id = NEW.workspace_id
         AND s.contact_id IS NOT DISTINCT FROM NEW.contact_id AND (NEW.service_id IS NULL OR s.id = NEW.service_id);
      NEW.service_item_id := v_item;  -- NULL si no es del mismo servicio y contacto: se descarta
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NEW.service_item_id := NULL;
    RAISE WARNING 'app_servicio.submission_item_hook: %', SQLERRM;
  END;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.submission_item_hook() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.submission_review(p_submission_id uuid, p_status text, p_grade_value jsonb, p_comment text, p_internal_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  fs record;
  v_type text;
  v_product uuid;
  v_grading jsonb;
  v_grade jsonb;
  v_passed boolean;
  sv record;
  v_prev_system text;
BEGIN
  SELECT * INTO fs FROM public.form_submissions WHERE id = p_submission_id FOR UPDATE;
  IF fs.id IS NULL THEN RAISE EXCEPTION 'No existe la entrega' USING ERRCODE = 'EV002'; END IF;
  SELECT f.type, f.product_id INTO v_type, v_product FROM public.forms f WHERE f.id = fs.form_id;
  IF v_type <> 'activity' THEN RAISE EXCEPTION 'Solo se revisan actividades' USING ERRCODE = 'EV002'; END IF;
  IF NOT app_servicio.is_system() AND NOT (
       public.has_permission(fs.workspace_id, 'submissions.review')
       AND EXISTS (SELECT 1 FROM app_servicio.services s WHERE s.contact_id = fs.contact_id AND s.product_id = v_product AND app_servicio.can_see_service_row(s))) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF p_status NOT IN ('reviewed', 'needs_changes') THEN RAISE EXCEPTION 'Elegí Revisada o A corregir' USING ERRCODE = 'EV001'; END IF;
  SELECT fv.definition -> 'grading' INTO v_grading FROM public.form_versions fv WHERE fv.id = fs.form_version_id;
  IF COALESCE((v_grading ->> 'enabled')::boolean, false) AND p_status = 'reviewed' THEN
    v_passed := app_servicio.grading_passed(v_grading ->> 'scale', p_grade_value, v_grading -> 'pass_at');
    IF v_passed IS NULL THEN RAISE EXCEPTION 'Ese valor no es de la escala' USING ERRCODE = 'EV001'; END IF;
    v_grade := jsonb_build_object('scale', v_grading ->> 'scale', 'value', p_grade_value, 'passed', v_passed);
  END IF;
  UPDATE public.form_submissions SET review_status = p_status, review_comment = NULLIF(btrim(COALESCE(p_comment, '')), ''),
         internal_note = NULLIF(btrim(COALESCE(p_internal_note, '')), ''), reviewed_by = auth.uid(), reviewed_at = now(),
         grade = COALESCE(v_grade, grade), updated_at = now()
   WHERE id = fs.id;
  PERFORM app_servicio.audit(fs.workspace_id, 'form_submission', fs.id, 'svc.submission_reviewed', jsonb_build_object('status', p_status, 'passed', v_passed));
  v_prev_system := COALESCE(current_setting('app_servicio.system', true), '');
  PERFORM app_servicio.as_system();
  IF p_status = 'reviewed' THEN
    PERFORM app_servicio.svc_complete_portal_form(fs.workspace_id, fs.contact_id, fs.form_id, 'activity',
      CASE WHEN v_passed IS NULL OR v_passed THEN ARRAY['reviewed', 'passed'] ELSE ARRAY['reviewed'] END, 'activity_review');
  END IF;
  FOR sv IN SELECT id FROM app_servicio.services WHERE contact_id = fs.contact_id AND product_id = v_product AND status IN ('active', 'paused') LOOP
    PERFORM app_servicio.emit_service(sv.id, 'task_submission_reviewed', jsonb_build_object('form_id', fs.form_id, 'submission_id', fs.id, 'status', p_status, 'passed', v_passed));
  END LOOP;
  PERFORM set_config('app_servicio.system', v_prev_system, true);
  RETURN jsonb_build_object('status', p_status, 'passed', v_passed);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.submission_review(p_submission_id uuid, p_status text, p_grade_value jsonb, p_comment text, p_internal_note text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.submission_review(p_submission_id uuid, p_status text, p_grade_value jsonb, p_comment text, p_internal_note text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_access_extend(p_access_id uuid, p_ends_on date, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  a record;
  s app_servicio.services;
  v_new timestamptz;
BEGIN
  SELECT * INTO a FROM app_servicio_portal.portal_access WHERE id = p_access_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'No existe ese acceso' USING ERRCODE = 'AC003'; END IF;
  s := app_servicio.svc_get(a.service_id);
  PERFORM app_servicio.require_service(s, 'services.access');
  IF a.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Un acceso revocado no se extiende: dá uno nuevo' USING ERRCODE = 'AC002'; END IF;
  IF p_ends_on IS NULL THEN RAISE EXCEPTION 'Elegí hasta cuándo' USING ERRCODE = 'AC002'; END IF;
  v_new := app_servicio.end_of_day(p_ends_on, app_servicio.ws_tz(a.workspace_id));
  IF a.ends_at IS NULL OR v_new <= a.ends_at THEN RAISE EXCEPTION 'La fecha nueva tiene que ser posterior a la de hoy' USING ERRCODE = 'AC002'; END IF;
  UPDATE app_servicio_portal.portal_access SET ends_at = v_new, until_type = 'manual', updated_at = now() WHERE id = a.id;
  PERFORM app_servicio.audit(a.workspace_id, 'service', a.service_id, 'svc.access_extended',
    jsonb_build_object('section', a.section, 'ends_at', jsonb_build_object('old', a.ends_at, 'new', v_new), 'reason', NULLIF(btrim(COALESCE(p_reason, '')), '')));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_access_extend(p_access_id uuid, p_ends_on date, p_reason text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_access_extend(p_access_id uuid, p_ends_on date, p_reason text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_access_give_now(p_service_id uuid, p_section text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
BEGIN
  s := app_servicio.svc_get(p_service_id, true);
  PERFORM app_servicio.require_service(s, 'services.access');
  PERFORM app_servicio.svc_open_access(s.id, p_section, 'give_now', 'automation');
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.access_given_now', jsonb_build_object('section', p_section));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_access_give_now(p_service_id uuid, p_section text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_access_give_now(p_service_id uuid, p_section text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_access_grant_extra(p_service_id uuid, p_section text, p_product_id uuid, p_ends_on date, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
  v_id uuid;
BEGIN
  s := app_servicio.svc_get(p_service_id, true);
  PERFORM app_servicio.require_service(s, 'services.access');
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'AC001'; END IF;
  IF p_section NOT IN ('program', 'calendar', 'challenge', 'certificate', 'assistant', 'community', 'affiliates') THEN
    RAISE EXCEPTION 'Esa sección no existe' USING ERRCODE = 'AC003';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products pr WHERE pr.id = COALESCE(p_product_id, s.product_id) AND pr.workspace_id = s.workspace_id) THEN
    RAISE EXCEPTION 'Ese programa no es de este negocio' USING ERRCODE = 'AC003';
  END IF;
  IF p_ends_on IS NOT NULL AND p_ends_on < app_servicio.today_in(s.workspace_id) THEN RAISE EXCEPTION 'La fecha ya pasó' USING ERRCODE = 'AC002'; END IF;
  v_id := app_servicio.svc_insert_access(s.id, COALESCE(p_product_id, s.product_id), p_section, p_ends_on,
            CASE WHEN p_ends_on IS NULL THEN 'forever' ELSE 'fixed_date' END, 'manual_extra', NULL, p_reason, NULL);
  IF v_id IS NULL THEN RAISE EXCEPTION 'Ya tiene ese acceso vigente: extendelo' USING ERRCODE = 'AC004'; END IF;
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.access_extra', jsonb_build_object('section', p_section, 'reason', btrim(p_reason)));
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_access_grant_extra(p_service_id uuid, p_section text, p_product_id uuid, p_ends_on date, p_reason text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_access_grant_extra(p_service_id uuid, p_section text, p_product_id uuid, p_ends_on date, p_reason text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_access_revoke(p_access_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  a record;
  s app_servicio.services;
BEGIN
  SELECT * INTO a FROM app_servicio_portal.portal_access WHERE id = p_access_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'No existe ese acceso' USING ERRCODE = 'AC003'; END IF;
  s := app_servicio.svc_get(a.service_id);
  PERFORM app_servicio.require_service(s, 'services.access');
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'AC001'; END IF;
  IF a.revoked_at IS NOT NULL THEN RETURN; END IF;
  UPDATE app_servicio_portal.portal_access SET revoked_at = now(), revoke_reason = 'manual', updated_at = now() WHERE id = a.id;
  PERFORM app_servicio.audit(a.workspace_id, 'service', a.service_id, 'svc.access_revoked', jsonb_build_object('section', a.section, 'reason', btrim(p_reason)));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_access_revoke(p_access_id uuid, p_reason text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_access_revoke(p_access_id uuid, p_reason text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_access_tick(p_workspace_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  sid uuid;
  n integer := 0;
  m jsonb;
BEGIN
  IF NOT app_servicio.module_on(p_workspace_id) THEN RETURN jsonb_build_object('opened', 0); END IF;
  PERFORM app_servicio.as_system();
  FOR sid IN SELECT id FROM app_servicio.services WHERE workspace_id = p_workspace_id AND status = 'active' LOOP
    BEGIN
      n := n + app_servicio.svc_apply_access_event(sid, 'tick', NULL);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'svc_access_tick: %', SQLERRM;
    END;
  END LOOP;
  m := app_servicio.svc_overdue_sweep(p_workspace_id);
  RETURN jsonb_build_object('opened', n) || m;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_access_tick(p_workspace_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_access_tick(p_workspace_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_activate(p_service_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
BEGIN
  PERFORM app_servicio.svc_instantiate_journey(p_service_id);
  PERFORM app_servicio.svc_grant_initial_access(p_service_id);
  PERFORM app_servicio.svc_compute_light(p_service_id);
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.starts_on IS NULL OR s.starts_on <= app_servicio.today_in(s.workspace_id) THEN
    PERFORM app_servicio.emit(s, 'service_started');
    UPDATE app_servicio.services SET flags = flags || '{"started_emitted": true}'::jsonb WHERE id = p_service_id;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_activate(p_service_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_activate(p_service_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_apply_access_event(p_service_id uuid, p_event text, p_ref text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s record;
  v_portal jsonb;
  r jsonb;
  w jsonb;
  a record;
  v_today date;
  n integer := 0;
BEGIN
  SELECT id, workspace_id, contact_id, product_id, product_variant_id, status, starts_on, ends_on INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL OR s.status <> 'active' OR NOT app_servicio.module_on(s.workspace_id) OR s.product_variant_id IS NULL THEN RETURN 0; END IF;
  SELECT v.portal_settings INTO v_portal FROM public.product_variants v WHERE v.id = s.product_variant_id;
  v_today := app_servicio.today_in(s.workspace_id);
  -- Cerrar lo que llega a su «hasta» (fase o paso).
  IF p_event IN ('phase_completed', 'item_completed') THEN
    FOR a IN SELECT id, section FROM app_servicio_portal.portal_access
              WHERE service_id = s.id AND revoked_at IS NULL AND until_type = p_event AND source <> 'manual_extra' LOOP
      r := app_servicio.portal_section_rule(s.product_variant_id, a.section);
      IF app_servicio.portal_access_until_reached(jsonb_build_object('until', r -> 'until', 'event', jsonb_build_object('type', p_event, 'ref', p_ref))) THEN
        UPDATE app_servicio_portal.portal_access SET revoked_at = now(), revoke_reason = 'until_reached', updated_at = now() WHERE id = a.id;
        PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.access_closed', jsonb_build_object('section', a.section, 'reason', 'until_reached'));
        n := n + 1;
      END IF;
    END LOOP;
  END IF;
  -- Abrir: solo con el portal de la variante prendido, y solo lo que nunca se abrio (una revocada no vuelve sola).
  IF NOT COALESCE((v_portal ->> 'enabled')::boolean, false) THEN RETURN n; END IF;
  FOR r IN SELECT x FROM jsonb_array_elements(COALESCE(v_portal -> 'sections', '[]'::jsonb)) x WHERE COALESCE((x ->> 'included')::boolean, true) LOOP
    CONTINUE WHEN NOT app_servicio.portal_section_enabled(s.product_id, r ->> 'section');
    CONTINUE WHEN EXISTS (SELECT 1 FROM app_servicio_portal.portal_access WHERE service_id = s.id AND product_id = s.product_id AND section = r ->> 'section');
    w := app_servicio.portal_access_window(jsonb_build_object('rule', jsonb_build_object('opens', r -> 'opens', 'until', r -> 'until'),
           'event', jsonb_build_object('type', p_event, 'ref', p_ref), 'startsOn', s.starts_on, 'endsOn', s.ends_on, 'today', v_today));
    IF w ->> 'action' = 'open' THEN
      IF app_servicio.svc_insert_access(s.id, s.product_id, r ->> 'section', NULLIF(w ->> 'endsOn', '')::date, w ->> 'untilType',
           CASE WHEN p_event IN ('service_start', 'tick') THEN 'service_start' ELSE 'journey_item' END, p_event || COALESCE(':' || p_ref, ''), NULL,
           CASE WHEN jsonb_typeof(r -> 'ai_limit_usd') = 'number' THEN (r ->> 'ai_limit_usd')::numeric END) IS NOT NULL THEN
        n := n + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN n;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_apply_access_event(p_service_id uuid, p_event text, p_ref text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_apply_access_event(p_service_id uuid, p_event text, p_ref text) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_bulk_set_owner(p_service_ids uuid[], p_user_id uuid, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_id uuid;
  s app_servicio.services;
  n integer := 0;
BEGIN
  IF nullif(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'SV016'; END IF;
  FOREACH v_id IN ARRAY p_service_ids LOOP
    s := app_servicio.svc_get(v_id);
    PERFORM app_servicio.require_service(s, 'services.change_owner');
    PERFORM app_servicio.svc_set_owner_core(v_id, p_user_id, p_reason);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_bulk_set_owner(p_service_ids uuid[], p_user_id uuid, p_reason text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_bulk_set_owner(p_service_ids uuid[], p_user_id uuid, p_reason text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_cancel_core(p_service_id uuid, p_reason text, p_cut text DEFAULT 'cancelled'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
  v_prev text;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id FOR UPDATE;
  IF s.status IN ('cancelled', 'renewed') THEN RETURN; END IF;
  v_prev := s.status;
  UPDATE app_servicio.services SET status = 'cancelled', cancel_reason = p_reason, cancelled_at = now() WHERE id = s.id;
  PERFORM app_servicio.svc_cut_access(s.id, p_cut);
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.cancelled', jsonb_build_object('reason', p_reason, 'previous_status', v_prev));
  SELECT * INTO s FROM app_servicio.services WHERE id = s.id;
  PERFORM app_servicio.svc_compute_light(s.id);
  PERFORM app_servicio.emit(s, 'service_status_changed', jsonb_build_object('previous_status', v_prev));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_cancel_core(p_service_id uuid, p_reason text, p_cut text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_cancel_core(p_service_id uuid, p_reason text, p_cut text) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_cancel(p_service_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
BEGIN
  s := app_servicio.svc_get(p_service_id);
  PERFORM app_servicio.require_service(s, 'services.cancel');
  IF nullif(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'SV016'; END IF;
  IF s.status IN ('cancelled', 'renewed') THEN RAISE EXCEPTION 'El servicio ya está cerrado' USING ERRCODE = 'SV017'; END IF;
  PERFORM app_servicio.svc_cancel_core(p_service_id, p_reason, 'cancelled');
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_cancel(p_service_id uuid, p_reason text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_cancel(p_service_id uuid, p_reason text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_check_open_items(p_phase_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  it app_servicio.service_items;
BEGIN
  FOR it IN SELECT i.* FROM app_servicio.service_items i
             WHERE i.phase_id = p_phase_id AND i.status = 'pending' AND i.kind IN ('open_section', 'open_module') AND i.parent_item_id IS NULL
             ORDER BY i.position LOOP
    IF NOT EXISTS (SELECT 1 FROM app_servicio.service_items o
                   WHERE o.phase_id = p_phase_id AND o.position < it.position AND o.status <> 'completed' AND NOT o.is_recurring_template) THEN
      IF it.kind = 'open_section' THEN
        PERFORM app_servicio.svc_open_access(it.service_id, it.ref ->> 'section', COALESCE(it.ref ->> 'scope', 'product'), 'journey_item');
      ELSE
        PERFORM app_servicio.svc_open_module(it.service_id, (it.ref ->> 'program_item_id')::uuid, 'journey_item');
      END IF;
      PERFORM app_servicio.svc_mark_item(it.id, 'auto', 'system', NULL);
    END IF;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_check_open_items(p_phase_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_check_open_items(p_phase_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_complete_by_form(p_workspace_id uuid, p_contact_id uuid, p_form_id uuid, p_signed_item uuid, p_kinds text, p_source text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  it app_servicio.service_items;
  v_count integer;
  v_kinds text[] := string_to_array(p_kinds, ',');
BEGIN
  IF p_signed_item IS NOT NULL THEN
    SELECT i.* INTO it FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id
     WHERE i.id = p_signed_item AND s.contact_id = p_contact_id AND i.status = 'pending' AND i.kind = ANY (v_kinds)
       AND i.ref ->> 'form_id' = p_form_id::text AND COALESCE(i.ref ->> 'complete_on', 'submitted') = 'submitted';
    IF it.id IS NOT NULL THEN
      PERFORM app_servicio.svc_mark_item(it.id, p_source, 'client', NULL);
      RETURN it.id;
    END IF;
    RETURN NULL;
  END IF;
  -- Sin paso firmado: los pasos pendientes con ese formulario en servicios activos del contacto, primero
  -- los de la fase en curso; si hay varios servicios, el mas antiguo.
  SELECT count(DISTINCT i.service_id) INTO v_count
    FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id JOIN app_servicio.service_phases ph ON ph.id = i.phase_id
   WHERE s.workspace_id = p_workspace_id AND s.contact_id = p_contact_id AND s.status = 'active' AND i.status = 'pending' AND NOT i.is_recurring_template
     AND i.kind = ANY (v_kinds) AND i.ref ->> 'form_id' = p_form_id::text AND COALESCE(i.ref ->> 'complete_on', 'submitted') = 'submitted'
     AND ph.status <> 'completed';
  IF v_count = 0 THEN RETURN NULL; END IF;
  SELECT i.* INTO it
    FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id JOIN app_servicio.service_phases ph ON ph.id = i.phase_id
   WHERE s.workspace_id = p_workspace_id AND s.contact_id = p_contact_id AND s.status = 'active' AND i.status = 'pending' AND NOT i.is_recurring_template
     AND i.kind = ANY (v_kinds) AND i.ref ->> 'form_id' = p_form_id::text AND COALESCE(i.ref ->> 'complete_on', 'submitted') = 'submitted'
     AND ph.status <> 'completed'
   ORDER BY s.created_at, (ph.status = 'in_progress') DESC, ph.position, i.position, i.occurrence_index NULLS FIRST
   LIMIT 1;
  IF v_count > 1 THEN
    PERFORM app_servicio.audit(p_workspace_id, 'service_item', it.id, 'svc.item_ambiguous',
      jsonb_build_object('service_id', it.service_id, 'form_id', p_form_id, 'services', v_count), 'system');
  END IF;
  PERFORM app_servicio.svc_mark_item(it.id, p_source, 'client', NULL);
  RETURN it.id;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_complete_by_form(p_workspace_id uuid, p_contact_id uuid, p_form_id uuid, p_signed_item uuid, p_kinds text, p_source text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_complete_by_form(p_workspace_id uuid, p_contact_id uuid, p_form_id uuid, p_signed_item uuid, p_kinds text, p_source text) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_complete_item(p_item_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  it app_servicio.service_items;
  s app_servicio.services;
BEGIN
  SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id;
  IF it.id IS NULL THEN RAISE EXCEPTION 'No existe el paso' USING ERRCODE = 'SV002'; END IF;
  s := app_servicio.svc_get(it.service_id);
  PERFORM app_servicio.svc_require_item(s, it);
  RETURN app_servicio.svc_mark_item(it.id, 'manual', 'user', auth.uid());
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_complete_item(p_item_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_complete_item(p_item_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_complete_portal_form(p_workspace_id uuid, p_contact_id uuid, p_form_id uuid, p_kind text, p_met text[], p_source text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  it record;
  n integer := 0;
BEGIN
  FOR it IN
    SELECT i.id FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id
     WHERE s.workspace_id = p_workspace_id AND s.contact_id = p_contact_id AND s.status IN ('active', 'paused') AND i.status = 'pending'
       AND NOT i.is_recurring_template AND i.kind = p_kind AND i.ref ->> 'form_id' = p_form_id::text
       AND COALESCE(i.ref ->> 'complete_on', CASE p_kind WHEN 'quiz' THEN 'passed' ELSE 'submitted' END) = ANY (p_met)
  LOOP
    PERFORM app_servicio.svc_mark_item(it.id, p_source, 'client', NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_complete_portal_form(p_workspace_id uuid, p_contact_id uuid, p_form_id uuid, p_kind text, p_met text[], p_source text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_complete_portal_form(p_workspace_id uuid, p_contact_id uuid, p_form_id uuid, p_kind text, p_met text[], p_source text) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_complete(p_service_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
BEGIN
  s := app_servicio.svc_get(p_service_id);
  PERFORM app_servicio.require_service(s, 'services.complete');
  IF nullif(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'SV016'; END IF;
  IF s.status NOT IN ('active', 'paused') THEN RAISE EXCEPTION 'El servicio no está activo' USING ERRCODE = 'SV017'; END IF;
  PERFORM app_servicio.svc_finish(p_service_id, p_reason);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_complete(p_service_id uuid, p_reason text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_complete(p_service_id uuid, p_reason text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_compute_due(p_item_id uuid)
 RETURNS date
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  it app_servicio.service_items;
  s app_servicio.services;
  ph app_servicio.service_phases;
  v_done timestamptz;
  v_due date;
BEGIN
  SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id;
  IF it.id IS NULL OR it.due_rule IS NULL OR it.parent_item_id IS NOT NULL OR it.is_recurring_template THEN RETURN NULL; END IF;
  SELECT * INTO s FROM app_servicio.services WHERE id = it.service_id;
  SELECT * INTO ph FROM app_servicio.service_phases WHERE id = it.phase_id;
  IF it.due_rule ->> 'from' = 'item_completed' THEN
    SELECT o.completed_at INTO v_done FROM app_servicio.service_items o
     WHERE o.service_id = it.service_id AND o.template_key = it.due_rule ->> 'item_key' AND o.parent_item_id IS NULL AND o.status = 'completed';
  END IF;
  v_due := app_servicio.svc_due_date(it.due_rule, jsonb_build_object(
    'serviceCreated', app_servicio.local_date(s.created_at, s.workspace_id),
    'serviceStart', s.starts_on,
    'phaseStart', app_servicio.local_date(ph.started_at, s.workspace_id),
    'itemCompleted', app_servicio.local_date(v_done, s.workspace_id)));
  UPDATE app_servicio.service_items SET due_on = v_due WHERE id = p_item_id AND due_on IS DISTINCT FROM v_due;
  IF it.task_id IS NOT NULL THEN
    UPDATE public.tasks SET due_date = v_due WHERE id = it.task_id AND status <> 'completed' AND due_date IS DISTINCT FROM v_due;
  END IF;
  RETURN v_due;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_compute_due(p_item_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_compute_due(p_item_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_compute_light(p_service_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
  ph app_servicio.service_phases;
  v_today date;
  v_grey boolean;
  v_phase jsonb := NULL; v_late jsonb := NULL; v_items jsonb;
  v_overdue integer := NULL; v_red_days integer;
  v_result jsonb;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL THEN RETURN NULL; END IF;
  v_today := app_servicio.today_in(s.workspace_id);
  SELECT * INTO ph FROM app_servicio.service_phases WHERE service_id = s.id AND status = 'in_progress';
  v_grey := s.status <> 'active' OR s.is_test OR (s.starts_on IS NOT NULL AND s.starts_on > v_today);
  IF NOT v_grey THEN
    IF ph.id IS NOT NULL THEN
      v_phase := jsonb_build_object('name', ph.name, 'daysIn', v_today - app_servicio.local_date(ph.started_at, s.workspace_id),
                                    'yellowDay', ph.yellow_day, 'redDay', ph.red_day);
      IF ph.late_light IS NOT NULL THEN
        v_late := jsonb_build_object('enabled', COALESCE((ph.late_light ->> 'enabled')::boolean, false),
          'yellowAt', COALESCE((ph.late_light ->> 'yellow_at')::integer, 1), 'redAt', COALESCE((ph.late_light ->> 'red_at')::integer, 3),
          'phaseName', ph.name,
          'count', (SELECT count(*) FROM app_servicio.service_items i WHERE i.phase_id = ph.id AND i.parent_item_id IS NOT NULL
                     AND i.status = 'pending' AND i.due_at < now()));
      END IF;
      SELECT COALESCE(jsonb_agg(jsonb_build_object('name', i.name,
               'daysOverdue', v_today - COALESCE(i.due_on, app_servicio.local_date(i.due_at, s.workspace_id)),
               'yellowAfter', i.yellow_after_days, 'redAfter', i.red_after_days)), '[]'::jsonb)
        INTO v_items
        FROM app_servicio.service_items i
       WHERE i.phase_id = ph.id AND i.status = 'pending' AND NOT i.is_recurring_template
         AND (i.yellow_after_days IS NOT NULL OR i.red_after_days IS NOT NULL)
         AND COALESCE(i.due_on, app_servicio.local_date(i.due_at, s.workspace_id)) <= v_today;
    END IF;
    IF s.sale_id IS NOT NULL THEN
      SELECT max(v_today - p.due_date) INTO v_overdue FROM public.payments p
       WHERE p.sale_id = s.sale_id AND p.status = 'overdue' AND p.due_date IS NOT NULL;
    END IF;
    SELECT COALESCE((pv.service_settings #>> '{light,overdue_red_days}')::integer, 15) INTO v_red_days
      FROM public.product_variants pv WHERE pv.id = s.product_variant_id;
  END IF;
  v_result := app_servicio.svc_light(jsonb_build_object('grey', v_grey, 'phase', v_phase, 'oldestOverdueDays', v_overdue,
    'overdueRedDays', COALESCE(v_red_days, 15), 'late', v_late, 'items', COALESCE(v_items, '[]'::jsonb)));
  IF s.light IS DISTINCT FROM (v_result ->> 'color') OR s.light_reason IS DISTINCT FROM (v_result ->> 'reason') THEN
    UPDATE app_servicio.services SET light = v_result ->> 'color', light_reason = v_result ->> 'reason', light_at = now() WHERE id = s.id;
    IF s.light IS DISTINCT FROM (v_result ->> 'color') THEN
      PERFORM app_servicio.emit(s, 'service_light_changed', jsonb_build_object('light', v_result ->> 'color', 'previous_light', s.light));
    END IF;
  END IF;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_compute_light(p_service_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_compute_light(p_service_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_condition_eval(p_c jsonb, p_ctx jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE p_c ->> 'operator'
    WHEN 'is' THEN a = e
    WHEN 'is_not' THEN a <> e
    WHEN 'contains' THEN e <> '' AND position(e IN a) > 0
    WHEN 'not_contains' THEN e <> '' AND position(e IN a) = 0
    WHEN 'starts_with' THEN e <> '' AND left(a, length(e)) = e
    WHEN 'is_empty' THEN a = ''
    WHEN 'is_not_empty' THEN a <> ''
    ELSE false END
  FROM (SELECT lower(btrim(COALESCE(p_ctx ->> (p_c ->> 'field'), ''))) AS a, lower(btrim(COALESCE(p_c ->> 'value', ''))) AS e) t;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_condition_eval(p_c jsonb, p_ctx jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_condition_eval(p_c jsonb, p_ctx jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_conditions_match(p_tree jsonb, p_ctx jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_results boolean[] := ARRAY[]::boolean[];
  c jsonb; g jsonb; v_group boolean[];
  v_root text := COALESCE(p_tree ->> 'rootConjunction', 'and');
BEGIN
  FOR c IN SELECT x FROM jsonb_array_elements(COALESCE(p_tree -> 'conditions', '[]'::jsonb)) x LOOP
    v_results := v_results || app_servicio.svc_condition_eval(c, p_ctx);
  END LOOP;
  FOR g IN SELECT x FROM jsonb_array_elements(COALESCE(p_tree -> 'groups', '[]'::jsonb)) x LOOP
    CONTINUE WHEN jsonb_array_length(COALESCE(g -> 'conditions', '[]'::jsonb)) = 0;
    SELECT array_agg(app_servicio.svc_condition_eval(x, p_ctx)) INTO v_group FROM jsonb_array_elements(g -> 'conditions') x;
    v_results := v_results || CASE WHEN g ->> 'conjunction' = 'or' THEN true = ANY (v_group) ELSE NOT (false = ANY (v_group)) END;
  END LOOP;
  IF COALESCE(array_length(v_results, 1), 0) = 0 THEN RETURN false; END IF;
  RETURN CASE WHEN v_root = 'or' THEN true = ANY (v_results) ELSE NOT (false = ANY (v_results)) END;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_conditions_match(p_tree jsonb, p_ctx jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_conditions_match(p_tree jsonb, p_ctx jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_confirm_service(p_service_id uuid, p_start_on date, p_owner_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
  v_var public.product_variants;
  v_start date; v_end date; v_owner uuid;
BEGIN
  s := app_servicio.svc_get(p_service_id, true);
  PERFORM app_servicio.require_service(s, 'services.confirm');
  IF s.status <> 'pending_confirmation' THEN RAISE EXCEPTION 'Este servicio no está por confirmar' USING ERRCODE = 'SV010'; END IF;
  SELECT * INTO v_var FROM public.product_variants WHERE id = s.product_variant_id;
  v_start := COALESCE(p_start_on, s.starts_on, app_servicio.today_in(s.workspace_id));
  v_end := CASE WHEN s.ends_on IS NOT NULL AND s.starts_on IS NOT NULL THEN v_start + (s.ends_on - s.starts_on) ELSE CASE v_var.duration_type
             WHEN 'days' THEN v_start + v_var.duration_value - 1
             WHEN 'weeks' THEN v_start + v_var.duration_value * 7 - 1
             WHEN 'months' THEN (v_start + make_interval(months => v_var.duration_value))::date - 1
             ELSE NULL END END;
  v_owner := COALESCE(p_owner_id, s.owner_user_id, (app_servicio.svc_pick_owner(s.product_variant_id, s.contact_id) ->> 'userId')::uuid);
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Elegí el responsable' USING ERRCODE = 'SV015'; END IF;
  UPDATE app_servicio.services SET status = 'active', starts_on = v_start, ends_on = v_end, owner_user_id = v_owner,
    flags = flags - 'renewal_choice_pending' WHERE id = s.id;
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.confirmed', jsonb_build_object('starts_on', v_start, 'owner_user_id', v_owner));
  PERFORM app_servicio.svc_activate(s.id);
  SELECT * INTO s FROM app_servicio.services WHERE id = s.id;
  PERFORM app_servicio.emit(s, 'service_status_changed', jsonb_build_object('previous_status', 'pending_confirmation'));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_confirm_service(p_service_id uuid, p_start_on date, p_owner_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_confirm_service(p_service_id uuid, p_start_on date, p_owner_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_contact_context(p_contact_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  c public.contacts;
  v jsonb := '{}'::jsonb;
  f text; t jsonb; pre text;
  v_channel text;
BEGIN
  SELECT * INTO c FROM public.contacts WHERE id = p_contact_id;
  IF c.id IS NULL THEN RETURN v; END IF;
  FOREACH pre IN ARRAY ARRAY['first', 'last'] LOOP
    t := c.attribution -> (pre || '_touch');
    FOREACH f IN ARRAY ARRAY['source','medium','campaign','content','term','ad_id','adset_id','campaign_id','fbclid','gclid','ttclid',
                             'referrer_url','landing_page','origin','social_post_id','content_post_id'] LOOP
      v := v || jsonb_build_object(pre || '_' || f, COALESCE(t ->> f, ''));
    END LOOP;
    v := v || jsonb_build_object(pre || '_combined', lower(concat_ws('|', COALESCE(t ->> 'source', ''), COALESCE(t ->> 'medium', ''),
      COALESCE(t ->> 'campaign', ''), COALESCE(t ->> 'content', ''), COALESCE(t ->> 'term', ''))));
  END LOOP;
  SELECT ch.platform INTO v_channel FROM public.conversations cv JOIN public.channels ch ON ch.id = cv.channel_id
   WHERE cv.contact_id = p_contact_id ORDER BY cv.last_message_at DESC NULLS LAST LIMIT 1;
  RETURN v || jsonb_build_object('country', btrim(COALESCE(c.country, '')), 'channel', COALESCE(v_channel, ''),
    'has_email', CASE WHEN btrim(COALESCE(c.email, '')) <> '' THEN 'true' ELSE 'false' END,
    'has_phone', CASE WHEN btrim(COALESCE(c.phone, '')) <> '' OR btrim(COALESCE(c.whatsapp_phone, '')) <> '' THEN 'true' ELSE 'false' END);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_contact_context(p_contact_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_contact_context(p_contact_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_copy_variant_setup(p_from_variant_id uuid, p_to_variant_id uuid, p_parts text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_from public.product_variants;
  v_to public.product_variants;
  v_same_product boolean;
  v_map jsonb := '{}'::jsonb;
  v_tpl jsonb; v_phases jsonb := '[]'::jsonb; v_items jsonb;
  ph jsonb; it jsonb; v_new_key text; v_ref jsonb; v_attention integer := 0;
  v_portal jsonb; v_settings jsonb;
BEGIN
  SELECT * INTO v_from FROM public.product_variants WHERE id = p_from_variant_id;
  SELECT * INTO v_to FROM public.product_variants WHERE id = p_to_variant_id;
  IF v_from.id IS NULL OR v_to.id IS NULL OR v_from.workspace_id <> v_to.workspace_id THEN
    RAISE EXCEPTION 'No existe la variante' USING ERRCODE = 'SV002';
  END IF;
  IF p_from_variant_id = p_to_variant_id THEN RAISE EXCEPTION 'Elegí otra variante' USING ERRCODE = 'SV001'; END IF;
  IF 'journey' = ANY (p_parts) OR 'service' = ANY (p_parts) THEN
    PERFORM app_servicio.require_permission(v_to.workspace_id, 'services.configure');
  END IF;
  IF 'portal' = ANY (p_parts) THEN
    PERFORM app_servicio.require_permission(v_to.workspace_id, 'portal.sections');
    PERFORM app_servicio.require_permission(v_to.workspace_id, 'portal.access_rules');
  END IF;
  v_same_product := v_from.product_id = v_to.product_id;

  IF 'journey' = ANY (p_parts) THEN
    -- Claves nuevas para fases y pasos; se remapean las dependencias "al completar otro paso".
    FOR ph IN SELECT x FROM jsonb_array_elements(COALESCE(v_from.journey_template -> 'phases', '[]'::jsonb)) x LOOP
      v_map := v_map || jsonb_build_object(ph ->> 'key', 'ph_' || substr(md5(random()::text || clock_timestamp()::text), 1, 6));
      FOR it IN SELECT y FROM jsonb_array_elements(COALESCE(ph -> 'items', '[]'::jsonb)) y LOOP
        v_map := v_map || jsonb_build_object(it ->> 'key', 'it_' || substr(md5(random()::text || clock_timestamp()::text), 1, 6));
      END LOOP;
    END LOOP;
    FOR ph IN SELECT x FROM jsonb_array_elements(COALESCE(v_from.journey_template -> 'phases', '[]'::jsonb)) x LOOP
      v_items := '[]'::jsonb;
      FOR it IN SELECT y FROM jsonb_array_elements(COALESCE(ph -> 'items', '[]'::jsonb)) y LOOP
        v_new_key := v_map ->> (it ->> 'key');
        it := jsonb_set(it, '{key}', to_jsonb(v_new_key));
        IF it #>> '{due_rule,from}' = 'item_completed' AND v_map ? (it #>> '{due_rule,item_key}') THEN
          it := jsonb_set(it, '{due_rule,item_key}', to_jsonb(v_map ->> (it #>> '{due_rule,item_key}')));
        END IF;
        IF NOT v_same_product AND it ->> 'kind' IN ('quiz','activity','program_item','open_module') THEN
          it := jsonb_build_object('key', v_new_key, 'kind', 'checkbox', 'name', (it ->> 'name') || ' (Requiere atención)',
            'description', 'Copiado de otro programa: elegí de nuevo el contenido de este paso.', 'required', COALESCE(it -> 'required', 'true'::jsonb),
            'assignee', 'owner') || CASE WHEN it ? 'due_rule' THEN jsonb_build_object('due_rule', it -> 'due_rule') ELSE '{}'::jsonb END;
          v_attention := v_attention + 1;
        END IF;
        v_items := v_items || jsonb_build_array(it);
      END LOOP;
      v_phases := v_phases || jsonb_build_array(jsonb_set(jsonb_set(ph, '{key}', to_jsonb(v_map ->> (ph ->> 'key'))), '{items}', v_items));
    END LOOP;
    v_tpl := jsonb_set(v_from.journey_template, '{phases}', v_phases);
    UPDATE public.product_variants SET journey_template = v_tpl, journey_template_rev = journey_template_rev + 1 WHERE id = p_to_variant_id;
  END IF;

  IF 'service' = ANY (p_parts) THEN
    v_settings := v_from.service_settings;
    IF v_settings ? 'when' THEN v_settings := jsonb_set(v_settings, '{when,enabled_at}', to_jsonb(now()::text)); END IF;
    IF NOT v_same_product AND v_settings ->> 'mode' = 'extend' THEN
      RAISE EXCEPTION 'Una variante que extiende solo se copia dentro del mismo producto' USING ERRCODE = 'SV001';
    END IF;
    UPDATE public.product_variants SET service_settings = v_settings, service_settings_rev = service_settings_rev + 1 WHERE id = p_to_variant_id;
  END IF;

  IF 'portal' = ANY (p_parts) THEN
    v_portal := v_from.portal_settings;
    -- Las referencias a fases o pasos del camino se remapean si el camino tambien se copio.
    IF jsonb_typeof(v_portal -> 'sections') = 'array' THEN
      v_portal := jsonb_set(v_portal, '{sections}', (
        SELECT COALESCE(jsonb_agg(
          CASE WHEN NOT v_same_product AND s ? 'content' THEN (s - 'content') || jsonb_build_object('content', jsonb_build_object('modules', 'all')) ELSE s END
          || CASE WHEN s #>> '{opens,ref}' IS NOT NULL AND v_map ? (s #>> '{opens,ref}') THEN jsonb_build_object('opens', jsonb_set(s -> 'opens', '{ref}', to_jsonb(v_map ->> (s #>> '{opens,ref}')))) ELSE '{}'::jsonb END
          || CASE WHEN s #>> '{until,ref}' IS NOT NULL AND v_map ? (s #>> '{until,ref}') THEN jsonb_build_object('until', jsonb_set(s -> 'until', '{ref}', to_jsonb(v_map ->> (s #>> '{until,ref}')))) ELSE '{}'::jsonb END
        ), '[]'::jsonb) FROM jsonb_array_elements(v_portal -> 'sections') s));
    END IF;
    UPDATE public.product_variants SET portal_settings = v_portal, portal_settings_rev = portal_settings_rev + 1 WHERE id = p_to_variant_id;
  END IF;

  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, performed_by, actor_type)
  VALUES (v_to.workspace_id, 'product_variant', p_to_variant_id, 'svc.config_copied',
          jsonb_build_object('from_variant_id', p_from_variant_id, 'parts', to_jsonb(p_parts), 'needs_attention', v_attention), auth.uid(), 'user');
  RETURN jsonb_build_object('status', 'ok', 'needs_attention', v_attention);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_copy_variant_setup(p_from_variant_id uuid, p_to_variant_id uuid, p_parts text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_copy_variant_setup(p_from_variant_id uuid, p_to_variant_id uuid, p_parts text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_create_service(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_contact public.contacts;
  v_var public.product_variants;
  v_product public.products;
  v_sale public.sales;
  v_existing uuid;
  v_origin text := COALESCE(p ->> 'origin', 'manual');
  v_status text := COALESCE(p ->> 'status', 'active');
  v_reason text := nullif(btrim(p ->> 'origin_reason'), '');
  v_start date; v_end date; v_owner uuid; v_pick jsonb;
  v_id uuid;
  s app_servicio.services;
BEGIN
  SELECT * INTO v_contact FROM public.contacts WHERE id = (p ->> 'contact_id')::uuid;
  IF v_contact.id IS NULL THEN RAISE EXCEPTION 'No existe el contacto' USING ERRCODE = 'SV002'; END IF;
  IF p ? 'workspace_id' AND (p ->> 'workspace_id')::uuid <> v_contact.workspace_id THEN RAISE EXCEPTION 'El contacto es de otro negocio' USING ERRCODE = 'SV002'; END IF;
  IF NOT app_servicio.is_system() THEN
    IF NOT public.is_workspace_member(v_contact.workspace_id) OR NOT public.has_permission(v_contact.workspace_id, 'services.create') THEN
      RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
    END IF;
  END IF;
  IF NOT COALESCE(v_origin = ANY (ARRAY['sale','courtesy','test','manual','recovery']), false) THEN
    RAISE EXCEPTION 'Origen desconocido' USING ERRCODE = 'SV012';
  END IF;
  SELECT * INTO v_var FROM public.product_variants WHERE id = (p ->> 'variant_id')::uuid AND workspace_id = v_contact.workspace_id;
  IF v_var.id IS NULL THEN RAISE EXCEPTION 'Elegí la variante' USING ERRCODE = 'SV012'; END IF;
  SELECT * INTO v_product FROM public.products WHERE id = v_var.product_id;
  IF p ? 'sale_id' AND (p ->> 'sale_id') IS NOT NULL THEN
    SELECT * INTO v_sale FROM public.sales WHERE id = (p ->> 'sale_id')::uuid AND workspace_id = v_contact.workspace_id;
    IF v_sale.id IS NULL OR v_sale.contact_id <> v_contact.id THEN RAISE EXCEPTION 'La venta no es de este contacto' USING ERRCODE = 'SV002'; END IF;
    SELECT id INTO v_existing FROM app_servicio.services WHERE sale_id = v_sale.id;
    IF v_existing IS NOT NULL THEN
      RAISE EXCEPTION 'Esta venta ya tiene su servicio' USING ERRCODE = 'SV013', DETAIL = v_existing::text;
    END IF;
  ELSIF v_reason IS NULL THEN
    RAISE EXCEPTION 'Sin venta, escribí el motivo' USING ERRCODE = 'SV012';
  END IF;
  -- Crear desde una venta que no cumple la regla pide su clave y motivo (F95).
  IF COALESCE((p ->> 'off_rule')::boolean, false) AND NOT app_servicio.is_system() THEN
    IF NOT public.has_permission(v_contact.workspace_id, 'services.create_off_rule') THEN
      RAISE EXCEPTION 'No tenés permiso para crear un servicio fuera de la regla' USING ERRCODE = 'SV004';
    END IF;
    IF v_reason IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'SV014'; END IF;
  END IF;

  -- Fechas (F9): un Evento empieza en su fecha; si no, la que llega o hoy.
  v_start := COALESCE((p ->> 'starts_on')::date,
                      CASE WHEN v_product.product_type = 'evento' THEN v_var.event_date END,
                      app_servicio.today_in(v_contact.workspace_id));
  v_end := COALESCE((p ->> 'ends_on')::date, CASE v_var.duration_type
             WHEN 'days' THEN v_start + v_var.duration_value - 1
             WHEN 'weeks' THEN v_start + v_var.duration_value * 7 - 1
             WHEN 'months' THEN (v_start + make_interval(months => v_var.duration_value))::date - 1
             ELSE NULL END);
  v_owner := (p ->> 'owner_user_id')::uuid;
  IF v_owner IS NULL AND v_status <> 'pending_confirmation' THEN
    v_pick := app_servicio.svc_pick_owner(v_var.id, v_contact.id,
      (SELECT owner_user_id FROM app_servicio.services WHERE id = (p ->> 'previous_service_id')::uuid));
    v_owner := (v_pick ->> 'userId')::uuid;
    IF v_owner IS NULL THEN RAISE EXCEPTION 'Elegí el responsable' USING ERRCODE = 'SV015'; END IF;
  ELSIF v_owner IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = v_contact.workspace_id AND m.user_id = v_owner) THEN
    RAISE EXCEPTION 'El responsable no es del equipo' USING ERRCODE = 'SV015';
  END IF;

  BEGIN
    INSERT INTO app_servicio.services (workspace_id, contact_id, product_id, product_variant_id, sale_id, origin, origin_reason, previous_service_id,
      status, starts_on, ends_on, owner_user_id, product_snapshot, price_cents, currency, is_test, flags, created_by)
    VALUES (v_contact.workspace_id, v_contact.id, v_var.product_id, v_var.id, v_sale.id, v_origin, v_reason, (p ->> 'previous_service_id')::uuid,
      v_status, v_start, v_end, v_owner,
      jsonb_build_object('product_name', v_product.name, 'product_type', v_product.product_type, 'variant_name', v_var.name,
                         'duration_type', v_var.duration_type, 'duration_value', v_var.duration_value, 'event_date', v_var.event_date),
      CASE WHEN v_sale.id IS NOT NULL THEN round(v_sale.final_amount * 100)::bigint ELSE round(v_var.price * 100)::bigint END,
      COALESCE(v_sale.currency, 'USD'), v_origin = 'test',
      COALESCE(p -> 'flags', '{}'::jsonb) || CASE WHEN v_pick IS NOT NULL AND (v_pick ->> 'usedFallback')::boolean THEN '{"owner_fallback": true}'::jsonb ELSE '{}'::jsonb END,
      auth.uid())
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_existing FROM app_servicio.services WHERE sale_id = v_sale.id;
    RAISE EXCEPTION 'Esta venta ya tiene su servicio' USING ERRCODE = 'SV013', DETAIL = COALESCE(v_existing::text, '');
  END;
  SELECT * INTO s FROM app_servicio.services WHERE id = v_id;
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.created',
    jsonb_build_object('origin', v_origin, 'status', v_status, 'sale_id', v_sale.id, 'variant_id', v_var.id, 'reason', v_reason));
  IF v_pick IS NOT NULL AND (v_pick ->> 'usedFallback')::boolean THEN
    PERFORM app_servicio.notify_admins(s.workspace_id, 'svc_owner_fallback', 'Servicio a nombre del respaldo',
      'La regla del responsable no encontró a nadie activo: el servicio quedó a nombre de la persona de respaldo.', 'service', s.id);
  END IF;
  IF v_status = 'active' THEN
    PERFORM app_servicio.svc_activate(s.id);
    -- Carga inicial (F99): empieza en la fase indicada; las anteriores quedan "movidas a mano".
    IF nullif(btrim(p ->> 'start_phase_name'), '') IS NOT NULL THEN
      PERFORM app_servicio.svc_move_core(s.id, ph.id, 'Carga inicial')
        FROM app_servicio.service_phases ph
       WHERE ph.service_id = s.id AND lower(btrim(ph.name)) = lower(btrim(p ->> 'start_phase_name')) AND ph.status = 'pending'
       LIMIT 1;
    END IF;
  END IF;
  SELECT * INTO s FROM app_servicio.services WHERE id = v_id;
  PERFORM app_servicio.emit(s, 'service_created', jsonb_build_object('origin', v_origin));
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_create_service(p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_create_service(p jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_cut_access(p_service_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s record;
  nx record;
  a record;
  r jsonb;
BEGIN
  SELECT id, workspace_id INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL THEN RETURN; END IF;
  IF p_reason IN ('cancelled', 'refunded') THEN
    UPDATE app_servicio_portal.portal_access SET revoked_at = now(), revoke_reason = p_reason, updated_at = now()
     WHERE service_id = s.id AND revoked_at IS NULL;
  ELSIF p_reason = 'completed' THEN
    UPDATE app_servicio_portal.portal_access SET revoked_at = now(), revoke_reason = p_reason, updated_at = now()
     WHERE service_id = s.id AND revoked_at IS NULL AND until_type = 'service';
  ELSIF p_reason = 'renewed' THEN
    SELECT id, product_id, product_variant_id, ends_on, status INTO nx FROM app_servicio.services
     WHERE previous_service_id = s.id AND status IN ('active', 'pending_confirmation') ORDER BY created_at DESC LIMIT 1;
    FOR a IN SELECT * FROM app_servicio_portal.portal_access WHERE service_id = s.id AND revoked_at IS NULL AND until_type = 'service' LOOP
      IF nx.id IS NOT NULL AND nx.product_id = a.product_id THEN
        r := app_servicio.portal_section_rule(nx.product_variant_id, a.section);
        IF r IS NOT NULL THEN
          PERFORM app_servicio.svc_insert_access(nx.id, nx.product_id, a.section,
            app_servicio.portal_until_day(r -> 'until', app_servicio.today_in(s.workspace_id), nx.ends_on), COALESCE(r #>> '{until,type}', 'service'),
            'renewal_transfer', a.id::text, NULL, a.ai_monthly_limit_usd);
        END IF;
      END IF;
      UPDATE app_servicio_portal.portal_access SET revoked_at = now(), revoke_reason = 'renewed', updated_at = now() WHERE id = a.id;
    END LOOP;
  ELSE
    RETURN;
  END IF;
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.access_cut', jsonb_build_object('reason', p_reason));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_cut_access(p_service_id uuid, p_reason text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_cut_access(p_service_id uuid, p_reason text) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_daily_run(p_workspace_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_today date;
  v_out jsonb := '{}'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  n integer;
  s app_servicio.services;
  it record;
  r record;
  d integer;
BEGIN
  IF NOT app_servicio.module_on(p_workspace_id) THEN RETURN jsonb_build_object('skipped', 'module_off'); END IF;
  PERFORM app_servicio.as_system();
  v_today := app_servicio.today_in(p_workspace_id);

  -- Repeticiones (F21) y Retos de fecha fija (F22).
  BEGIN
    n := 0;
    FOR s IN SELECT * FROM app_servicio.services WHERE workspace_id = p_workspace_id AND status = 'active' LOOP
      PERFORM app_servicio.svc_generate_occurrences(s.id);
      n := n + app_servicio.svc_open_due_challenges(s.id);
    END LOOP;
    v_out := v_out || jsonb_build_object('challenges_opened', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('occurrences: ' || SQLERRM);
  END;

  -- Pasos vencidos y su evento (F25), una vez por paso.
  BEGIN
    n := 0;
    FOR it IN SELECT i.id, i.service_id, i.template_key, i.name FROM app_servicio.service_items i JOIN app_servicio.services sv ON sv.id = i.service_id
               WHERE sv.workspace_id = p_workspace_id AND sv.status = 'active' AND NOT sv.is_test AND i.status = 'pending' AND NOT i.is_recurring_template
                 AND i.due_on IS NOT NULL AND i.due_on < v_today
                 AND NOT EXISTS (SELECT 1 FROM public.automation_events e WHERE e.workspace_id = p_workspace_id AND e.event_type = 'service_item_overdue'
                                   AND e.payload ->> 'item_id' = i.id::text) LOOP
      PERFORM app_servicio.emit_service(it.service_id, 'service_item_overdue', jsonb_build_object('item_id', it.id, 'item_key', it.template_key, 'item_name', it.name));
      n := n + 1;
    END LOOP;
    v_out := v_out || jsonb_build_object('items_overdue', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('overdue: ' || SQLERRM);
  END;

  -- Semaforo (F24).
  BEGIN
    FOR s IN SELECT * FROM app_servicio.services WHERE workspace_id = p_workspace_id AND status IN ('active', 'paused') LOOP
      PERFORM app_servicio.svc_compute_light(s.id);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('light: ' || SQLERRM);
  END;

  -- Accesos que se abren con el tiempo y mora (F39).
  BEGIN
    v_out := v_out || jsonb_build_object('access', app_servicio.svc_access_tick(p_workspace_id));
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('access: ' || SQLERRM);
  END;

  -- Renovados que llegan a su fin (F9): el anterior pasa a «renovado» y lo que el nuevo tambien da pasa al nuevo.
  BEGIN
    n := 0;
    FOR s IN SELECT o.* FROM app_servicio.services o
              WHERE o.workspace_id = p_workspace_id AND o.status IN ('active', 'paused') AND o.ends_on IS NOT NULL AND o.ends_on < v_today
                AND EXISTS (SELECT 1 FROM app_servicio.services nx WHERE nx.previous_service_id = o.id AND nx.status IN ('active', 'paused', 'pending_confirmation')) LOOP
      PERFORM app_servicio.svc_cut_access(s.id, 'renewed');
      UPDATE app_servicio.services SET status = 'renewed', completed_at = COALESCE(completed_at, now()), updated_at = now() WHERE id = s.id;
      PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.renewed', '{}'::jsonb, 'system');
      PERFORM app_servicio.emit_service(s.id, 'service_status_changed', jsonb_build_object('previous_status', s.status));
      n := n + 1;
    END LOOP;
    v_out := v_out || jsonb_build_object('renewed_closed', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('renewed: ' || SQLERRM);
  END;

  -- Accesos por vencer (7 dias) y vencidos (ayer), una vez por acceso.
  BEGIN
    n := 0;
    FOR r IN SELECT a.id, a.service_id, a.section, a.ends_at FROM app_servicio_portal.portal_access a JOIN app_servicio.services sv ON sv.id = a.service_id
              WHERE a.workspace_id = p_workspace_id AND a.revoked_at IS NULL AND a.ends_at IS NOT NULL AND NOT sv.is_test
                AND a.ends_at > now() AND a.ends_at <= now() + interval '7 days'
                AND NOT EXISTS (SELECT 1 FROM public.automation_events e WHERE e.workspace_id = p_workspace_id AND e.event_type = 'portal_access_expiring'
                                  AND e.payload ->> 'access_id' = a.id::text) LOOP
      PERFORM app_servicio.emit_service(r.service_id, 'portal_access_expiring', jsonb_build_object('access_id', r.id, 'section', r.section, 'ends_at', r.ends_at));
      n := n + 1;
    END LOOP;
    FOR r IN SELECT a.id, a.service_id, a.section, a.ends_at FROM app_servicio_portal.portal_access a JOIN app_servicio.services sv ON sv.id = a.service_id
              WHERE a.workspace_id = p_workspace_id AND a.revoked_at IS NULL AND a.ends_at IS NOT NULL AND NOT sv.is_test
                AND a.ends_at <= now() AND a.ends_at > now() - interval '3 days'
                AND NOT EXISTS (SELECT 1 FROM public.automation_events e WHERE e.workspace_id = p_workspace_id AND e.event_type = 'portal_access_expired'
                                  AND e.payload ->> 'access_id' = a.id::text) LOOP
      PERFORM app_servicio.emit_service(r.service_id, 'portal_access_expired', jsonb_build_object('access_id', r.id, 'section', r.section, 'ends_at', r.ends_at));
      n := n + 1;
    END LOOP;
    v_out := v_out || jsonb_build_object('access_events', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('access_events: ' || SQLERRM);
  END;

  -- «Faltó» (F61): fechas de ayer con la ventana cerrada, para quien tiene acceso Calendario vigente, la sesion es de su
  -- variante, el servicio no esta pausado y no tiene asistencia. Una vez por persona, sesion y fecha.
  BEGIN
    n := 0;
    FOR r IN
      SELECT ls.id AS session_id, (o ->> 'occursOn')::date AS occurs_on, sv.id AS service_id, sv.contact_id
        FROM app_servicio.live_sessions ls
        CROSS JOIN LATERAL jsonb_array_elements(app_servicio.live_occurrences_plan(jsonb_build_object(
          'session', jsonb_build_object('kind', ls.kind, 'weekdays', to_jsonb(ls.weekdays), 'every_weeks', ls.every_weeks, 'starts_on', ls.starts_on,
                                        'ends_on', ls.ends_on, 'single_at', ls.single_at, 'start_time', to_char(ls.start_time, 'HH24:MI'),
                                        'duration_minutes', ls.duration_minutes, 'timezone', ls.timezone),
          'exceptions', COALESCE((SELECT jsonb_agg(jsonb_build_object('occurs_on', x.occurs_on, 'status', x.status, 'moved_to', x.moved_to))
                                    FROM app_servicio.live_session_dates x WHERE x.live_session_id = ls.id), '[]'::jsonb),
          'from', v_today - 2, 'to', v_today))) o
        JOIN app_servicio.services sv ON sv.product_id = ls.product_id AND sv.status = 'active' AND NOT sv.is_test
       WHERE ls.workspace_id = p_workspace_id AND ls.archived_at IS NULL AND o ->> 'status' <> 'cancelled'
         AND (o ->> 'endsAt')::timestamptz + interval '30 minutes' < now()
         AND (ls.variant_ids IS NULL OR sv.product_variant_id = ANY (ls.variant_ids))
         AND EXISTS (SELECT 1 FROM app_servicio_portal.portal_access a WHERE a.service_id = sv.id AND a.section = 'calendar' AND a.revoked_at IS NULL
                       AND a.starts_at <= (o ->> 'startsAt')::timestamptz AND (a.ends_at IS NULL OR a.ends_at > (o ->> 'startsAt')::timestamptz))
         AND NOT EXISTS (SELECT 1 FROM app_servicio_portal.live_attendance la WHERE la.live_session_id = ls.id AND la.occurs_on = (o ->> 'occursOn')::date
                           AND la.contact_id = sv.contact_id AND la.removed_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM public.automation_events e WHERE e.workspace_id = p_workspace_id AND e.event_type = 'live_session_missed'
                           AND e.contact_id = sv.contact_id AND e.payload ->> 'live_session_id' = ls.id::text AND e.payload ->> 'occurs_on' = (o ->> 'occursOn'))
    LOOP
      PERFORM app_servicio.emit_service(r.service_id, 'live_session_missed', jsonb_build_object('live_session_id', r.session_id, 'occurs_on', r.occurs_on::text));
      n := n + 1;
    END LOOP;
    v_out := v_out || jsonb_build_object('missed', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('missed: ' || SQLERRM);
  END;

  -- «Reanudar sola» (F94).
  BEGIN
    n := 0;
    FOR s IN SELECT * FROM app_servicio.services WHERE workspace_id = p_workspace_id AND status = 'paused' AND pause_resume_on IS NOT NULL AND pause_resume_on <= v_today LOOP
      PERFORM app_servicio.svc_resume(s.id, '{}'::jsonb);
      n := n + 1;
    END LOOP;
    v_out := v_out || jsonb_build_object('resumed', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('resume: ' || SQLERRM);
  END;

  -- Servicios que empiezan hoy (F14, F115): `service_started` una vez.
  BEGIN
    n := 0;
    FOR s IN SELECT * FROM app_servicio.services WHERE workspace_id = p_workspace_id AND status = 'active' AND starts_on IS NOT NULL AND starts_on <= v_today
               AND NOT COALESCE((flags ->> 'started_emitted')::boolean, false) LOOP
      PERFORM app_servicio.emit(s, 'service_started');
      UPDATE app_servicio.services SET flags = flags || '{"started_emitted": true}'::jsonb WHERE id = s.id;
      n := n + 1;
    END LOOP;
    v_out := v_out || jsonb_build_object('started', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('started: ' || SQLERRM);
  END;

  -- `service_ending_soon` (F25): N dias antes de `ends_on`, una vez por servicio y por N. Los N salen de los
  -- disparadores activos del negocio (si no hay ninguno, no se emite nada).
  BEGIN
    n := 0;
    FOR d IN SELECT DISTINCT (t.config ->> 'days')::integer FROM public.triggers t
              WHERE t.workspace_id = p_workspace_id AND t.type = 'service_ending_soon' AND t.is_active
                AND jsonb_typeof(t.config -> 'days') = 'number' AND (t.config ->> 'days')::integer BETWEEN 0 AND 365 LOOP
      FOR s IN SELECT * FROM app_servicio.services sv WHERE sv.workspace_id = p_workspace_id AND sv.status = 'active' AND NOT sv.is_test
                 AND sv.ends_on = v_today + d
                 AND NOT EXISTS (SELECT 1 FROM public.automation_events e WHERE e.workspace_id = p_workspace_id AND e.event_type = 'service_ending_soon'
                                   AND e.payload ->> 'service_id' = sv.id::text AND e.payload ->> 'days' = d::text) LOOP
        PERFORM app_servicio.emit(s, 'service_ending_soon', jsonb_build_object('days', d));
        n := n + 1;
      END LOOP;
    END LOOP;
    v_out := v_out || jsonb_build_object('ending_soon', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('ending_soon: ' || SQLERRM);
  END;

  -- Purga de la comunidad (F76): lo borrado hace mas de 30 dias.
  BEGIN
    DELETE FROM app_servicio_portal.community_posts WHERE workspace_id = p_workspace_id AND deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
    GET DIAGNOSTICS n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('community_purged', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('community: ' || SQLERRM);
  END;

  RETURN v_out || jsonb_build_object('errors', v_errors, 'day', v_today);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_daily_run(p_workspace_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_daily_run(p_workspace_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_dates_plan(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_old_start date;
  v_old_end date;
  v_start date;
  v_end date;
BEGIN
  IF COALESCE(p ->> 'status', '') IN ('completed', 'cancelled', 'renewed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SV042');
  END IF;
  IF nullif(btrim(COALESCE(p ->> 'reason', '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SV016');
  END IF;
  -- Una fecha valida es AAAA-MM-DD; lo demas cuenta como vacio (igual que la gemela).
  v_start := CASE WHEN COALESCE(p ->> 'startsOn', '') ~ '^\d{4}-\d{2}-\d{2}$' THEN (p ->> 'startsOn')::date END;
  IF v_start IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'SV043'); END IF;
  v_end := CASE WHEN COALESCE(p ->> 'endsOn', '') ~ '^\d{4}-\d{2}-\d{2}$' THEN (p ->> 'endsOn')::date END;
  v_old_start := CASE WHEN COALESCE(p ->> 'oldStartsOn', '') ~ '^\d{4}-\d{2}-\d{2}$' THEN (p ->> 'oldStartsOn')::date END;
  v_old_end := CASE WHEN COALESCE(p ->> 'oldEndsOn', '') ~ '^\d{4}-\d{2}-\d{2}$' THEN (p ->> 'oldEndsOn')::date END;
  IF v_end IS NOT NULL AND v_end < v_start THEN RETURN jsonb_build_object('ok', false, 'error', 'SV040'); END IF;
  IF v_start = v_old_start AND v_end IS NOT DISTINCT FROM v_old_end THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SV041');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'startShiftDays', CASE WHEN v_old_start IS NULL THEN NULL ELSE v_start - v_old_start END,
    'durationDays', CASE WHEN v_end IS NULL THEN NULL ELSE v_end - v_start + 1 END);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_dates_plan(p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_dates_plan(p jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_day_word(n integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN n = 1 THEN '1 día' ELSE n::text || ' días' END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_day_word(n integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_day_word(n integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_discard_service(p_service_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
BEGIN
  s := app_servicio.svc_get(p_service_id, true);
  PERFORM app_servicio.require_service(s, 'services.confirm');
  IF nullif(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'SV011'; END IF;
  IF s.status <> 'pending_confirmation' THEN RAISE EXCEPTION 'Este servicio no está por confirmar' USING ERRCODE = 'SV010'; END IF;
  UPDATE app_servicio.services SET status = 'cancelled', cancel_reason = p_reason, cancelled_at = now() WHERE id = s.id;
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.discarded', jsonb_build_object('reason', p_reason));
  SELECT * INTO s FROM app_servicio.services WHERE id = s.id;
  PERFORM app_servicio.emit(s, 'service_status_changed', jsonb_build_object('previous_status', 'pending_confirmation'));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_discard_service(p_service_id uuid, p_reason text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_discard_service(p_service_id uuid, p_reason text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_due_date(p_rule jsonb, p_anchors jsonb)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN p_rule IS NULL OR jsonb_typeof(p_rule) <> 'object' THEN NULL ELSE
    (CASE p_rule ->> 'from'
      WHEN 'service_created' THEN (p_anchors ->> 'serviceCreated')::date
      WHEN 'service_start' THEN (p_anchors ->> 'serviceStart')::date
      WHEN 'phase_start' THEN (p_anchors ->> 'phaseStart')::date
      WHEN 'item_completed' THEN (p_anchors ->> 'itemCompleted')::date
     END) + COALESCE((p_rule ->> 'days')::integer, 0) END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_due_date(p_rule jsonb, p_anchors jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_due_date(p_rule jsonb, p_anchors jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_ensure_portal_account(p_workspace_id uuid, p_contact_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_id uuid;
  v_email text;
BEGIN
  SELECT id INTO v_id FROM app_servicio_portal.portal_accounts WHERE workspace_id = p_workspace_id AND contact_id = p_contact_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT NULLIF(lower(btrim(c.email)), '') INTO v_email FROM public.contacts c WHERE c.id = p_contact_id AND c.workspace_id = p_workspace_id;
  IF v_email IS NULL THEN
    PERFORM app_servicio.audit(p_workspace_id, 'contact', p_contact_id, 'portal.account_no_email', '{}'::jsonb, 'system');
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM app_servicio_portal.portal_accounts WHERE workspace_id = p_workspace_id AND email = v_email) THEN
    PERFORM app_servicio.audit(p_workspace_id, 'contact', p_contact_id, 'portal.account_email_conflict', '{}'::jsonb, 'system');
    RETURN NULL;
  END IF;
  INSERT INTO app_servicio_portal.portal_accounts (workspace_id, contact_id, email) VALUES (p_workspace_id, p_contact_id, v_email)
  ON CONFLICT DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    PERFORM app_servicio.audit(p_workspace_id, 'contact', p_contact_id, 'portal.account_created', jsonb_build_object('account_id', v_id), 'system');
  END IF;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_ensure_portal_account(p_workspace_id uuid, p_contact_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_ensure_portal_account(p_workspace_id uuid, p_contact_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_ensure_task(p_item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  it app_servicio.service_items;
  s app_servicio.services;
  v_owner uuid;
  v_task uuid;
BEGIN
  SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id FOR UPDATE;
  IF it.id IS NULL OR it.kind <> 'team_task' OR it.task_id IS NOT NULL OR it.status = 'completed' OR it.is_recurring_template THEN RETURN; END IF;
  SELECT * INTO s FROM app_servicio.services WHERE id = it.service_id;
  v_owner := CASE it.assignee WHEN 'user' THEN it.assignee_user_id ELSE s.owner_user_id END;
  INSERT INTO public.tasks (workspace_id, title, description, status, priority, due_date, owner_id, contact_id, source, source_ref, created_by)
  VALUES (s.workspace_id, left(it.name, 200), it.description, 'pending', 'normal',
          COALESCE(it.due_on, app_servicio.local_date(it.due_at, s.workspace_id)), v_owner, s.contact_id, 'cx', 'svc_item:' || it.id::text, NULL)
  RETURNING id INTO v_task;
  UPDATE app_servicio.service_items SET task_id = v_task WHERE id = it.id;
  IF v_owner IS NOT NULL THEN
    PERFORM app_servicio.notify(s.workspace_id, v_owner, 'task_assigned', 'Tenés una tarea nueva', it.name, 'task', v_task,
                                jsonb_build_object('service_id', s.id));
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_ensure_task(p_item_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_ensure_task(p_item_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_evaluate_auto_creation(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_pay public.payments;
  v_sale public.sales;
  v_var public.product_variants;
  v_settings jsonb;
  v_check jsonb;
  v_prev app_servicio.services;
  v_target app_servicio.services;
  v_plan jsonb;
  v_pay_day date;
  v_start date;
  v_status text;
  v_flags jsonb := '{}'::jsonb;
  v_id uuid;
  v_n integer; v_unit text; v_base date; v_new_end date;
  v_fallback uuid;
BEGIN
  PERFORM app_servicio.as_system();
  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id;
  IF v_pay.id IS NULL OR v_pay.status <> 'paid' OR v_pay.type = 'refund' THEN RETURN jsonb_build_object('action', 'none'); END IF;
  IF NOT app_servicio.module_on(v_pay.workspace_id) THEN RETURN jsonb_build_object('action', 'module_off'); END IF;
  SELECT * INTO v_sale FROM public.sales WHERE id = v_pay.sale_id;
  SELECT * INTO v_var FROM public.product_variants WHERE id = v_sale.product_variant_id;
  v_settings := v_var.service_settings;
  IF COALESCE(v_settings ->> 'mode', 'none') = 'none' THEN RETURN jsonb_build_object('action', 'none'); END IF;
  -- Corregir o resincronizar un pago viejo nunca crea un servicio (F6, regla 2).
  IF (v_settings #>> '{when,enabled_at}') IS NOT NULL AND COALESCE(v_pay.paid_at, now()) < (v_settings #>> '{when,enabled_at}')::timestamptz THEN
    RETURN jsonb_build_object('action', 'before_enabled');
  END IF;
  v_check := app_servicio.svc_rule_check(v_sale.id);
  IF NOT (v_check ->> 'met')::boolean THEN RETURN jsonb_build_object('action', 'none', 'reason', v_check ->> 'reason'); END IF;
  v_pay_day := COALESCE(v_pay.paid_on, app_servicio.local_date(v_pay.paid_at, v_pay.workspace_id), app_servicio.today_in(v_pay.workspace_id));

  IF v_settings ->> 'mode' = 'create' THEN
    v_start := CASE COALESCE(v_settings ->> 'start', 'payment_date')
      WHEN 'payment_date' THEN v_pay_day
      WHEN 'sale_date' THEN COALESCE(v_sale.service_starts_at, v_sale.sale_date)
      ELSE NULL END;
    v_status := CASE WHEN COALESCE((v_settings ->> 'confirm')::boolean, false) OR v_settings ->> 'start' = 'manual' THEN 'pending_confirmation' ELSE 'active' END;
    -- El servicio previo del mismo producto (el mas reciente que no se cancelo).
    SELECT * INTO v_prev FROM app_servicio.services s
     WHERE s.contact_id = v_sale.contact_id AND s.product_id = v_var.product_id AND s.status NOT IN ('cancelled', 'pending_confirmation')
     ORDER BY COALESCE(s.ends_on, 'infinity'::date) DESC, s.created_at DESC LIMIT 1;
    v_plan := app_servicio.svc_renewal_plan(jsonb_build_object('renewal', COALESCE(v_settings ->> 'renewal', 'new_linked'),
      'today', v_pay_day, 'prev', CASE WHEN v_prev.id IS NULL THEN NULL ELSE jsonb_build_object('status', v_prev.status, 'endsOn', v_prev.ends_on,
      'endedOn', COALESCE(app_servicio.local_date(v_prev.completed_at, v_prev.workspace_id), v_prev.ends_on)) END));
    -- ¿Venta repetida? (mismo producto y variante, activo que empezo hace menos de 7 dias)
    IF v_prev.id IS NOT NULL AND v_prev.status = 'active' AND v_prev.product_variant_id = v_var.id
       AND v_prev.starts_on IS NOT NULL AND v_pay_day - v_prev.starts_on < 7 THEN
      v_status := 'pending_confirmation';
      v_flags := v_flags || jsonb_build_object('possible_duplicate', true);
    END IF;
    CASE v_plan ->> 'action'
      WHEN 'extend' THEN
        v_n := v_var.duration_value;
        IF v_var.duration_type = 'lifetime' OR v_n IS NULL THEN RETURN jsonb_build_object('action', 'none', 'reason', 'lifetime'); END IF;
        PERFORM app_servicio.svc_extend(v_prev.id, jsonb_build_object('mode', 'period', 'n', v_n, 'unit', v_var.duration_type,
          'kind', 'purchase', 'sale_id', v_sale.id, 'reason', 'Compró otra vez'));
        RETURN jsonb_build_object('action', 'extended', 'service_id', v_prev.id);
      WHEN 'ask' THEN
        v_status := 'pending_confirmation';
        v_flags := v_flags || jsonb_build_object('renewal_choice_pending', true);
        v_id := app_servicio.svc_create_service(jsonb_build_object('contact_id', v_sale.contact_id, 'variant_id', v_var.id, 'sale_id', v_sale.id,
          'origin', 'sale', 'status', v_status, 'starts_on', v_start, 'previous_service_id', v_prev.id, 'flags', v_flags));
      WHEN 'new_linked' THEN
        v_id := app_servicio.svc_create_service(jsonb_build_object('contact_id', v_sale.contact_id, 'variant_id', v_var.id, 'sale_id', v_sale.id,
          'origin', 'sale', 'status', v_status, 'starts_on', COALESCE((v_plan ->> 'startsOn')::date, v_start), 'previous_service_id', v_prev.id,
          'owner_user_id', CASE WHEN v_settings #>> '{owner,mode}' = 'previous' OR v_prev.status IN ('active','paused') THEN v_prev.owner_user_id END,
          'flags', v_flags || CASE WHEN (v_plan ->> 'startsOn') IS NOT NULL THEN '{"renews_previous": true}'::jsonb ELSE '{}'::jsonb END));
      WHEN 'recovery' THEN
        v_id := app_servicio.svc_create_service(jsonb_build_object('contact_id', v_sale.contact_id, 'variant_id', v_var.id, 'sale_id', v_sale.id,
          'origin', 'recovery', 'origin_reason', 'Volvió a comprar', 'status', v_status, 'starts_on', v_start, 'previous_service_id', v_prev.id, 'flags', v_flags));
      ELSE
        v_id := app_servicio.svc_create_service(jsonb_build_object('contact_id', v_sale.contact_id, 'variant_id', v_var.id, 'sale_id', v_sale.id,
          'origin', 'sale', 'status', v_status, 'starts_on', v_start, 'flags', v_flags));
    END CASE;
    RETURN jsonb_build_object('action', 'created', 'service_id', v_id, 'status', v_status);
  END IF;

  -- mode = extend (renovaciones, F115): extiende el servicio del contacto del mismo producto.
  SELECT * INTO v_target FROM app_servicio.services s
   WHERE s.contact_id = v_sale.contact_id AND s.product_id = v_var.product_id AND s.status IN ('active', 'paused', 'completed')
     AND (jsonb_typeof(v_settings #> '{extend,target_variant_ids}') IS DISTINCT FROM 'array'
          OR s.product_variant_id::text IN (SELECT jsonb_array_elements_text(v_settings #> '{extend,target_variant_ids}')))
   ORDER BY s.ends_on DESC NULLS FIRST, s.created_at DESC LIMIT 1;
  IF v_target.id IS NOT NULL THEN
    v_n := (v_settings #>> '{extend,n}')::integer;
    v_unit := COALESCE(v_settings #>> '{extend,unit}', 'months');
    v_base := CASE WHEN v_target.status IN ('active', 'paused') AND v_target.ends_on IS NOT NULL THEN v_target.ends_on ELSE v_pay_day END;
    v_new_end := CASE v_unit WHEN 'months' THEN (v_base + make_interval(months => v_n))::date WHEN 'weeks' THEN v_base + v_n * 7 ELSE v_base + v_n END;
    PERFORM app_servicio.svc_extend(v_target.id, jsonb_build_object('mode', 'end_date', 'end_on', v_new_end, 'kind', 'purchase',
      'sale_id', v_sale.id, 'reason', 'Renovación', 'extend_own', COALESCE((v_settings #>> '{extend,extend_accesses}')::boolean, false)));
    RETURN jsonb_build_object('action', 'extended', 'service_id', v_target.id);
  END IF;
  -- Sin servicio para extender: la variante de respaldo (por confirmar, por defecto, o activo).
  v_fallback := (v_settings #>> '{extend,fallback_variant_id}')::uuid;
  v_status := CASE WHEN COALESCE(v_settings #>> '{extend,if_no_service}', 'confirm') = 'create' THEN 'active' ELSE 'pending_confirmation' END;
  v_id := app_servicio.svc_create_service(jsonb_build_object('contact_id', v_sale.contact_id, 'variant_id', v_fallback, 'sale_id', v_sale.id,
    'origin', 'sale', 'status', v_status, 'starts_on', v_pay_day, 'flags', jsonb_build_object('renewal_without_previous', true)));
  PERFORM app_servicio.notify_admins(v_sale.workspace_id, 'svc_renewal_without_previous', 'Compró una renovación sin servicio anterior',
    'Se creó el servicio con la variante de respaldo. Revisalo.', 'service', v_id);
  RETURN jsonb_build_object('action', 'created_fallback', 'service_id', v_id, 'status', v_status);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_evaluate_auto_creation(p_payment_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_evaluate_auto_creation(p_payment_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_extend_plan(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_status text := p ->> 'status';
  v_today date := (p ->> 'today')::date;
  v_ends date := (p ->> 'endsOn')::date;
  v_n integer := (p ->> 'n')::integer;
  v_from text; v_base date; v_new date;
BEGIN
  IF NOT COALESCE(v_status = ANY (ARRAY['active','paused','completed']), false) THEN RETURN jsonb_build_object('ok', false, 'error', 'SV030'); END IF;
  IF p ->> 'mode' = 'end_date' THEN
    IF (p ->> 'endOn') IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'SV032'); END IF;
    v_new := (p ->> 'endOn')::date;
  ELSE
    IF v_n IS NULL OR v_n < 1 THEN RETURN jsonb_build_object('ok', false, 'error', 'SV032'); END IF;
    v_from := COALESCE(p ->> 'from', CASE WHEN v_status IN ('active','paused') AND v_ends IS NOT NULL THEN 'current_end' ELSE 'today' END);
    v_base := CASE WHEN v_from = 'current_end' AND v_ends IS NOT NULL THEN v_ends ELSE v_today END;
    v_new := CASE p ->> 'unit' WHEN 'months' THEN (v_base + make_interval(months => v_n))::date
                               WHEN 'weeks' THEN v_base + v_n * 7 ELSE v_base + v_n END;
  END IF;
  IF v_new <= v_today THEN RETURN jsonb_build_object('ok', false, 'error', 'SV031'); END IF;
  RETURN jsonb_build_object('ok', true, 'newEnd', to_char(v_new, 'YYYY-MM-DD'), 'reactivate', v_status = 'completed');
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_extend_plan(p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_extend_plan(p jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_extend(p_service_id uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
  v_plan jsonb;
  v_new date;
  v_shifted integer;
  v_prev text;
BEGIN
  s := app_servicio.svc_get(p_service_id, true);
  PERFORM app_servicio.require_service(s, 'services.extend');
  IF nullif(btrim(p ->> 'reason'), '') IS NULL AND COALESCE(p ->> 'kind', '') <> 'purchase' THEN
    RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'SV016';
  END IF;
  v_plan := app_servicio.svc_extend_plan(jsonb_build_object('status', s.status, 'endsOn', s.ends_on, 'today', app_servicio.today_in(s.workspace_id),
    'mode', p ->> 'mode', 'endOn', p ->> 'end_on', 'n', (p ->> 'n')::integer, 'unit', COALESCE(p ->> 'unit', 'days'), 'from', p ->> 'from'));
  IF NOT (v_plan ->> 'ok')::boolean THEN
    RAISE EXCEPTION '%', CASE v_plan ->> 'error'
      WHEN 'SV030' THEN 'Este servicio no se puede extender' WHEN 'SV031' THEN 'La fecha nueva tiene que ser posterior a hoy'
      ELSE 'Elegí hasta cuándo' END USING ERRCODE = v_plan ->> 'error';
  END IF;
  v_new := (v_plan ->> 'newEnd')::date;
  v_prev := s.status;
  UPDATE app_servicio.services
     SET ends_on = v_new,
         status = CASE WHEN (v_plan ->> 'reactivate')::boolean THEN 'active' ELSE status END,
         completed_at = CASE WHEN (v_plan ->> 'reactivate')::boolean THEN NULL ELSE completed_at END,
         extension_sale_ids = CASE WHEN (p ->> 'sale_id') IS NOT NULL AND NOT ((p ->> 'sale_id')::uuid = ANY (extension_sale_ids))
                                   THEN extension_sale_ids || (p ->> 'sale_id')::uuid ELSE extension_sale_ids END
   WHERE id = s.id;
  v_shifted := app_servicio.svc_shift_access(s.id, 0, v_new, COALESCE((p ->> 'extend_own')::boolean, false));
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.extended',
    jsonb_build_object('old_end', s.ends_on, 'new_end', v_new, 'kind', COALESCE(p ->> 'kind', 'bonus'), 'reason', p ->> 'reason',
                       'sale_id', p ->> 'sale_id', 'reactivated', (v_plan ->> 'reactivate')::boolean, 'accesses', v_shifted));
  SELECT * INTO s FROM app_servicio.services WHERE id = s.id;
  PERFORM app_servicio.svc_compute_light(s.id);
  PERFORM app_servicio.emit(s, 'service_extended', jsonb_build_object('new_end', v_new, 'kind', COALESCE(p ->> 'kind', 'bonus')));
  IF v_prev <> s.status THEN PERFORM app_servicio.emit(s, 'service_status_changed', jsonb_build_object('previous_status', v_prev)); END IF;
  RETURN jsonb_build_object('ends_on', v_new, 'reactivated', (v_plan ->> 'reactivate')::boolean, 'accesses', v_shifted);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_extend(p_service_id uuid, p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_extend(p_service_id uuid, p jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_finish(p_service_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
  v_prev text;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id FOR UPDATE;
  IF s.status NOT IN ('active', 'paused') THEN RETURN; END IF;
  v_prev := s.status;
  UPDATE app_servicio.services SET status = 'completed', completed_at = now(), paused_at = NULL, pause_cut_access = NULL, pause_resume_on = NULL
   WHERE id = s.id;
  PERFORM app_servicio.svc_cut_access(s.id, 'completed');
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.completed', jsonb_build_object('reason', p_reason));
  SELECT * INTO s FROM app_servicio.services WHERE id = s.id;
  PERFORM app_servicio.svc_compute_light(s.id);
  PERFORM app_servicio.emit(s, 'service_status_changed', jsonb_build_object('previous_status', v_prev));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_finish(p_service_id uuid, p_reason text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_finish(p_service_id uuid, p_reason text) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_generate_occurrences(p_service_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
  m app_servicio.service_items;
  ph app_servicio.service_phases;
  v_tz text; v_student_tz text; v_today date; v_start date; v_phase_start date;
  v_occ jsonb; o jsonb; v_created integer := 0; v_new uuid;
  v_grace integer;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL OR s.status <> 'active' OR NOT app_servicio.module_on(s.workspace_id) THEN RETURN 0; END IF;
  v_tz := app_servicio.ws_tz(s.workspace_id);
  -- Las repeticiones que hace el estudiante usan SU zona (con la del negocio de respaldo).
  SELECT COALESCE(NULLIF(c.timezone, ''), v_tz) INTO v_student_tz FROM public.contacts c WHERE c.id = s.contact_id;
  v_today := (now() AT TIME ZONE v_student_tz)::date;
  FOR m IN SELECT i.* FROM app_servicio.service_items i JOIN app_servicio.service_phases p ON p.id = i.phase_id
            WHERE i.service_id = p_service_id AND i.is_recurring_template AND p.status = 'in_progress' LOOP
    SELECT * INTO ph FROM app_servicio.service_phases WHERE id = m.phase_id;
    v_phase_start := app_servicio.local_date(ph.started_at, s.workspace_id);
    v_start := COALESCE(app_servicio.svc_due_date(m.recurrence -> 'from', jsonb_build_object(
                 'serviceCreated', app_servicio.local_date(s.created_at, s.workspace_id), 'serviceStart', s.starts_on,
                 'phaseStart', v_phase_start)), v_phase_start);
    v_occ := app_servicio.svc_occurrence_dates(m.recurrence, v_start,
               CASE WHEN ph.duration_days IS NOT NULL THEN v_phase_start + ph.duration_days - 1 END, s.ends_on, v_today);
    v_grace := COALESCE((m.late ->> 'grace_hours')::integer, 0);
    FOR o IN SELECT x FROM jsonb_array_elements(v_occ) x LOOP
      INSERT INTO app_servicio.service_items (workspace_id, service_id, phase_id, template_key, kind, name, description, required, assignee,
        assignee_user_id, visible_to_client, portal_button, ref, late, reminders, parent_item_id, occurrence_index, position,
        yellow_after_days, red_after_days, due_on, due_at)
      VALUES (s.workspace_id, s.id, m.phase_id, m.template_key, m.kind, m.name, m.description, m.required, m.assignee,
        m.assignee_user_id, m.visible_to_client, m.portal_button, m.ref, m.late, m.reminders, m.id, (o ->> 'index')::integer,
        m.position, m.yellow_after_days, m.red_after_days, (o ->> 'dueOn')::date,
        app_servicio.end_of_day((o ->> 'dueOn')::date, v_student_tz) + make_interval(hours => v_grace))
      ON CONFLICT (parent_item_id, occurrence_index) WHERE parent_item_id IS NOT NULL DO NOTHING
      RETURNING id INTO v_new;
      IF v_new IS NOT NULL THEN
        v_created := v_created + 1;
        PERFORM app_servicio.svc_ensure_task(v_new);
        v_new := NULL;
      END IF;
    END LOOP;
  END LOOP;
  RETURN v_created;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_generate_occurrences(p_service_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_generate_occurrences(p_service_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_get(p_service_id uuid, p_lock boolean DEFAULT false)
 RETURNS app_servicio.services
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
BEGIN
  IF p_lock THEN
    SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id FOR UPDATE;
  ELSE
    SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  END IF;
  IF s.id IS NULL THEN RAISE EXCEPTION 'No existe el servicio' USING ERRCODE = 'SV002'; END IF;
  RETURN s;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_get(p_service_id uuid, p_lock boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_get(p_service_id uuid, p_lock boolean) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_grant_initial_access(p_service_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM app_servicio.svc_apply_access_event(p_service_id, 'service_start', NULL);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_grant_initial_access(p_service_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_grant_initial_access(p_service_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_insert_access(p_service_id uuid, p_product_id uuid, p_section text, p_ends_on date, p_until_type text, p_source text, p_source_ref text, p_reason text, p_ai_limit numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s record;
  v_id uuid;
BEGIN
  SELECT id, workspace_id, contact_id INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM app_servicio_portal.portal_access a WHERE a.service_id = p_service_id AND a.product_id = p_product_id AND a.section = p_section AND a.revoked_at IS NULL) THEN
    RETURN NULL;
  END IF;
  INSERT INTO app_servicio_portal.portal_access (workspace_id, contact_id, service_id, product_id, section, ends_at, until_type, source, source_ref, reason,
                                                 ai_monthly_limit_usd, created_by)
  VALUES (s.workspace_id, s.contact_id, p_service_id, p_product_id, p_section,
          CASE WHEN p_ends_on IS NULL THEN NULL ELSE app_servicio.end_of_day(p_ends_on, app_servicio.ws_tz(s.workspace_id)) END,
          COALESCE(p_until_type, 'service'), p_source, p_source_ref, NULLIF(btrim(COALESCE(p_reason, '')), ''),
          CASE WHEN p_section = 'assistant' THEN p_ai_limit END, CASE WHEN app_servicio.is_system() THEN NULL ELSE auth.uid() END)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    PERFORM app_servicio.svc_ensure_portal_account(s.workspace_id, s.contact_id);
    PERFORM app_servicio.audit(s.workspace_id, 'service', p_service_id, 'svc.access_opened',
      jsonb_build_object('section', p_section, 'product_id', p_product_id, 'source', p_source, 'ends_on', p_ends_on));
  END IF;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_insert_access(p_service_id uuid, p_product_id uuid, p_section text, p_ends_on date, p_until_type text, p_source text, p_source_ref text, p_reason text, p_ai_limit numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_insert_access(p_service_id uuid, p_product_id uuid, p_section text, p_ends_on date, p_until_type text, p_source text, p_source_ref text, p_reason text, p_ai_limit numeric) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_instantiate_journey(p_service_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
  v_tpl jsonb;
  ph jsonb; it jsonb;
  v_phase_id uuid;
  v_pos integer := 0; v_ipos integer;
  v_first uuid := NULL;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF EXISTS (SELECT 1 FROM app_servicio.service_phases WHERE service_id = p_service_id) THEN RETURN 0; END IF;
  SELECT pv.journey_template INTO v_tpl FROM public.product_variants pv WHERE pv.id = s.product_variant_id;
  FOR ph IN SELECT x FROM jsonb_array_elements(COALESCE(v_tpl -> 'phases', '[]'::jsonb)) x LOOP
    v_pos := v_pos + 1;
    INSERT INTO app_servicio.service_phases (workspace_id, service_id, template_key, name, position, status, duration_days, yellow_day, red_day,
      advance, challenge, late_light)
    VALUES (s.workspace_id, s.id, ph ->> 'key', ph ->> 'name', v_pos, 'pending', (ph ->> 'duration_days')::integer, (ph ->> 'yellow_day')::integer,
      (ph ->> 'red_day')::integer, COALESCE(ph ->> 'advance', 'auto'), NULLIF(ph -> 'challenge', 'null'::jsonb), NULLIF(ph -> 'late_light', 'null'::jsonb))
    RETURNING id INTO v_phase_id;
    IF v_first IS NULL THEN v_first := v_phase_id; END IF;
    v_ipos := 0;
    FOR it IN SELECT x FROM jsonb_array_elements(COALESCE(ph -> 'items', '[]'::jsonb)) x LOOP
      v_ipos := v_ipos + 1;
      INSERT INTO app_servicio.service_items (workspace_id, service_id, phase_id, template_key, kind, name, description, required, assignee,
        assignee_user_id, visible_to_client, portal_button, ref, due_rule, recurrence, late, reminders, is_recurring_template, position,
        yellow_after_days, red_after_days)
      VALUES (s.workspace_id, s.id, v_phase_id, it ->> 'key', it ->> 'kind', it ->> 'name', it ->> 'description', COALESCE((it ->> 'required')::boolean, true),
        COALESCE(it ->> 'assignee', 'student'), (it ->> 'assignee_user_id')::uuid, COALESCE((it ->> 'visible_to_client')::boolean, true),
        COALESCE((it ->> 'portal_button')::boolean, false), COALESCE(NULLIF(it -> 'ref', 'null'::jsonb), '{}'::jsonb),
        NULLIF(it -> 'due_rule', 'null'::jsonb), NULLIF(it -> 'recurrence', 'null'::jsonb), NULLIF(it -> 'late', 'null'::jsonb),
        NULLIF(it -> 'reminders', 'null'::jsonb), (it -> 'recurrence') IS NOT NULL AND jsonb_typeof(it -> 'recurrence') = 'object', v_ipos,
        (it #>> '{light,yellow_after_days}')::integer, (it #>> '{light,red_after_days}')::integer);
    END LOOP;
  END LOOP;
  -- La primera fase se abre si el servicio ya empezo; si empieza en el futuro, la abre el cron ese dia.
  IF v_first IS NOT NULL AND (s.starts_on IS NULL OR s.starts_on <= app_servicio.today_in(s.workspace_id)) THEN
    PERFORM app_servicio.svc_open_phase(v_first);
  END IF;
  RETURN v_pos;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_instantiate_journey(p_service_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_instantiate_journey(p_service_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_item_access_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  BEGIN
    IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
      PERFORM app_servicio.svc_apply_access_event(NEW.service_id, 'item_completed', NEW.template_key);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'svc_item_access_hook: %', SQLERRM;
    BEGIN
      INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, actor_type, actor_label)
      VALUES (NEW.workspace_id, 'service', NEW.service_id, 'svc.hook_failed', jsonb_build_object('hook', 'item_access', 'error', left(SQLSTATE || ' ' || SQLERRM, 300)), 'system', 'servicios');
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'svc_item_access_hook (audit): %', SQLERRM;
    END;
  END;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_item_access_hook() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.svc_light(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_best_color text := 'green'; v_best_reason text := NULL;
  v_rank_best integer := 0;
  ph jsonb := p -> 'phase';
  lt jsonb := p -> 'late';
  it jsonb;
  v_d integer; v_color text; v_since integer; v_word text; v_reason text;
  w_color text := NULL; w_d integer; w_reason text;
  v_days integer; v_yd integer; v_rd integer; v_od integer; v_red integer; v_cnt integer;
  found_colors text[] := ARRAY[]::text[]; found_reasons text[] := ARRAY[]::text[];
  i integer;
BEGIN
  IF COALESCE((p ->> 'grey')::boolean, false) THEN RETURN jsonb_build_object('color', 'grey', 'reason', NULL); END IF;
  -- 1. Fase
  IF ph IS NOT NULL AND jsonb_typeof(ph) = 'object' THEN
    v_days := (ph ->> 'daysIn')::integer; v_yd := (ph ->> 'yellowDay')::integer; v_rd := (ph ->> 'redDay')::integer;
    IF v_rd IS NOT NULL AND v_days >= v_rd THEN
      found_colors := found_colors || 'red'::text; found_reasons := found_reasons || format('Fase %s · lleva %s · rojo desde el día %s', ph ->> 'name', app_servicio.svc_day_word(v_days), v_rd);
    ELSIF v_yd IS NOT NULL AND v_days >= v_yd THEN
      found_colors := found_colors || 'yellow'::text; found_reasons := found_reasons || format('Fase %s · lleva %s · amarillo desde el día %s', ph ->> 'name', app_servicio.svc_day_word(v_days), v_yd);
    END IF;
  END IF;
  -- 2. Pagos
  IF (p ->> 'oldestOverdueDays') IS NOT NULL THEN
    v_od := (p ->> 'oldestOverdueDays')::integer; v_red := (p ->> 'overdueRedDays')::integer;
    found_colors := found_colors || CASE WHEN v_od > v_red THEN 'red' ELSE 'yellow' END;
    found_reasons := found_reasons || format('Pago vencido hace %s', app_servicio.svc_day_word(v_od));
  END IF;
  -- 3. Entregas atrasadas
  IF lt IS NOT NULL AND jsonb_typeof(lt) = 'object' AND COALESCE((lt ->> 'enabled')::boolean, false) AND (lt ->> 'count')::integer > 0 THEN
    v_cnt := (lt ->> 'count')::integer;
    v_reason := format('%s %s en %s', v_cnt, CASE WHEN v_cnt = 1 THEN 'entrega atrasada' ELSE 'entregas atrasadas' END, lt ->> 'phaseName');
    IF v_cnt >= (lt ->> 'redAt')::integer THEN found_colors := found_colors || 'red'::text; found_reasons := found_reasons || v_reason;
    ELSIF v_cnt >= (lt ->> 'yellowAt')::integer THEN found_colors := found_colors || 'yellow'::text; found_reasons := found_reasons || v_reason;
    END IF;
  END IF;
  -- 4. Items vencidos con su regla
  FOR it IN SELECT x FROM jsonb_array_elements(COALESCE(p -> 'items', '[]'::jsonb)) x LOOP
    v_d := (it ->> 'daysOverdue')::integer;
    v_color := NULL; v_since := NULL;
    IF (it ->> 'redAfter') IS NOT NULL AND v_d >= (it ->> 'redAfter')::integer THEN v_color := 'red'; v_since := (it ->> 'redAfter')::integer;
    ELSIF (it ->> 'yellowAfter') IS NOT NULL AND v_d >= (it ->> 'yellowAfter')::integer THEN v_color := 'yellow'; v_since := (it ->> 'yellowAfter')::integer;
    END IF;
    CONTINUE WHEN v_color IS NULL;
    v_word := CASE v_color WHEN 'red' THEN 'rojo' ELSE 'amarillo' END;
    v_reason := CASE WHEN v_d = 0 THEN format('Ítem vence hoy: %s · %s desde el día %s', it ->> 'name', v_word, v_since)
                ELSE format('Ítem vencido hace %s: %s · %s desde el día %s', app_servicio.svc_day_word(v_d), it ->> 'name', v_word, v_since) END;
    IF w_color IS NULL
       OR (CASE v_color WHEN 'red' THEN 2 ELSE 1 END) > (CASE w_color WHEN 'red' THEN 2 ELSE 1 END)
       OR ((CASE v_color WHEN 'red' THEN 2 ELSE 1 END) = (CASE w_color WHEN 'red' THEN 2 ELSE 1 END) AND v_d > w_d) THEN
      w_color := v_color; w_d := v_d; w_reason := v_reason;
    END IF;
  END LOOP;
  IF w_color IS NOT NULL THEN found_colors := found_colors || w_color; found_reasons := found_reasons || w_reason; END IF;
  -- Gana el peor; con empate, el primero.
  FOR i IN 1 .. COALESCE(array_length(found_colors, 1), 0) LOOP
    IF (CASE found_colors[i] WHEN 'red' THEN 2 WHEN 'yellow' THEN 1 ELSE 0 END) > v_rank_best THEN
      v_rank_best := CASE found_colors[i] WHEN 'red' THEN 2 WHEN 'yellow' THEN 1 ELSE 0 END;
      v_best_color := found_colors[i]; v_best_reason := found_reasons[i];
    END IF;
  END LOOP;
  RETURN jsonb_build_object('color', v_best_color, 'reason', v_best_reason);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_light(p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_light(p jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_mark_item(p_item_id uuid, p_source text, p_by_kind text, p_by uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  it app_servicio.service_items;
  s app_servicio.services;
  ph app_servicio.service_phases;
  d record;
BEGIN
  SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id FOR UPDATE;
  IF it.id IS NULL OR it.status = 'completed' OR it.is_recurring_template THEN RETURN false; END IF;
  SELECT * INTO s FROM app_servicio.services WHERE id = it.service_id;
  SELECT * INTO ph FROM app_servicio.service_phases WHERE id = it.phase_id;
  UPDATE app_servicio.service_items
     SET status = 'completed', completed_at = now(), completed_by_kind = p_by_kind, completed_by = p_by, completed_source = p_source
   WHERE id = it.id;
  IF it.task_id IS NOT NULL THEN
    UPDATE public.tasks SET status = 'completed', completed_at = now() WHERE id = it.task_id AND status <> 'completed';
  END IF;
  -- Los pasos que vencen "al completar este" ya tienen fecha.
  FOR d IN SELECT o.id FROM app_servicio.service_items o
            WHERE o.service_id = it.service_id AND o.status = 'pending' AND o.due_rule ->> 'from' = 'item_completed'
              AND o.due_rule ->> 'item_key' = it.template_key LOOP
    PERFORM app_servicio.svc_compute_due(d.id);
  END LOOP;
  PERFORM app_servicio.audit(s.workspace_id, 'service_item', it.id, 'svc.item_completed',
    jsonb_build_object('service_id', s.id, 'item_key', it.template_key, 'source', p_source), CASE p_by_kind WHEN 'client' THEN 'client' WHEN 'user' THEN 'user' ELSE 'system' END);
  PERFORM app_servicio.emit(s, 'service_item_completed', jsonb_build_object('phase_key', ph.template_key, 'item_key', it.template_key, 'item_kind', it.kind));
  IF ph.status = 'in_progress' THEN
    PERFORM app_servicio.svc_check_open_items(ph.id);
    PERFORM app_servicio.svc_try_advance_phase(s.id);
  END IF;
  PERFORM app_servicio.svc_compute_light(s.id);
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_mark_item(p_item_id uuid, p_source text, p_by_kind text, p_by uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_mark_item(p_item_id uuid, p_source text, p_by_kind text, p_by uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_move_core(p_service_id uuid, p_phase_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
  target app_servicio.service_phases;
  cur app_servicio.service_phases;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  SELECT * INTO target FROM app_servicio.service_phases WHERE id = p_phase_id AND service_id = p_service_id;
  IF target.id IS NULL THEN RAISE EXCEPTION 'No existe la fase' USING ERRCODE = 'SV002'; END IF;
  SELECT * INTO cur FROM app_servicio.service_phases WHERE service_id = p_service_id AND status = 'in_progress';
  IF cur.id = target.id THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('svc_advance:' || p_service_id::text, 0));
  -- Las salteadas (y la actual) quedan completadas como "movidas a mano"; las posteriores vuelven a pendiente.
  UPDATE app_servicio.service_phases SET status = 'completed', completed_at = now(), completed_via = 'manual_move', awaiting_start = false
   WHERE service_id = p_service_id AND position < target.position AND status <> 'completed';
  UPDATE app_servicio.service_phases SET status = 'pending', started_at = NULL, completed_at = NULL, completed_via = NULL
   WHERE service_id = p_service_id AND position > target.position AND status <> 'pending';
  IF target.status <> 'pending' THEN
    UPDATE app_servicio.service_phases SET status = 'pending', started_at = NULL, completed_at = NULL, completed_via = NULL WHERE id = target.id;
  END IF;
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.phase_moved',
    jsonb_build_object('from_phase', cur.template_key, 'to_phase', target.template_key, 'reason', p_reason));
  PERFORM app_servicio.svc_open_phase(target.id, true);
  PERFORM app_servicio.svc_compute_light(s.id);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_move_core(p_service_id uuid, p_phase_id uuid, p_reason text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_move_core(p_service_id uuid, p_phase_id uuid, p_reason text) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_move_to_phase(p_service_id uuid, p_phase_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
BEGIN
  s := app_servicio.svc_get(p_service_id, true);
  PERFORM app_servicio.require_service(s, 'services.change_phase');
  IF nullif(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'SV016'; END IF;
  IF s.status <> 'active' THEN RAISE EXCEPTION 'El servicio no está activo' USING ERRCODE = 'SV017'; END IF;
  PERFORM app_servicio.svc_move_core(p_service_id, p_phase_id, p_reason);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_move_to_phase(p_service_id uuid, p_phase_id uuid, p_reason text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_move_to_phase(p_service_id uuid, p_phase_id uuid, p_reason text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_occurrence_dates(p_recurrence jsonb, p_start date, p_phase_end date, p_service_end date, p_upto date)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_step integer := CASE p_recurrence ->> 'every' WHEN 'day' THEN 1 WHEN 'week' THEN 7
                       ELSE GREATEST(1, COALESCE((p_recurrence ->> 'n')::integer, 1)) END;
  v_limit date := CASE p_recurrence ->> 'until'
                    WHEN 'phase_end' THEN p_phase_end WHEN 'service_end' THEN p_service_end
                    WHEN 'n_days' THEN p_start + (GREATEST(1, COALESCE((p_recurrence ->> 'n_until')::integer, 1)) - 1) END;
  v_max integer := CASE WHEN p_recurrence ->> 'until' = 'n_times' THEN GREATEST(1, COALESCE((p_recurrence ->> 'n_until')::integer, 1)) ELSE 1000 END;
  v_out jsonb := '[]'::jsonb;
  v_day date;
  k integer;
BEGIN
  IF p_start IS NULL THEN RETURN v_out; END IF;
  FOR k IN 0 .. v_max - 1 LOOP
    v_day := p_start + k * v_step;
    EXIT WHEN v_limit IS NOT NULL AND v_day > v_limit;
    EXIT WHEN v_day > p_upto;
    v_out := v_out || jsonb_build_array(jsonb_build_object('index', k + 1, 'occursOn', to_char(v_day, 'YYYY-MM-DD'),
                                                           'dueOn', to_char(v_day + v_step - 1, 'YYYY-MM-DD')));
  END LOOP;
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_occurrence_dates(p_recurrence jsonb, p_start date, p_phase_end date, p_service_end date, p_upto date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_occurrence_dates(p_recurrence jsonb, p_start date, p_phase_end date, p_service_end date, p_upto date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_open_access(p_service_id uuid, p_section text, p_scope text, p_source text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s record;
  r jsonb;
  v_until_day date;
BEGIN
  SELECT id, workspace_id, product_id, product_variant_id, status, ends_on INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL OR s.status NOT IN ('active', 'paused') OR NOT app_servicio.module_on(s.workspace_id) THEN RETURN; END IF;
  IF NOT app_servicio.portal_section_enabled(s.product_id, p_section) THEN RETURN; END IF;
  r := app_servicio.portal_section_rule(s.product_variant_id, p_section);
  v_until_day := app_servicio.portal_until_day(r -> 'until', app_servicio.today_in(s.workspace_id), s.ends_on);
  PERFORM app_servicio.svc_insert_access(s.id, s.product_id, p_section, v_until_day, COALESCE(r #>> '{until,type}', 'service'),
    CASE WHEN p_source IN ('service_start', 'journey_item', 'automation', 'renewal_transfer', 'extension') THEN p_source ELSE 'automation' END,
    p_scope, NULL, CASE WHEN jsonb_typeof(r -> 'ai_limit_usd') = 'number' THEN (r ->> 'ai_limit_usd')::numeric END);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_open_access(p_service_id uuid, p_section text, p_scope text, p_source text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_open_access(p_service_id uuid, p_section text, p_scope text, p_source text) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_open_due_challenges(p_service_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  ph app_servicio.service_phases;
  s app_servicio.services;
  n integer := 0;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.status <> 'active' THEN RETURN 0; END IF;
  FOR ph IN SELECT * FROM app_servicio.service_phases WHERE service_id = p_service_id AND awaiting_start AND status = 'pending'
             AND challenge ->> 'start' = 'fixed_date' AND (challenge ->> 'fixed_date')::date <= app_servicio.today_in(s.workspace_id) LOOP
    IF NOT EXISTS (SELECT 1 FROM app_servicio.service_phases WHERE service_id = p_service_id AND status = 'in_progress') THEN
      PERFORM app_servicio.svc_open_phase(ph.id, true);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_open_due_challenges(p_service_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_open_due_challenges(p_service_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_open_module_now(p_service_id uuid, p_program_item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
BEGIN
  s := app_servicio.svc_get(p_service_id);
  PERFORM app_servicio.require_service(s, 'services.access');
  PERFORM app_servicio.svc_open_module(s.id, p_program_item_id, 'team');
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_open_module_now(p_service_id uuid, p_program_item_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_open_module_now(p_service_id uuid, p_program_item_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_open_module(p_service_id uuid, p_program_item_id uuid, p_source text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s record;
BEGIN
  SELECT id, workspace_id, contact_id, product_id INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL OR NOT app_servicio.module_on(s.workspace_id) THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM app_servicio.program_items WHERE id = p_program_item_id AND product_id = s.product_id) THEN RETURN; END IF;
  INSERT INTO app_servicio_portal.program_progress (workspace_id, contact_id, program_item_id, unlocked_at, unlock_source)
  VALUES (s.workspace_id, s.contact_id, p_program_item_id, now(), CASE WHEN p_source IN ('journey_item', 'automation', 'team') THEN p_source ELSE 'team' END)
  ON CONFLICT (contact_id, program_item_id) DO UPDATE SET unlocked_at = COALESCE(app_servicio_portal.program_progress.unlocked_at, EXCLUDED.unlocked_at),
    unlock_source = COALESCE(app_servicio_portal.program_progress.unlock_source, EXCLUDED.unlock_source), updated_at = now();
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.module_opened', jsonb_build_object('program_item_id', p_program_item_id, 'source', p_source));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_open_module(p_service_id uuid, p_program_item_id uuid, p_source text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_open_module(p_service_id uuid, p_program_item_id uuid, p_source text) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_open_phase(p_phase_id uuid, p_force boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  ph app_servicio.service_phases;
  s app_servicio.services;
  it record;
  v_start text;
BEGIN
  SELECT * INTO ph FROM app_servicio.service_phases WHERE id = p_phase_id FOR UPDATE;
  IF ph.id IS NULL OR ph.status <> 'pending' THEN RETURN; END IF;
  SELECT * INTO s FROM app_servicio.services WHERE id = ph.service_id;
  -- La fase Reto que arranca el estudiante, una automatizacion o una fecha fija futura queda esperando.
  IF NOT p_force AND ph.challenge IS NOT NULL AND COALESCE((ph.challenge ->> 'enabled')::boolean, false) THEN
    v_start := ph.challenge ->> 'start';
    IF v_start IN ('student', 'automation')
       OR (v_start = 'fixed_date' AND (ph.challenge ->> 'fixed_date')::date > app_servicio.today_in(s.workspace_id)) THEN
      UPDATE app_servicio.service_phases SET awaiting_start = true WHERE id = ph.id;
      RETURN;
    END IF;
  END IF;
  UPDATE app_servicio.service_phases SET status = 'in_progress', started_at = now(), awaiting_start = false WHERE id = ph.id;
  FOR it IN SELECT id FROM app_servicio.service_items WHERE phase_id = ph.id AND parent_item_id IS NULL AND NOT is_recurring_template LOOP
    PERFORM app_servicio.svc_compute_due(it.id);
    PERFORM app_servicio.svc_ensure_task(it.id);
  END LOOP;
  -- Los pasos de fases todavia no abiertas que dependen del inicio del servicio tambien se calculan.
  PERFORM app_servicio.svc_generate_occurrences(s.id);
  PERFORM app_servicio.audit(s.workspace_id, 'service_phase', ph.id, 'svc.phase_started', jsonb_build_object('service_id', s.id, 'phase_key', ph.template_key));
  PERFORM app_servicio.emit(s, 'service_phase_started', jsonb_build_object('phase_key', ph.template_key));
  IF ph.challenge IS NOT NULL AND COALESCE((ph.challenge ->> 'enabled')::boolean, false) THEN
    PERFORM app_servicio.emit(s, 'challenge_started', jsonb_build_object('phase_key', ph.template_key));
  END IF;
  PERFORM app_servicio.svc_check_open_items(ph.id);
  PERFORM app_servicio.svc_try_advance_phase(s.id);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_open_phase(p_phase_id uuid, p_force boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_open_phase(p_phase_id uuid, p_force boolean) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_overdue_sweep(p_workspace_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s record;
  v_cut jsonb;
  v_days integer;
  v_late boolean;
  v_today date;
  v_susp integer := 0;
  v_rest integer := 0;
  n integer;
BEGIN
  IF NOT app_servicio.module_on(p_workspace_id) THEN RETURN jsonb_build_object('suspended', 0, 'restored', 0); END IF;
  v_today := app_servicio.today_in(p_workspace_id);
  FOR s IN SELECT sv.id, sv.sale_id, v.service_settings -> 'overdue_cut' AS cut
             FROM app_servicio.services sv JOIN public.product_variants v ON v.id = sv.product_variant_id
            WHERE sv.workspace_id = p_workspace_id AND sv.status = 'active' AND sv.sale_id IS NOT NULL LOOP
    v_cut := s.cut;
    CONTINUE WHEN v_cut IS NULL OR NOT COALESCE((v_cut ->> 'enabled')::boolean, false);
    v_days := COALESCE(NULLIF(v_cut ->> 'days', '')::integer, 30);
    v_late := EXISTS (SELECT 1 FROM public.payments pm WHERE pm.sale_id = s.sale_id AND pm.status = 'overdue' AND pm.due_date IS NOT NULL AND v_today - pm.due_date > v_days);
    IF v_late THEN
      UPDATE app_servicio_portal.portal_access SET suspended_overdue_at = now(), updated_at = now()
       WHERE service_id = s.id AND revoked_at IS NULL AND suspended_overdue_at IS NULL;
      GET DIAGNOSTICS n = ROW_COUNT; v_susp := v_susp + n;
      IF n > 0 THEN PERFORM app_servicio.audit(p_workspace_id, 'service', s.id, 'svc.access_suspended_overdue', jsonb_build_object('days', v_days), 'system'); END IF;
    ELSIF COALESCE((v_cut ->> 'restore')::boolean, true)
          AND NOT EXISTS (SELECT 1 FROM public.payments pm WHERE pm.sale_id = s.sale_id AND pm.status = 'overdue') THEN
      UPDATE app_servicio_portal.portal_access SET suspended_overdue_at = NULL, updated_at = now()
       WHERE service_id = s.id AND suspended_overdue_at IS NOT NULL;
      GET DIAGNOSTICS n = ROW_COUNT; v_rest := v_rest + n;
      IF n > 0 THEN PERFORM app_servicio.audit(p_workspace_id, 'service', s.id, 'svc.access_restored_overdue', '{}'::jsonb, 'system'); END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('suspended', v_susp, 'restored', v_rest);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_overdue_sweep(p_workspace_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_overdue_sweep(p_workspace_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_owner_pick_plan(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v text;
  live jsonb := COALESCE(p -> 'activeMembers', '[]'::jsonb);
BEGIN
  CASE p ->> 'mode'
    WHEN 'fixed' THEN v := CASE WHEN live ? (p ->> 'userId') THEN p ->> 'userId' END;
    WHEN 'round_robin' THEN v := app_servicio.svc_owner_pick_rr(p, p -> 'members');
    WHEN 'previous' THEN v := CASE WHEN live ? (p ->> 'previousOwner') THEN p ->> 'previousOwner' END;
    WHEN 'conditions' THEN
      v := CASE WHEN live ? (p ->> 'conditionUserId') THEN p ->> 'conditionUserId' END;
      IF v IS NULL AND jsonb_typeof(p -> 'conditionMembers') = 'array' THEN v := app_servicio.svc_owner_pick_rr(p, p -> 'conditionMembers'); END IF;
      IF v IS NULL AND jsonb_array_length(COALESCE(p -> 'members', '[]'::jsonb)) > 0 THEN v := app_servicio.svc_owner_pick_rr(p, p -> 'members'); END IF;
    ELSE v := NULL;
  END CASE;
  IF v IS NOT NULL THEN RETURN jsonb_build_object('userId', v, 'usedFallback', false); END IF;
  RETURN jsonb_build_object('userId', CASE WHEN live ? (p ->> 'fallback') THEN p ->> 'fallback' END, 'usedFallback', true);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_owner_pick_plan(p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_owner_pick_plan(p jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_owner_pick_rr(p jsonb, p_members jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT m FROM jsonb_array_elements_text(COALESCE(p_members, '[]'::jsonb)) m
  WHERE (p -> 'activeMembers') ? m
  ORDER BY COALESCE((p -> 'activeCounts' ->> m)::integer, 0), COALESCE(p -> 'lastAssignedAt' ->> m, ''), m
  LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_owner_pick_rr(p jsonb, p_members jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_owner_pick_rr(p jsonb, p_members jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_pause(p_service_id uuid, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
  v_cut boolean := COALESCE((p ->> 'cut_access')::boolean, true);
BEGIN
  s := app_servicio.svc_get(p_service_id, true);
  PERFORM app_servicio.require_service(s, 'services.pause');
  IF nullif(btrim(p ->> 'reason'), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'SV016'; END IF;
  IF s.status <> 'active' THEN RAISE EXCEPTION 'Solo se pausa un servicio activo' USING ERRCODE = 'SV017'; END IF;
  UPDATE app_servicio.services SET status = 'paused', paused_at = now(), pause_cut_access = v_cut, pause_resume_on = (p ->> 'resume_on')::date
   WHERE id = s.id;
  IF v_cut THEN PERFORM app_servicio.svc_suspend_for_pause(s.id, true); END IF;
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.paused',
    jsonb_build_object('reason', p ->> 'reason', 'cut_access', v_cut, 'resume_on', p ->> 'resume_on'));
  SELECT * INTO s FROM app_servicio.services WHERE id = s.id;
  PERFORM app_servicio.svc_compute_light(s.id);
  PERFORM app_servicio.emit(s, 'service_paused');
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_pause(p_service_id uuid, p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_pause(p_service_id uuid, p jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_phase_access_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  BEGIN
    IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
      PERFORM app_servicio.svc_apply_access_event(NEW.service_id, 'phase_completed', NEW.template_key);
    ELSIF NEW.status = 'in_progress' AND OLD.status IS DISTINCT FROM 'in_progress' AND NEW.challenge IS NOT NULL THEN
      PERFORM app_servicio.svc_apply_access_event(NEW.service_id, 'challenge_started', NEW.template_key);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'svc_phase_access_hook: %', SQLERRM;
    BEGIN
      INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, actor_type, actor_label)
      VALUES (NEW.workspace_id, 'service', NEW.service_id, 'svc.hook_failed', jsonb_build_object('hook', 'phase_access', 'error', left(SQLSTATE || ' ' || SQLERRM, 300)), 'system', 'servicios');
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'svc_phase_access_hook (audit): %', SQLERRM;
    END;
  END;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_phase_access_hook() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.svc_phase_should_advance(p_advance text, p_req_total integer, p_req_done integer, p_all_total integer, p_all_done integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE p_advance WHEN 'auto' THEN p_req_done >= p_req_total WHEN 'auto_all' THEN p_all_done >= p_all_total ELSE false END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_phase_should_advance(p_advance text, p_req_total integer, p_req_done integer, p_all_total integer, p_all_done integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_phase_should_advance(p_advance text, p_req_total integer, p_req_done integer, p_all_total integer, p_all_done integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_pick_owner(p_variant_id uuid, p_contact_id uuid, p_previous_owner uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_var public.product_variants;
  o jsonb;
  v_live jsonb; v_counts jsonb; v_last jsonb;
  v_ctx jsonb; r jsonb; v_cond_user text := NULL; v_cond_members jsonb := NULL;
BEGIN
  SELECT * INTO v_var FROM public.product_variants WHERE id = p_variant_id;
  o := COALESCE(v_var.service_settings -> 'owner', '{}'::jsonb);
  SELECT COALESCE(jsonb_agg(m.user_id::text), '[]'::jsonb) INTO v_live FROM public.workspace_members m WHERE m.workspace_id = v_var.workspace_id;
  SELECT COALESCE(jsonb_object_agg(owner_user_id::text, n), '{}'::jsonb) INTO v_counts
    FROM (SELECT s.owner_user_id, count(*) n FROM app_servicio.services s
          WHERE s.product_id = v_var.product_id AND s.status IN ('active','paused') AND s.owner_user_id IS NOT NULL GROUP BY 1) t;
  SELECT COALESCE(jsonb_object_agg(owner_user_id::text, last_at), '{}'::jsonb) INTO v_last
    FROM (SELECT s.owner_user_id, to_char(max(s.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') last_at FROM app_servicio.services s
          WHERE s.product_id = v_var.product_id AND s.owner_user_id IS NOT NULL GROUP BY 1) t;
  IF o ->> 'mode' = 'conditions' THEN
    v_ctx := app_servicio.svc_contact_context(p_contact_id);
    FOR r IN SELECT x FROM jsonb_array_elements(COALESCE(o -> 'conditions', '[]'::jsonb)) x LOOP
      CONTINUE WHEN COALESCE((r ->> 'is_active')::boolean, true) = false;
      IF app_servicio.svc_conditions_match(r -> 'conditions', v_ctx) THEN
        IF r #>> '{destination,type}' = 'user' THEN v_cond_user := r #>> '{destination,user_id}';
        ELSIF r #>> '{destination,type}' = 'round_robin' THEN v_cond_members := r #> '{destination,members}';
        END IF;
        EXIT;
      END IF;
    END LOOP;
  END IF;
  RETURN app_servicio.svc_owner_pick_plan(jsonb_build_object(
    'mode', o ->> 'mode', 'userId', o ->> 'user_id', 'members', COALESCE(o -> 'members', '[]'::jsonb),
    'activeCounts', v_counts, 'lastAssignedAt', v_last, 'conditionUserId', v_cond_user, 'conditionMembers', v_cond_members,
    'previousOwner', p_previous_owner::text, 'fallback', o ->> 'fallback_user_id', 'activeMembers', v_live));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_pick_owner(p_variant_id uuid, p_contact_id uuid, p_previous_owner uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_pick_owner(p_variant_id uuid, p_contact_id uuid, p_previous_owner uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_progress_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_service uuid := COALESCE(NEW.service_id, OLD.service_id);
  v_total integer; v_done integer;
BEGIN
  SELECT count(*) FILTER (WHERE required AND NOT is_recurring_template),
         count(*) FILTER (WHERE required AND NOT is_recurring_template AND status = 'completed')
    INTO v_total, v_done FROM app_servicio.service_items WHERE service_id = v_service;
  UPDATE app_servicio.services
     SET progress_pct = CASE WHEN v_total = 0 THEN NULL ELSE round(v_done * 100.0 / v_total, 2) END
   WHERE id = v_service AND progress_pct IS DISTINCT FROM CASE WHEN v_total = 0 THEN NULL ELSE round(v_done * 100.0 / v_total, 2) END;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_progress_trigger() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_progress_trigger() TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_relock_module(p_service_id uuid, p_program_item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s record;
BEGIN
  SELECT id, workspace_id, contact_id INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL THEN RETURN; END IF;
  UPDATE app_servicio_portal.program_progress SET unlocked_at = NULL, unlock_source = NULL, updated_at = now()
   WHERE contact_id = s.contact_id AND program_item_id = p_program_item_id;
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.module_relocked', jsonb_build_object('program_item_id', p_program_item_id));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_relock_module(p_service_id uuid, p_program_item_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_relock_module(p_service_id uuid, p_program_item_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_renewal_plan(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  prev jsonb := p -> 'prev';
  v_today date := (p ->> 'today')::date;
  v_status text; v_running boolean; v_ended date; v_ends date;
BEGIN
  IF prev IS NULL OR jsonb_typeof(prev) = 'null' OR prev ->> 'status' IN ('cancelled', 'pending_confirmation') THEN
    RETURN jsonb_build_object('action', 'new', 'startsOn', NULL);
  END IF;
  v_status := prev ->> 'status';
  v_running := v_status IN ('active', 'paused');
  v_ends := (prev ->> 'endsOn')::date;
  v_ended := COALESCE((prev ->> 'endedOn')::date, v_ends);
  IF NOT v_running AND v_ended IS NOT NULL AND (v_today - v_ended) > 60 THEN
    RETURN jsonb_build_object('action', 'recovery', 'startsOn', NULL);
  END IF;
  IF p ->> 'renewal' = 'extend' THEN RETURN jsonb_build_object('action', 'extend', 'startsOn', NULL); END IF;
  IF p ->> 'renewal' = 'ask' THEN RETURN jsonb_build_object('action', 'ask', 'startsOn', NULL); END IF;
  RETURN jsonb_build_object('action', 'new_linked', 'startsOn',
    CASE WHEN v_running AND v_ends IS NOT NULL AND v_ends >= v_today THEN to_char(v_ends + 1, 'YYYY-MM-DD') END);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_renewal_plan(p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_renewal_plan(p jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_require_item(s app_servicio.services, it app_servicio.service_items)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF app_servicio.is_system() THEN RETURN; END IF;
  IF NOT public.has_permission(s.workspace_id, 'services.items') OR NOT app_servicio.can_see_service_row(s) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF public.permission_scope(s.workspace_id, 'services') <> 'all'
     AND NOT ((it.assignee = 'owner' AND s.owner_user_id = auth.uid()) OR (it.assignee = 'user' AND it.assignee_user_id = auth.uid())) THEN
    RAISE EXCEPTION 'Este paso no está a tu cargo' USING ERRCODE = 'SV004';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_require_item(s app_servicio.services, it app_servicio.service_items) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_require_item(s app_servicio.services, it app_servicio.service_items) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_resume_plan(p_paused_at timestamp with time zone, p_now timestamp with time zone, p_shift_days integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN p_shift_days IS NOT NULL THEN GREATEST(0, p_shift_days)
              ELSE GREATEST(0, ceil(extract(epoch FROM (p_now - p_paused_at)) / 86400.0)::integer) END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_resume_plan(p_paused_at timestamp with time zone, p_now timestamp with time zone, p_shift_days integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_resume_plan(p_paused_at timestamp with time zone, p_now timestamp with time zone, p_shift_days integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_resume(p_service_id uuid, p jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
  n integer;
  v_items integer; v_tasks integer; v_access integer;
  v_old_end date;
BEGIN
  s := app_servicio.svc_get(p_service_id, true);
  PERFORM app_servicio.require_service(s, 'services.pause');
  IF s.status <> 'paused' THEN RAISE EXCEPTION 'El servicio no está pausado' USING ERRCODE = 'SV017'; END IF;
  n := app_servicio.svc_resume_plan(s.paused_at, now(), (p ->> 'shift_days')::integer);
  v_old_end := s.ends_on;
  UPDATE app_servicio.services
     SET status = 'active', ends_on = CASE WHEN ends_on IS NULL THEN NULL ELSE ends_on + n END, paused_days = paused_days + n,
         paused_at = NULL, pause_cut_access = NULL, pause_resume_on = NULL
   WHERE id = s.id;
  -- Se corren los vencimientos pendientes y las tareas abiertas de esos pasos.
  UPDATE app_servicio.service_items SET due_on = due_on + n, due_at = due_at + make_interval(days => n)
   WHERE service_id = s.id AND status = 'pending' AND (due_on IS NOT NULL OR due_at IS NOT NULL);
  GET DIAGNOSTICS v_items = ROW_COUNT;
  UPDATE public.tasks t SET due_date = t.due_date + n
    FROM app_servicio.service_items i
   WHERE i.service_id = s.id AND i.task_id = t.id AND t.status <> 'completed' AND t.due_date IS NOT NULL;
  GET DIAGNOSTICS v_tasks = ROW_COUNT;
  -- La fase en curso no cuenta los dias de pausa.
  UPDATE app_servicio.service_phases SET started_at = started_at + make_interval(days => n) WHERE service_id = s.id AND status = 'in_progress';
  v_access := app_servicio.svc_shift_access(s.id, n, NULL, false);
  PERFORM app_servicio.svc_suspend_for_pause(s.id, false);
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.resumed',
    jsonb_build_object('shift_days', n, 'old_end', v_old_end, 'items', v_items, 'tasks', v_tasks, 'accesses', v_access));
  SELECT * INTO s FROM app_servicio.services WHERE id = s.id;
  -- Un Reto con fecha fija que cayo durante la pausa se abre al reanudar.
  PERFORM app_servicio.svc_open_due_challenges(s.id);
  PERFORM app_servicio.svc_generate_occurrences(s.id);
  PERFORM app_servicio.svc_compute_light(s.id);
  PERFORM app_servicio.emit(s, 'service_resumed', jsonb_build_object('shift_days', n));
  RETURN jsonb_build_object('shift_days', n, 'ends_on', s.ends_on, 'items', v_items, 'tasks', v_tasks, 'accesses', v_access);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_resume(p_service_id uuid, p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_resume(p_service_id uuid, p jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_revert_extension(p_service_id uuid, p_sale_id uuid)
 RETURNS date
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
  v_old date;
BEGIN
  s := app_servicio.svc_get(p_service_id, true);
  PERFORM app_servicio.require_service(s, 'services.extend');
  IF NOT (p_sale_id = ANY (s.extension_sale_ids)) THEN RAISE EXCEPTION 'Esa venta no extendió este servicio' USING ERRCODE = 'SV002'; END IF;
  SELECT (a.changes ->> 'old_end')::date INTO v_old FROM public.audit_log a
   WHERE a.entity_type = 'service' AND a.entity_id = s.id AND a.action = 'svc.extended' AND a.changes ->> 'sale_id' = p_sale_id::text
   ORDER BY a.performed_at DESC LIMIT 1;
  UPDATE app_servicio.services SET ends_on = v_old, extension_sale_ids = array_remove(extension_sale_ids, p_sale_id) WHERE id = s.id;
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.extension_reverted', jsonb_build_object('sale_id', p_sale_id, 'old_end', s.ends_on, 'new_end', v_old));
  RETURN v_old;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_revert_extension(p_service_id uuid, p_sale_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_revert_extension(p_service_id uuid, p_sale_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_rule_check(p_sale_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_sale public.sales;
  v_settings jsonb;
  v_facts jsonb;
  v_rule text;
  v_input jsonb;
  v_enabled timestamptz;
BEGIN
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'No existe la venta' USING ERRCODE = 'SV002'; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.is_workspace_member(v_sale.workspace_id) AND public.can_see_sale(v_sale)) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  SELECT pv.service_settings INTO v_settings FROM public.product_variants pv WHERE pv.id = v_sale.product_variant_id;
  IF COALESCE(v_settings ->> 'mode', 'none') = 'none' THEN
    RETURN jsonb_build_object('met', false, 'reason', 'no_rule', 'mode', 'none', 'variant_id', v_sale.product_variant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM app_servicio.services s WHERE s.sale_id = p_sale_id OR p_sale_id = ANY (s.extension_sale_ids)) THEN
    RETURN jsonb_build_object('met', false, 'reason', 'already_has_service', 'mode', v_settings ->> 'mode', 'variant_id', v_sale.product_variant_id);
  END IF;
  v_facts := app_servicio.svc_sale_facts(p_sale_id);
  v_rule := v_settings #>> '{when,rule}';
  v_enabled := (v_settings #>> '{when,enabled_at}')::timestamptz;
  IF NOT (v_facts ->> 'hasAnyPaid')::boolean THEN
    RETURN jsonb_build_object('met', false, 'reason', 'no_payment', 'mode', v_settings ->> 'mode', 'variant_id', v_sale.product_variant_id);
  END IF;
  IF v_enabled IS NOT NULL AND (v_facts ->> 'lastPaidAt')::timestamptz < v_enabled THEN
    RETURN jsonb_build_object('met', false, 'reason', 'before_enabled', 'mode', v_settings ->> 'mode', 'variant_id', v_sale.product_variant_id);
  END IF;
  v_input := v_facts || jsonb_build_object('rule', v_rule, 'value', v_settings #> '{when,value}');
  IF app_servicio.svc_rule_met(v_input) THEN
    RETURN jsonb_build_object('met', true, 'reason', 'met', 'mode', v_settings ->> 'mode', 'variant_id', v_sale.product_variant_id);
  END IF;
  RETURN jsonb_build_object('met', false, 'mode', v_settings ->> 'mode', 'variant_id', v_sale.product_variant_id, 'reason',
    CASE v_rule WHEN 'non_reservation' THEN 'only_reservation' WHEN 'percent' THEN 'below_percent' WHEN 'amount' THEN 'below_amount' ELSE 'no_payment' END);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_rule_check(p_sale_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_rule_check(p_sale_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_rule_met(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE p ->> 'rule'
    WHEN 'any_payment' THEN COALESCE((p ->> 'hasAnyPaid')::boolean, false) AND COALESCE((p ->> 'collectedCents')::numeric, 0) > 0
    WHEN 'non_reservation' THEN COALESCE((p ->> 'hasNonReservationPaid')::boolean, false)
    WHEN 'percent' THEN COALESCE((p ->> 'totalCents')::numeric, 0) > 0 AND (p ->> 'value') IS NOT NULL
      AND (p ->> 'collectedCents')::numeric * 100 >= (p ->> 'value')::numeric * (p ->> 'totalCents')::numeric
    WHEN 'amount' THEN (p ->> 'value') IS NOT NULL AND COALESCE((p ->> 'collectedCents')::numeric, 0) >= (p ->> 'value')::numeric
    ELSE false END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_rule_met(p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_rule_met(p jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_sale_facts(p_sale_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'collectedCents', COALESCE(sum(round(p.amount * 100)) FILTER (WHERE p.status = 'paid' AND p.type <> 'refund'), 0)
                    - COALESCE(sum(abs(round(p.amount * 100))) FILTER (WHERE p.status = 'paid' AND p.type = 'refund'), 0),
    'totalCents', (SELECT round(s.final_amount * 100) FROM public.sales s WHERE s.id = p_sale_id),
    'hasNonReservationPaid', COALESCE(bool_or(p.status = 'paid' AND p.type NOT IN ('reservation', 'refund')), false),
    'hasAnyPaid', COALESCE(bool_or(p.status = 'paid' AND p.type <> 'refund'), false),
    'lastPaidAt', max(p.paid_at) FILTER (WHERE p.status = 'paid' AND p.type <> 'refund'))
  FROM public.payments p WHERE p.sale_id = p_sale_id;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_sale_facts(p_sale_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_sale_facts(p_sale_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_save_journey_template(p_variant_id uuid, p_template jsonb, p_rev integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_row public.product_variants;
  v_problems text[];
BEGIN
  SELECT * INTO v_row FROM public.product_variants WHERE id = p_variant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe la variante' USING ERRCODE = 'SV002'; END IF;
  PERFORM app_servicio.require_permission(v_row.workspace_id, 'services.configure');
  v_problems := app_servicio.validate_journey_template(p_template, p_variant_id);
  IF array_length(v_problems, 1) > 0 THEN
    RETURN jsonb_build_object('status', 'invalid', 'problems', to_jsonb(v_problems));
  END IF;
  UPDATE public.product_variants
     SET journey_template = p_template, journey_template_rev = journey_template_rev + 1
   WHERE id = p_variant_id AND journey_template_rev = p_rev;
  IF NOT FOUND THEN
    SELECT * INTO v_row FROM public.product_variants WHERE id = p_variant_id;
    RETURN jsonb_build_object('status', 'conflict', 'current', v_row.journey_template, 'rev', v_row.journey_template_rev);
  END IF;
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, performed_by, actor_type)
  VALUES (v_row.workspace_id, 'product_variant', p_variant_id, 'svc.config_saved',
          jsonb_build_object('part', 'journey', 'phases', jsonb_array_length(COALESCE(p_template -> 'phases', '[]'::jsonb))), auth.uid(), 'user');
  RETURN jsonb_build_object('status', 'ok', 'rev', p_rev + 1, 'current', p_template);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_save_journey_template(p_variant_id uuid, p_template jsonb, p_rev integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_save_journey_template(p_variant_id uuid, p_template jsonb, p_rev integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_save_service_settings(p_variant_id uuid, p_settings jsonb, p_rev integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_row public.product_variants;
  v_new jsonb := p_settings;
  v_problems text[];
  v_before_mode text; v_after_mode text;
BEGIN
  SELECT * INTO v_row FROM public.product_variants WHERE id = p_variant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe la variante' USING ERRCODE = 'SV002'; END IF;
  PERFORM app_servicio.require_permission(v_row.workspace_id, 'services.configure');
  v_before_mode := COALESCE(v_row.service_settings ->> 'mode', 'none');
  v_after_mode := COALESCE(v_new ->> 'mode', 'none');
  -- when.enabled_at lo pone la base (F5): al pasar de none a create/extend, ahora; al volver a none, se va.
  IF v_after_mode = 'none' THEN
    v_new := v_new - 'when';
  ELSIF jsonb_typeof(v_new -> 'when') = 'object' THEN
    v_new := jsonb_set(v_new, '{when,enabled_at}', to_jsonb(CASE
      WHEN v_before_mode = 'none' OR v_row.service_settings #>> '{when,enabled_at}' IS NULL THEN now()::text
      ELSE v_row.service_settings #>> '{when,enabled_at}' END));
  END IF;
  v_problems := app_servicio.validate_service_settings(v_new, p_variant_id);
  IF array_length(v_problems, 1) > 0 THEN
    RETURN jsonb_build_object('status', 'invalid', 'problems', to_jsonb(v_problems));
  END IF;
  UPDATE public.product_variants
     SET service_settings = v_new, service_settings_rev = service_settings_rev + 1
   WHERE id = p_variant_id AND service_settings_rev = p_rev;
  IF NOT FOUND THEN
    SELECT * INTO v_row FROM public.product_variants WHERE id = p_variant_id;
    RETURN jsonb_build_object('status', 'conflict', 'current', v_row.service_settings, 'rev', v_row.service_settings_rev);
  END IF;
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, performed_by, actor_type)
  VALUES (v_row.workspace_id, 'product_variant', p_variant_id, 'svc.config_saved',
          jsonb_build_object('part', 'service', 'old', v_row.service_settings, 'new', v_new), auth.uid(), 'user');
  RETURN jsonb_build_object('status', 'ok', 'rev', p_rev + 1, 'current', v_new);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_save_service_settings(p_variant_id uuid, p_settings jsonb, p_rev integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_save_service_settings(p_variant_id uuid, p_settings jsonb, p_rev integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_set_dates(p_service_id uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
  v_plan jsonb;
  v_start date;
  v_end date;
  v_items integer := 0;
  v_access integer := 0;
  it record;
BEGIN
  s := app_servicio.svc_get(p_service_id, true);
  PERFORM app_servicio.require_service(s, 'services.extend');
  v_plan := app_servicio.svc_dates_plan(jsonb_build_object(
    'status', s.status, 'oldStartsOn', s.starts_on, 'oldEndsOn', s.ends_on,
    'startsOn', p ->> 'starts_on', 'endsOn', p ->> 'ends_on', 'reason', p ->> 'reason'));
  IF NOT (v_plan ->> 'ok')::boolean THEN
    RAISE EXCEPTION '%', CASE v_plan ->> 'error'
      WHEN 'SV016' THEN 'Escribí el motivo'
      WHEN 'SV040' THEN 'La fecha de fin tiene que ser igual o posterior al inicio'
      WHEN 'SV041' THEN 'No cambiaste ninguna fecha'
      WHEN 'SV042' THEN 'Este servicio ya terminó: sus fechas no se cambian'
      ELSE 'Elegí la fecha de inicio' END USING ERRCODE = v_plan ->> 'error';
  END IF;
  v_start := (p ->> 'starts_on')::date;
  v_end := CASE WHEN COALESCE(p ->> 'ends_on', '') ~ '^\d{4}-\d{2}-\d{2}$' THEN (p ->> 'ends_on')::date END;

  UPDATE app_servicio.services SET starts_on = v_start, ends_on = v_end, updated_at = now() WHERE id = s.id;

  -- Los plazos de los pasos pendientes que cuentan desde el inicio del servicio (svc_compute_due lee el inicio nuevo).
  FOR it IN
    SELECT i.id FROM app_servicio.service_items i
     WHERE i.service_id = s.id AND i.status = 'pending' AND i.parent_item_id IS NULL AND NOT i.is_recurring_template
       AND i.due_rule ->> 'from' = 'service_start'
  LOOP
    PERFORM app_servicio.svc_compute_due(it.id);
    v_items := v_items + 1;
  END LOOP;

  -- Los accesos que duran «lo que dure el servicio» terminan con el fin nuevo (para adelante o para atras).
  IF v_end IS NOT NULL AND v_end IS DISTINCT FROM s.ends_on THEN
    UPDATE app_servicio_portal.portal_access
       SET ends_at = app_servicio.end_of_day(v_end, app_servicio.ws_tz(s.workspace_id)), updated_at = now()
     WHERE service_id = s.id AND revoked_at IS NULL AND until_type = 'service';
    GET DIAGNOSTICS v_access = ROW_COUNT;
  END IF;

  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.dates_changed',
    jsonb_build_object('old_start', s.starts_on, 'new_start', v_start, 'old_end', s.ends_on, 'new_end', v_end,
                       'duration_days', v_plan -> 'durationDays', 'reason', btrim(p ->> 'reason'),
                       'items_recalculated', v_items, 'accesses', v_access));
  PERFORM app_servicio.svc_compute_light(s.id);
  RETURN jsonb_build_object('starts_on', v_start, 'ends_on', v_end, 'items_recalculated', v_items, 'accesses', v_access);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_set_dates(p_service_id uuid, p jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_set_dates(p_service_id uuid, p jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_set_owner_core(p_service_id uuid, p_user_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = s.workspace_id AND m.user_id = p_user_id) THEN
    RAISE EXCEPTION 'El responsable no es del equipo' USING ERRCODE = 'SV015';
  END IF;
  IF s.owner_user_id IS NOT DISTINCT FROM p_user_id THEN RETURN; END IF;
  UPDATE app_servicio.services SET owner_user_id = p_user_id, flags = flags - 'owner_fallback' - 'owner_departed' WHERE id = s.id;
  -- Las tareas abiertas de los pasos "del responsable" pasan a la persona nueva.
  UPDATE public.tasks t SET owner_id = p_user_id
    FROM app_servicio.service_items i
   WHERE i.service_id = s.id AND i.task_id = t.id AND i.assignee = 'owner' AND t.status <> 'completed';
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.owner_changed',
    jsonb_build_object('old', s.owner_user_id, 'new', p_user_id, 'reason', p_reason));
  PERFORM app_servicio.notify(s.workspace_id, p_user_id, 'svc_owner_assigned', 'Tenés un servicio a cargo',
    COALESCE(s.product_snapshot ->> 'product_name', ''), 'service', s.id);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_set_owner_core(p_service_id uuid, p_user_id uuid, p_reason text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_set_owner_core(p_service_id uuid, p_user_id uuid, p_reason text) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_set_owner(p_service_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
BEGIN
  s := app_servicio.svc_get(p_service_id);
  PERFORM app_servicio.require_service(s, 'services.change_owner');
  PERFORM app_servicio.svc_set_owner_core(p_service_id, p_user_id, NULL);
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_set_owner(p_service_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_set_owner(p_service_id uuid, p_user_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_shift_access(p_service_id uuid, p_days integer, p_new_end date, p_extend_own boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s record;
  n integer := 0;
BEGIN
  SELECT id, workspace_id INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL THEN RETURN 0; END IF;
  IF p_new_end IS NOT NULL THEN
    UPDATE app_servicio_portal.portal_access
       SET ends_at = app_servicio.end_of_day(p_new_end, app_servicio.ws_tz(s.workspace_id)), updated_at = now()
     WHERE service_id = s.id AND revoked_at IS NULL
       AND (until_type = 'service' OR (p_extend_own AND source = 'manual_extra'))
       AND (ends_at IS NULL OR ends_at < app_servicio.end_of_day(p_new_end, app_servicio.ws_tz(s.workspace_id)));
    GET DIAGNOSTICS n = ROW_COUNT;
  ELSIF COALESCE(p_days, 0) > 0 THEN
    UPDATE app_servicio_portal.portal_access SET ends_at = ends_at + make_interval(days => p_days), updated_at = now()
     WHERE service_id = s.id AND revoked_at IS NULL AND ends_at IS NOT NULL AND (source <> 'manual_extra' OR p_extend_own);
    GET DIAGNOSTICS n = ROW_COUNT;
  END IF;
  RETURN n;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_shift_access(p_service_id uuid, p_days integer, p_new_end date, p_extend_own boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_shift_access(p_service_id uuid, p_days integer, p_new_end date, p_extend_own boolean) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_start_challenge(p_service_id uuid, p_actor text DEFAULT 'team'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
  ph app_servicio.service_phases;
BEGIN
  s := app_servicio.svc_get(p_service_id);
  IF p_actor = 'team' THEN PERFORM app_servicio.require_service(s, 'services.change_phase'); END IF;
  SELECT * INTO ph FROM app_servicio.service_phases WHERE service_id = p_service_id AND awaiting_start ORDER BY position LIMIT 1;
  IF ph.id IS NULL OR s.status <> 'active' THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM app_servicio.service_phases WHERE service_id = p_service_id AND status = 'in_progress') THEN RETURN false; END IF;
  PERFORM app_servicio.svc_open_phase(ph.id, true);
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_start_challenge(p_service_id uuid, p_actor text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_start_challenge(p_service_id uuid, p_actor text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_suspend_for_pause(p_service_id uuid, p_suspend boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_suspend THEN
    UPDATE app_servicio_portal.portal_access SET suspended_pause_at = now(), updated_at = now()
     WHERE service_id = p_service_id AND revoked_at IS NULL AND suspended_pause_at IS NULL;
  ELSE
    UPDATE app_servicio_portal.portal_access SET suspended_pause_at = NULL, updated_at = now()
     WHERE service_id = p_service_id AND suspended_pause_at IS NOT NULL;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_suspend_for_pause(p_service_id uuid, p_suspend boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_suspend_for_pause(p_service_id uuid, p_suspend boolean) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_try_advance_phase(p_service_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
  ph app_servicio.service_phases;
  v_next uuid;
  rt integer; rd integer; at integer; ad integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('svc_advance:' || p_service_id::text, 0));
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.status <> 'active' THEN RETURN false; END IF;
  SELECT * INTO ph FROM app_servicio.service_phases WHERE service_id = p_service_id AND status = 'in_progress';
  IF ph.id IS NULL THEN RETURN false; END IF;
  SELECT count(*) FILTER (WHERE required), count(*) FILTER (WHERE required AND status = 'completed'),
         count(*), count(*) FILTER (WHERE status = 'completed')
    INTO rt, rd, at, ad
    FROM app_servicio.service_items WHERE phase_id = ph.id AND NOT is_recurring_template;
  IF NOT app_servicio.svc_phase_should_advance(ph.advance, rt, rd, at, ad) THEN RETURN false; END IF;
  UPDATE app_servicio.service_phases SET status = 'completed', completed_at = now(), completed_via = 'auto' WHERE id = ph.id;
  PERFORM app_servicio.audit(s.workspace_id, 'service_phase', ph.id, 'svc.phase_completed', jsonb_build_object('service_id', s.id, 'phase_key', ph.template_key));
  PERFORM app_servicio.emit(s, 'service_phase_completed', jsonb_build_object('phase_key', ph.template_key));
  IF ph.challenge IS NOT NULL AND COALESCE((ph.challenge ->> 'enabled')::boolean, false) THEN
    PERFORM app_servicio.emit(s, 'challenge_completed', jsonb_build_object('phase_key', ph.template_key));
  END IF;
  SELECT id INTO v_next FROM app_servicio.service_phases WHERE service_id = p_service_id AND status = 'pending' AND position > ph.position ORDER BY position LIMIT 1;
  IF v_next IS NULL THEN
    PERFORM app_servicio.svc_finish(p_service_id, 'Completó el camino');
  ELSE
    PERFORM app_servicio.svc_open_phase(v_next);
  END IF;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_try_advance_phase(p_service_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_try_advance_phase(p_service_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_uncomplete_item(p_item_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  it app_servicio.service_items;
  s app_servicio.services;
  ph app_servicio.service_phases;
BEGIN
  SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id FOR UPDATE;
  IF it.id IS NULL THEN RAISE EXCEPTION 'No existe el paso' USING ERRCODE = 'SV002'; END IF;
  s := app_servicio.svc_get(it.service_id);
  PERFORM app_servicio.svc_require_item(s, it);
  SELECT * INTO ph FROM app_servicio.service_phases WHERE id = it.phase_id;
  IF ph.status = 'completed' THEN
    RAISE EXCEPTION 'Un paso de una fase cerrada no se destilda' USING ERRCODE = 'SV020';
  END IF;
  IF it.status <> 'completed' THEN RETURN false; END IF;
  UPDATE app_servicio.service_items SET status = 'pending', completed_at = NULL, completed_by_kind = NULL, completed_by = NULL, completed_source = NULL
   WHERE id = it.id;
  IF it.task_id IS NOT NULL THEN
    UPDATE public.tasks SET status = 'pending', completed_at = NULL WHERE id = it.task_id AND status = 'completed';
  END IF;
  PERFORM app_servicio.audit(s.workspace_id, 'service_item', it.id, 'svc.item_uncompleted', jsonb_build_object('service_id', s.id, 'item_key', it.template_key));
  PERFORM app_servicio.svc_compute_light(s.id);
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_uncomplete_item(p_item_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_uncomplete_item(p_item_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_unmark_item(p_item_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  it app_servicio.service_items;
  ph app_servicio.service_phases;
BEGIN
  SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id FOR UPDATE;
  IF it.id IS NULL OR it.status <> 'completed' THEN RETURN false; END IF;
  SELECT * INTO ph FROM app_servicio.service_phases WHERE id = it.phase_id;
  IF ph.status = 'completed' THEN RETURN false; END IF;
  UPDATE app_servicio.service_items SET status = 'pending', completed_at = NULL, completed_by_kind = NULL, completed_by = NULL, completed_source = NULL
   WHERE id = it.id;
  PERFORM app_servicio.audit(it.workspace_id, 'service_item', it.id, 'svc.item_uncompleted', jsonb_build_object('service_id', it.service_id, 'source', 'task'), 'system');
  PERFORM app_servicio.svc_compute_light(it.service_id);
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.svc_unmark_item(p_item_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.svc_unmark_item(p_item_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.sync_product_portal_enabled()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_product uuid := COALESCE(NEW.product_id, OLD.product_id);
  v_on boolean;
BEGIN
  BEGIN
    SELECT EXISTS (
      SELECT 1 FROM public.product_variants pv
      WHERE pv.product_id = v_product AND pv.archived_at IS NULL AND pv.portal_settings -> 'enabled' = 'true'::jsonb
    ) INTO v_on;
    UPDATE public.products SET portal_enabled = v_on WHERE id = v_product AND portal_enabled IS DISTINCT FROM v_on;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_servicio.sync_product_portal_enabled: %', SQLERRM;
  END;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.sync_product_portal_enabled() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.task_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_item uuid;
  v_prev_system text := COALESCE(current_setting('app_servicio.system', true), '');
BEGIN
  IF NEW.source <> 'cx' OR NEW.source_ref IS NULL OR NEW.source_ref NOT LIKE 'svc\_item:%' THEN RETURN NULL; END IF;
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    PERFORM app_servicio.as_system();
    SELECT i.id INTO v_item FROM app_servicio.service_items i
     WHERE i.id = substr(NEW.source_ref, 10)::uuid AND i.workspace_id = NEW.workspace_id AND i.task_id = NEW.id;
    IF v_item IS NOT NULL THEN
      IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
        PERFORM app_servicio.svc_mark_item(v_item, 'task', 'user', NULL);
      ELSIF OLD.status = 'completed' AND NEW.status <> 'completed' THEN
        PERFORM app_servicio.svc_unmark_item(v_item);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'task', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  PERFORM set_config('app_servicio.system', v_prev_system, true);
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.task_hook() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.tutor_add_document(p_product_id uuid, p_knowledge_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws uuid;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'No existe el programa' USING ERRCODE = 'SV002'; END IF;
  PERFORM app_servicio.require_permission(v_ws, 'tutor.knowledge');
  UPDATE public.knowledge_base SET tags = array_append(tags, 'programa:' || p_product_id::text), updated_at = now()
   WHERE id = p_knowledge_id AND workspace_id = v_ws AND deleted_at IS NULL AND NOT internal_only AND program_item_id IS NULL
     AND NOT (tags @> ARRAY['programa:' || p_product_id::text]);
  IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM public.knowledge_base WHERE id = p_knowledge_id AND workspace_id = v_ws AND tags @> ARRAY['programa:' || p_product_id::text]) THEN
    RAISE EXCEPTION 'Ese documento no se puede sumar (es interno o no existe)' USING ERRCODE = 'IA001';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.tutor_add_document(p_product_id uuid, p_knowledge_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.tutor_add_document(p_product_id uuid, p_knowledge_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.tutor_agent_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.type = 'student_tutor' THEN
    RAISE EXCEPTION 'El tutor de un programa se crea al prender el Asistente IA del programa' USING ERRCODE = 'SV003';
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.type = 'student_tutor' OR NEW.type = 'student_tutor')
     AND (NEW.type IS DISTINCT FROM OLD.type OR (NEW.config ->> 'program_id') IS DISTINCT FROM (OLD.config ->> 'program_id')) THEN
    RAISE EXCEPTION 'El programa de un tutor no se cambia' USING ERRCODE = 'SV003';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.tutor_agent_guard() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.tutor_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.tutor_agent_id := NULL;
  ELSIF NEW.tutor_agent_id IS DISTINCT FROM OLD.tutor_agent_id THEN
    RAISE EXCEPTION 'El tutor del programa se cambia desde sus pantallas' USING ERRCODE = 'SV003';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.tutor_guard() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.tutor_knowledge_ids(p_contact_id uuid, p_product_id uuid)
 RETURNS TABLE(knowledge_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH pr AS (
    SELECT id, workspace_id, COALESCE(portal_settings #> '{assistant,excluded_kb_ids}', '[]'::jsonb) AS excluded FROM public.products WHERE id = p_product_id
  )
  SELECT k.id
    FROM pr JOIN public.knowledge_base k ON k.workspace_id = pr.workspace_id
    LEFT JOIN app_servicio.program_items i ON i.id = k.program_item_id
   WHERE k.deleted_at IS NULL AND NOT k.internal_only AND k.tags @> ARRAY['programa:' || pr.id::text]
     AND NOT (pr.excluded ? k.id::text)
     AND (k.program_item_id IS NULL OR (
           i.product_id = pr.id AND i.status = 'active' AND COALESCE(i.lesson_type, '') <> 'quiz'
           AND (p_contact_id IS NULL OR COALESCE((app_servicio.program_item_unlocked(p_contact_id, i.id) ->> 'unlocked')::boolean, false))));
$function$;
REVOKE ALL ON FUNCTION app_servicio.tutor_knowledge_ids(p_contact_id uuid, p_product_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.tutor_knowledge_ids(p_contact_id uuid, p_product_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.tutor_knowledge_list(p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws uuid;
  v_excluded jsonb;
BEGIN
  SELECT workspace_id, COALESCE(portal_settings #> '{assistant,excluded_kb_ids}', '[]'::jsonb) INTO v_ws, v_excluded FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RETURN NULL; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.is_workspace_member(v_ws) AND (public.has_permission(v_ws, 'tutor.knowledge') OR public.has_permission(v_ws, 'tutor.manage'))) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  RETURN jsonb_build_object(
    'lessons', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'item_id', i.id, 'title', i.title, 'lesson_type', i.lesson_type, 'status', i.status, 'thumbnail_url', i.thumbnail_url,
        'knowledge_id', k.id, 'knowledge_status', k.status, 'excluded', k.id IS NOT NULL AND v_excluded ? k.id::text) ORDER BY i.position, i.created_at)
      FROM app_servicio.program_items i
      LEFT JOIN LATERAL (SELECT kb.id, kb.status FROM public.knowledge_base kb WHERE kb.program_item_id = i.id AND kb.deleted_at IS NULL ORDER BY kb.created_at DESC LIMIT 1) k ON true
     WHERE i.product_id = p_product_id AND i.kind = 'lesson' AND i.status <> 'archived' AND COALESCE(i.lesson_type, '') <> 'quiz'), '[]'::jsonb),
    'documents', COALESCE((SELECT jsonb_agg(jsonb_build_object('knowledge_id', k.id, 'title', k.title, 'status', k.status, 'excluded', v_excluded ? k.id::text,
        'filename', k.source_filename) ORDER BY k.created_at DESC)
      FROM public.knowledge_base k WHERE k.workspace_id = v_ws AND k.deleted_at IS NULL AND k.program_item_id IS NULL AND NOT k.internal_only
        AND k.tags @> ARRAY['programa:' || p_product_id::text]), '[]'::jsonb));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.tutor_knowledge_list(p_product_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.tutor_knowledge_list(p_product_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.tutor_set_excluded(p_product_id uuid, p_knowledge_id uuid, p_excluded boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  pr record;
  v_list jsonb;
BEGIN
  SELECT id, workspace_id, portal_settings INTO pr FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF pr.id IS NULL THEN RAISE EXCEPTION 'No existe el programa' USING ERRCODE = 'SV002'; END IF;
  PERFORM app_servicio.require_permission(pr.workspace_id, 'tutor.knowledge');
  IF NOT EXISTS (SELECT 1 FROM public.knowledge_base k WHERE k.id = p_knowledge_id AND k.workspace_id = pr.workspace_id) THEN
    RAISE EXCEPTION 'No existe ese material' USING ERRCODE = 'SV002';
  END IF;
  v_list := COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(COALESCE(pr.portal_settings #> '{assistant,excluded_kb_ids}', '[]'::jsonb)) x
                       WHERE x #>> '{}' <> p_knowledge_id::text), '[]'::jsonb);
  IF p_excluded THEN v_list := v_list || to_jsonb(p_knowledge_id::text); END IF;
  UPDATE public.products
     SET portal_settings = jsonb_set(COALESCE(portal_settings, '{}'::jsonb), '{assistant}', COALESCE(portal_settings -> 'assistant', '{}'::jsonb) || jsonb_build_object('excluded_kb_ids', v_list)),
         portal_settings_rev = portal_settings_rev + 1
   WHERE id = pr.id;
  PERFORM app_servicio.audit(pr.workspace_id, 'product', pr.id, CASE WHEN p_excluded THEN 'tutor.material_excluded' ELSE 'tutor.material_included' END,
    jsonb_build_object('knowledge_id', p_knowledge_id));
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.tutor_set_excluded(p_product_id uuid, p_knowledge_id uuid, p_excluded boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.tutor_set_excluded(p_product_id uuid, p_knowledge_id uuid, p_excluded boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.unknown_keys(p jsonb, p_allowed text[])
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT COALESCE(array_agg('clave desconocida: ' || k ORDER BY ord), ARRAY[]::text[])
  FROM jsonb_object_keys(p) WITH ORDINALITY AS t(k, ord)
  WHERE NOT (k = ANY (p_allowed));
$function$;
REVOKE ALL ON FUNCTION app_servicio.unknown_keys(p jsonb, p_allowed text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.unknown_keys(p jsonb, p_allowed text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.validate_journey_template(p jsonb, p_variant_id uuid DEFAULT NULL::uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v text[] := ARRAY[]::text[];
  v_ws uuid; v_product uuid;
  ph jsonb; it jsonb; due jsonb; lt jsonb; ch jsonb; ll jsonb;
  v_phase_keys text[] := ARRAY[]::text[];
  v_item_keys text[] := ARRAY[]::text[];
  v_before text[] := ARRAY[]::text[];
  v_name text; v_label text; v_nm text; v_key text;
  y numeric; r numeric; d numeric;
  v_has_rule boolean;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN ARRAY['el camino tiene que ser un objeto']; END IF;
  IF p_variant_id IS NOT NULL THEN
    SELECT pv.workspace_id, pv.product_id INTO v_ws, v_product FROM public.product_variants pv WHERE pv.id = p_variant_id;
  END IF;
  v := v || app_servicio.unknown_keys(p, ARRAY['v','future_visibility','phases']);
  IF p -> 'v' IS DISTINCT FROM '1'::jsonb THEN v := v || 'versión desconocida'::text; END IF;
  IF p ? 'future_visibility' AND NOT COALESCE(p ->> 'future_visibility' = ANY (ARRAY['names','names_and_descriptions','hidden']), false) THEN
    v := v || 'elegí qué ve el cliente de las fases que vienen'::text;
  END IF;
  IF jsonb_typeof(p -> 'phases') IS DISTINCT FROM 'array' THEN RETURN v || 'faltan las fases'::text; END IF;

  FOR ph IN SELECT x FROM jsonb_array_elements(p -> 'phases') x LOOP
    IF jsonb_typeof(ph) <> 'object' THEN v := v || 'hay una fase que no es válida'::text; CONTINUE; END IF;
    v := v || app_servicio.unknown_keys(ph, ARRAY['key','name','duration_days','yellow_day','red_day','advance','challenge','late_light','items']);
    v_key := CASE WHEN jsonb_typeof(ph -> 'key') = 'string' THEN ph ->> 'key' END;
    IF v_key IS NULL OR v_key !~ '^ph_[a-z0-9]{6}$' THEN v := v || 'hay una fase con una clave inválida'::text;
    ELSIF v_key = ANY (v_phase_keys) THEN v := v || format('la clave %s está repetida', v_key);
    ELSE v_phase_keys := v_phase_keys || v_key;
    END IF;
    v_name := CASE WHEN jsonb_typeof(ph -> 'name') = 'string' THEN btrim(ph ->> 'name') ELSE '' END;
    IF v_name = '' THEN v := v || 'hay una fase sin nombre'::text; END IF;
    v_label := CASE WHEN v_name = '' THEN 'la fase' ELSE v_name END;
    IF NOT (ph -> 'duration_days' IS NULL OR jsonb_typeof(ph -> 'duration_days') = 'null'
            OR (app_servicio.j_int(ph -> 'duration_days') AND app_servicio.j_num(ph -> 'duration_days') >= 0))
       OR app_servicio.j_num(ph -> 'duration_days') = 0 THEN
      v := v || format('«%s»: la duración tiene que ser mayor a cero', v_label);
    END IF;
    IF NOT (ph -> 'yellow_day' IS NULL OR jsonb_typeof(ph -> 'yellow_day') = 'null' OR (app_servicio.j_int(ph -> 'yellow_day') AND app_servicio.j_num(ph -> 'yellow_day') >= 0))
       OR NOT (ph -> 'red_day' IS NULL OR jsonb_typeof(ph -> 'red_day') = 'null' OR (app_servicio.j_int(ph -> 'red_day') AND app_servicio.j_num(ph -> 'red_day') >= 0)) THEN
      v := v || format('«%s»: los días de amarillo y rojo tienen que ser enteros', v_label);
    ELSE
      y := CASE WHEN app_servicio.j_int(ph -> 'yellow_day') THEN app_servicio.j_num(ph -> 'yellow_day') END;
      r := CASE WHEN app_servicio.j_int(ph -> 'red_day') THEN app_servicio.j_num(ph -> 'red_day') END;
      d := CASE WHEN app_servicio.j_int(ph -> 'duration_days') THEN app_servicio.j_num(ph -> 'duration_days') END;
      IF y IS NOT NULL AND r IS NOT NULL AND y >= r THEN v := v || format('«%s»: el amarillo tiene que ser antes que el rojo', v_label); END IF;
      IF r IS NOT NULL AND d IS NOT NULL AND r > d THEN v := v || format('«%s»: el rojo no puede pasar la duración de la fase', v_label); END IF;
    END IF;
    IF ph ? 'advance' AND NOT COALESCE(ph ->> 'advance' = ANY (ARRAY['auto','auto_all','manual']), false) THEN v := v || format('«%s»: elegí cómo avanza', v_label); END IF;
    ch := ph -> 'challenge';
    IF ch IS NOT NULL AND jsonb_typeof(ch) <> 'null' THEN
      IF jsonb_typeof(ch) <> 'object' THEN v := v || format('«%s»: el Reto no es válido', v_label);
      ELSIF ch -> 'enabled' = 'true'::jsonb THEN
        IF NOT COALESCE(ch ->> 'start' = ANY (ARRAY['previous_phase','student','automation','fixed_date']), false) THEN v := v || format('«%s»: elegí cómo empieza el Reto', v_label); END IF;
        IF ch ->> 'start' = 'fixed_date' AND NOT app_servicio.j_date(ch -> 'fixed_date') THEN v := v || format('«%s»: elegí la fecha del Reto', v_label); END IF;
      END IF;
    END IF;
    ll := ph -> 'late_light';
    IF ll IS NOT NULL AND jsonb_typeof(ll) <> 'null' THEN
      IF jsonb_typeof(ll) <> 'object' THEN v := v || format('«%s»: el semáforo por entregas no es válido', v_label);
      ELSIF ll -> 'enabled' = 'true'::jsonb AND NOT (
        app_servicio.j_int(ll -> 'yellow_at') AND app_servicio.j_num(ll -> 'yellow_at') >= 1
        AND app_servicio.j_int(ll -> 'red_at') AND app_servicio.j_num(ll -> 'red_at') >= app_servicio.j_num(ll -> 'yellow_at')) THEN
        v := v || format('«%s»: el rojo por entregas tiene que ser igual o mayor que el amarillo', v_label);
      END IF;
    END IF;
    IF jsonb_typeof(ph -> 'items') IS DISTINCT FROM 'array' THEN v := v || format('«%s»: faltan los pasos', v_label); CONTINUE; END IF;

    FOR it IN SELECT x FROM jsonb_array_elements(ph -> 'items') x LOOP
      IF jsonb_typeof(it) <> 'object' THEN v := v || format('«%s»: hay un paso que no es válido', v_label); CONTINUE; END IF;
      v_nm := CASE WHEN jsonb_typeof(it -> 'name') = 'string' THEN it ->> 'name' ELSE 'el paso' END;
      v := v || app_servicio.unknown_keys(it, ARRAY['key','kind','name','description','required','assignee','assignee_user_id','visible_to_client',
        'portal_button','ref','due_rule','light','recurrence','late','reminders']);
      v_key := CASE WHEN jsonb_typeof(it -> 'key') = 'string' THEN it ->> 'key' END;
      IF v_key IS NULL OR v_key !~ '^it_[a-z0-9]{6}$' THEN v := v || 'hay un paso con una clave inválida'::text;
      ELSIF v_key = ANY (v_item_keys) THEN v := v || format('la clave %s está repetida', v_key);
      ELSE v_item_keys := v_item_keys || v_key;
      END IF;
      IF NOT COALESCE(it ->> 'kind' = ANY (ARRAY['form','survey','contract','booking','quiz','activity','program_item','team_task','student_task',
          'certificate','open_section','open_module','checkbox']), false) THEN
        v := v || format('«%s»: tipo de paso desconocido', v_nm);
        CONTINUE;
      END IF;
      IF NOT (jsonb_typeof(it -> 'name') = 'string' AND btrim(it ->> 'name') <> '') THEN v := v || 'hay un paso sin nombre'::text; END IF;
      IF it ? 'assignee' AND NOT COALESCE(it ->> 'assignee' = ANY (ARRAY['student','owner','user']), false) THEN v := v || format('«%s»: elegí a cargo de quién está', v_nm); END IF;
      IF it ->> 'assignee' = 'user' AND NOT app_servicio.j_uuid(it -> 'assignee_user_id') THEN v := v || format('«%s»: elegí la persona a cargo', v_nm); END IF;
      v := v || app_servicio.journey_item_ref_problems(it, v_nm, v_ws, v_product);

      due := it -> 'due_rule';
      IF due IS NOT NULL AND jsonb_typeof(due) <> 'null' THEN
        IF jsonb_typeof(due) <> 'object' OR NOT COALESCE(due ->> 'from' = ANY (ARRAY['service_created','service_start','phase_start','item_completed']), false)
           OR NOT (app_servicio.j_int(due -> 'days') AND app_servicio.j_num(due -> 'days') BETWEEN 0 AND 3650) THEN
          v := v || format('«%s»: el plazo no es válido', v_nm);
        ELSIF due ->> 'from' = 'item_completed' THEN
          IF jsonb_typeof(due -> 'item_key') IS DISTINCT FROM 'string' OR NOT ((due ->> 'item_key') = ANY (v_before)) THEN
            v := v || 'un paso solo puede depender de uno anterior'::text;
          END IF;
        END IF;
      END IF;
      v := v || app_servicio.journey_recurrence_problems(it, v_nm);
      lt := it -> 'light';
      IF lt IS NOT NULL AND jsonb_typeof(lt) <> 'null' THEN
        IF jsonb_typeof(lt) <> 'object'
           OR NOT (lt -> 'yellow_after_days' IS NULL OR jsonb_typeof(lt -> 'yellow_after_days') = 'null' OR (app_servicio.j_int(lt -> 'yellow_after_days') AND app_servicio.j_num(lt -> 'yellow_after_days') >= 0))
           OR NOT (lt -> 'red_after_days' IS NULL OR jsonb_typeof(lt -> 'red_after_days') = 'null' OR (app_servicio.j_int(lt -> 'red_after_days') AND app_servicio.j_num(lt -> 'red_after_days') >= 0)) THEN
          v := v || format('«%s»: el semáforo del paso tiene que ser un número de días', v_nm);
        ELSE
          v_has_rule := (due IS NOT NULL AND jsonb_typeof(due) <> 'null') OR (it -> 'recurrence' IS NOT NULL AND jsonb_typeof(it -> 'recurrence') <> 'null');
          IF NOT v_has_rule THEN v := v || format('«%s»: el semáforo del paso necesita un plazo o que se repita', v_nm); END IF;
          IF app_servicio.j_int(lt -> 'yellow_after_days') AND app_servicio.j_int(lt -> 'red_after_days')
             AND app_servicio.j_num(lt -> 'red_after_days') < app_servicio.j_num(lt -> 'yellow_after_days') THEN
            v := v || format('«%s»: el rojo tiene que ser igual o mayor que el amarillo', v_nm);
          END IF;
        END IF;
      END IF;
      IF v_key IS NOT NULL THEN v_before := v_before || v_key; END IF;
    END LOOP;
  END LOOP;
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.validate_journey_template(p jsonb, p_variant_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.validate_journey_template(p jsonb, p_variant_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.validate_program_portal_settings(p jsonb, p_product_id uuid DEFAULT NULL::uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v text[] := ARRAY[]::text[];
  k text; t jsonb; c jsonb; sp jsonb; a jsonb;
  v_keys text[] := ARRAY[]::text[];
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN ARRAY['la configuración tiene que ser un objeto']; END IF;
  v := v || app_servicio.unknown_keys(p, ARRAY['v','sections','terms','community','affiliates','assistant']);
  IF p ? 'v' AND p -> 'v' <> '1'::jsonb THEN v := v || 'versión desconocida'::text; END IF;
  IF p ? 'sections' THEN
    IF jsonb_typeof(p -> 'sections') <> 'object' THEN v := v || 'las secciones no son válidas'::text;
    ELSE
      FOR k IN SELECT key FROM jsonb_object_keys(p -> 'sections') WITH ORDINALITY AS t(key, ord) ORDER BY ord LOOP
        IF NOT COALESCE(k = ANY (ARRAY['program','calendar','challenge','certificate','assistant','community','affiliates','fame','projects']), false) THEN v := v || ('sección desconocida: ' || k);
        ELSIF NOT COALESCE(k = ANY (ARRAY['program','calendar','challenge','certificate','assistant','community','affiliates']), false) THEN v := v || 'Todavía no está disponible'::text;
        ELSIF jsonb_typeof(p -> 'sections' -> k) <> 'boolean' THEN v := v || (k || ': tiene que ser sí o no');
        END IF;
      END LOOP;
    END IF;
  END IF;
  IF p ? 'terms' THEN
    t := p -> 'terms';
    IF jsonb_typeof(t) <> 'object' THEN v := v || 'los términos no son válidos'::text;
    ELSE
      v := v || app_servicio.unknown_keys(t, ARRAY['enabled','form_id','ask_again_on_change']);
      IF t -> 'enabled' = 'true'::jsonb AND NOT app_servicio.j_uuid(t -> 'form_id') THEN v := v || 'cargá los términos antes de prenderlos'::text; END IF;
    END IF;
  END IF;
  IF p ? 'community' THEN
    c := p -> 'community';
    IF jsonb_typeof(c) <> 'object' THEN v := v || 'la comunidad no es válida'::text;
    ELSE
      v := v || app_servicio.unknown_keys(c, ARRAY['lesson_comments','spaces']);
      IF c ? 'spaces' THEN
        IF jsonb_typeof(c -> 'spaces') <> 'array' THEN v := v || 'los espacios no son válidos'::text;
        ELSE
          FOR sp IN SELECT x FROM jsonb_array_elements(c -> 'spaces') x LOOP
            IF jsonb_typeof(sp) <> 'object' OR jsonb_typeof(sp -> 'key') IS DISTINCT FROM 'string' OR (sp ->> 'key') !~ '^[a-z0-9_]{1,40}$'
               OR jsonb_typeof(sp -> 'name') IS DISTINCT FROM 'string' OR btrim(sp ->> 'name') = '' THEN
              v := v || 'hay un espacio sin nombre o con una clave inválida'::text;
              CONTINUE;
            END IF;
            IF (sp ->> 'key') = ANY (v_keys) THEN v := v || format('el espacio %s está repetido', sp ->> 'key'); END IF;
            v_keys := v_keys || (sp ->> 'key');
          END LOOP;
        END IF;
      END IF;
    END IF;
  END IF;
  IF p ? 'affiliates' THEN
    a := p -> 'affiliates';
    IF jsonb_typeof(a) <> 'object' OR (a ? 'visible_link_keys' AND NOT (jsonb_typeof(a -> 'visible_link_keys') = 'array'
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(a -> 'visible_link_keys') x WHERE jsonb_typeof(x) <> 'string' OR (x #>> '{}') !~ '^lk_[a-z0-9]{6}$'))) THEN
      v := v || 'los links de afiliados no son válidos'::text;
    END IF;
  END IF;
  IF p ? 'assistant' THEN
    a := p -> 'assistant';
    IF jsonb_typeof(a) <> 'object' THEN v := v || 'el asistente no es válido'::text;
    ELSE
      v := v || app_servicio.unknown_keys(a, ARRAY['excluded_kb_ids','monthly_limit_usd_per_student','credits_per_usd','credits_name','suggestions']);
      IF a ? 'monthly_limit_usd_per_student' AND NOT (jsonb_typeof(a -> 'monthly_limit_usd_per_student') = 'number'
         AND app_servicio.j_num(a -> 'monthly_limit_usd_per_student') BETWEEN 0 AND 10000) THEN
        v := v || 'el límite por estudiante va de 0 a 10.000 dólares'::text;
      END IF;
      IF a ? 'credits_per_usd' AND NOT (app_servicio.j_int(a -> 'credits_per_usd') AND app_servicio.j_num(a -> 'credits_per_usd') BETWEEN 1 AND 100000) THEN
        v := v || 'los créditos por dólar tienen que ser un número entero positivo'::text;
      END IF;
    END IF;
  END IF;
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.validate_program_portal_settings(p jsonb, p_product_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.validate_program_portal_settings(p jsonb, p_product_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.validate_service_settings(p jsonb, p_variant_id uuid DEFAULT NULL::uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v text[] := ARRAY[]::text[];
  v_mode text;
  v_allowed text[];
  v_when jsonb; v_owner jsonb; v_ext jsonb; v_x jsonb;
  v_product uuid; v_ws uuid;
  v_fb_product uuid; v_fb_mode text;
  v_n numeric;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RETURN ARRAY['la configuración tiene que ser un objeto'];
  END IF;
  IF p ? 'v' AND p -> 'v' <> '1'::jsonb THEN v := v || 'versión desconocida'::text; END IF;
  IF p ? 'mode' AND NOT COALESCE(p ->> 'mode' = ANY (ARRAY['create','extend','none']), false) THEN
    RETURN v || 'modo desconocido'::text;
  END IF;
  v_mode := COALESCE(p ->> 'mode', 'none');
  v_allowed := CASE v_mode
    WHEN 'none' THEN ARRAY['v','mode']
    WHEN 'create' THEN ARRAY['v','mode','when','confirm','start','owner','renewal','light','overdue_cut']
    ELSE ARRAY['v','mode','when','extend','light','overdue_cut'] END;
  v := v || app_servicio.unknown_keys(p, v_allowed);
  IF v_mode = 'none' THEN RETURN v; END IF;

  IF p_variant_id IS NOT NULL THEN
    SELECT pv.product_id, pv.workspace_id INTO v_product, v_ws FROM public.product_variants pv WHERE pv.id = p_variant_id;
  END IF;

  v_when := p -> 'when';
  IF v_when IS NULL OR jsonb_typeof(v_when) <> 'object' OR NOT COALESCE(v_when ->> 'rule' = ANY (ARRAY['any_payment','non_reservation','percent','amount']), false) THEN
    v := v || 'elegí cuándo se crea'::text;
  ELSIF v_when ->> 'rule' = 'percent' AND NOT (app_servicio.j_int(v_when -> 'value') AND app_servicio.j_num(v_when -> 'value') BETWEEN 1 AND 100) THEN
    v := v || 'el porcentaje va de 1 a 100'::text;
  ELSIF v_when ->> 'rule' = 'amount' AND NOT (app_servicio.j_int(v_when -> 'value') AND app_servicio.j_num(v_when -> 'value') >= 1) THEN
    v := v || 'el monto tiene que ser mayor a cero'::text;
  END IF;

  IF p ? 'light' THEN
    v_x := p -> 'light';
    IF jsonb_typeof(v_x) <> 'object' OR (v_x ? 'overdue_red_days' AND NOT (app_servicio.j_int(v_x -> 'overdue_red_days') AND app_servicio.j_num(v_x -> 'overdue_red_days') BETWEEN 1 AND 365)) THEN
      v := v || 'los días para rojo por pagos van de 1 a 365'::text;
    END IF;
  END IF;
  IF p ? 'overdue_cut' THEN
    v_x := p -> 'overdue_cut';
    IF jsonb_typeof(v_x) <> 'object' OR (v_x ? 'days' AND NOT (app_servicio.j_int(v_x -> 'days') AND app_servicio.j_num(v_x -> 'days') BETWEEN 1 AND 365)) THEN
      v := v || 'los días de mora van de 1 a 365'::text;
    END IF;
  END IF;

  IF v_mode = 'create' THEN
    IF p ? 'confirm' AND jsonb_typeof(p -> 'confirm') <> 'boolean' THEN v := v || '«Pedir confirmación» tiene que ser sí o no'::text; END IF;
    IF p ? 'start' AND NOT COALESCE(p ->> 'start' = ANY (ARRAY['payment_date','sale_date','manual']), false) THEN v := v || 'elegí la fecha de inicio'::text; END IF;
    IF p ? 'renewal' AND NOT COALESCE(p ->> 'renewal' = ANY (ARRAY['new_linked','extend','ask']), false) THEN v := v || 'elegí qué pasa si vuelve a comprar'::text; END IF;
    v_owner := p -> 'owner';
    IF v_owner IS NULL OR jsonb_typeof(v_owner) <> 'object' OR NOT COALESCE(v_owner ->> 'mode' = ANY (ARRAY['fixed','round_robin','conditions','previous']), false) THEN
      v := v || 'elegí cómo se asigna el responsable'::text;
    ELSE
      IF v_owner ->> 'mode' = 'fixed' AND NOT app_servicio.j_uuid(v_owner -> 'user_id') THEN v := v || 'elegí la persona'::text; END IF;
      IF v_owner ->> 'mode' = 'round_robin' AND NOT (jsonb_typeof(v_owner -> 'members') = 'array' AND jsonb_array_length(v_owner -> 'members') > 0) THEN
        v := v || 'elegí las personas del reparto'::text;
      END IF;
      IF v_owner ->> 'mode' = 'conditions' AND NOT (jsonb_typeof(v_owner -> 'conditions') = 'array' AND jsonb_array_length(v_owner -> 'conditions') > 0) THEN
        v := v || 'agregá al menos una condición'::text;
      END IF;
      IF NOT app_servicio.j_uuid(v_owner -> 'fallback_user_id') THEN v := v || 'elegí la persona de respaldo'::text; END IF;
      IF v_ws IS NOT NULL AND EXISTS (
        SELECT 1 FROM (
          SELECT x #>> '{}' AS uid FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_owner -> 'members') = 'array' THEN v_owner -> 'members' ELSE '[]'::jsonb END) x
          UNION ALL SELECT v_owner ->> 'user_id' WHERE jsonb_typeof(v_owner -> 'user_id') = 'string'
          UNION ALL SELECT v_owner ->> 'fallback_user_id' WHERE jsonb_typeof(v_owner -> 'fallback_user_id') = 'string'
        ) people
        WHERE NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = v_ws AND m.user_id::text = people.uid)
      ) THEN
        v := v || 'hay una persona que no es del equipo'::text;
      END IF;
    END IF;
  END IF;

  IF v_mode = 'extend' THEN
    v_ext := p -> 'extend';
    IF v_ext IS NULL OR jsonb_typeof(v_ext) <> 'object' THEN
      v := v || 'elegí cuánto suma'::text;
      v := v || 'elegí la variante de respaldo'::text;
    ELSE
      IF NOT (app_servicio.j_int(v_ext -> 'n') AND app_servicio.j_num(v_ext -> 'n') BETWEEN 1 AND 1000) THEN v := v || 'elegí cuánto suma'::text; END IF;
      IF v_ext ? 'unit' AND NOT COALESCE(v_ext ->> 'unit' = ANY (ARRAY['days','weeks','months']), false) THEN v := v || 'elegí días, semanas o meses'::text; END IF;
      IF v_ext ? 'if_no_service' AND NOT COALESCE(v_ext ->> 'if_no_service' = ANY (ARRAY['confirm','create']), false) THEN
        v := v || 'elegí qué pasa si no tiene un servicio para extender'::text;
      END IF;
      IF v_ext ? 'target_variant_ids' AND jsonb_typeof(v_ext -> 'target_variant_ids') <> 'null'
         AND NOT (jsonb_typeof(v_ext -> 'target_variant_ids') = 'array'
                  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ext -> 'target_variant_ids') x WHERE NOT app_servicio.j_uuid(x))) THEN
        v := v || 'las variantes a extender no son válidas'::text;
      END IF;
      IF NOT app_servicio.j_uuid(v_ext -> 'fallback_variant_id') THEN
        v := v || 'elegí la variante de respaldo'::text;
      ELSIF v_product IS NOT NULL THEN
        SELECT pv.product_id, COALESCE(pv.service_settings ->> 'mode', 'none') INTO v_fb_product, v_fb_mode
          FROM public.product_variants pv WHERE pv.id = (v_ext ->> 'fallback_variant_id')::uuid;
        IF v_fb_product IS DISTINCT FROM v_product THEN v := v || 'la variante de respaldo tiene que ser de este producto'::text;
        ELSIF v_fb_mode <> 'create' THEN v := v || 'la variante de respaldo tiene que crear un servicio'::text;
        END IF;
      END IF;
      IF v_product IS NOT NULL AND jsonb_typeof(v_ext -> 'target_variant_ids') = 'array' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_ext -> 'target_variant_ids') t(id)
        WHERE NOT EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.id::text = t.id AND pv.product_id = v_product)
      ) THEN
        v := v || 'las variantes a extender tienen que ser de este producto'::text;
      END IF;
    END IF;
  END IF;
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.validate_service_settings(p jsonb, p_variant_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.validate_service_settings(p jsonb, p_variant_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.validate_variant_portal_settings(p jsonb, p_variant_id uuid DEFAULT NULL::uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v text[] := ARRAY[]::text[];
  s jsonb;
  v_seen text[] := ARRAY[]::text[];
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN ARRAY['la configuración tiene que ser un objeto']; END IF;
  v := v || app_servicio.unknown_keys(p, ARRAY['v','enabled','ask_terms','sections']);
  IF p ? 'v' AND p -> 'v' <> '1'::jsonb THEN v := v || 'versión desconocida'::text; END IF;
  IF p ? 'enabled' AND jsonb_typeof(p -> 'enabled') <> 'boolean' THEN v := v || '«Acceso al portal» tiene que ser sí o no'::text; END IF;
  IF p ? 'ask_terms' AND jsonb_typeof(p -> 'ask_terms') <> 'boolean' THEN v := v || '«Esta variante los pide» tiene que ser sí o no'::text; END IF;
  IF p ? 'sections' THEN
    IF jsonb_typeof(p -> 'sections') <> 'array' THEN v := v || 'las secciones no son válidas'::text;
    ELSE
      FOR s IN SELECT x FROM jsonb_array_elements(p -> 'sections') x LOOP
        IF jsonb_typeof(s) <> 'object' THEN v := v || 'hay una sección que no es válida'::text; CONTINUE; END IF;
        IF jsonb_typeof(s -> 'section') = 'string' THEN
          IF (s ->> 'section') = ANY (v_seen) THEN v := v || format('la sección %s está repetida', s ->> 'section'); END IF;
          v_seen := v_seen || (s ->> 'section');
        END IF;
        v := v || app_servicio.portal_section_rule_problems(s);
      END LOOP;
    END IF;
  END IF;
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.validate_variant_portal_settings(p jsonb, p_variant_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.validate_variant_portal_settings(p jsonb, p_variant_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.validate_workspace_portal_settings(p jsonb, p_workspace_id uuid DEFAULT NULL::uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v text[] := ARRAY[]::text[];
  w jsonb; l jsonb; e jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN ARRAY['la configuración tiene que ser un objeto']; END IF;
  v := v || app_servicio.unknown_keys(p, ARRAY['v','host','from_email','welcome','login','support_whatsapp','extensions']);
  IF p ? 'v' AND p -> 'v' <> '1'::jsonb THEN v := v || 'versión desconocida'::text; END IF;
  IF p ? 'host' AND jsonb_typeof(p -> 'host') <> 'null' AND NOT (jsonb_typeof(p -> 'host') = 'string' AND length(p ->> 'host') <= 253
     AND (p ->> 'host') ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$') THEN
    v := v || 'la dirección no es válida: escribila sin https:// ni barras'::text;
  END IF;
  IF p ? 'from_email' AND jsonb_typeof(p -> 'from_email') <> 'null' AND NOT (jsonb_typeof(p -> 'from_email') = 'string' AND (p ->> 'from_email') ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') THEN
    v := v || 'el email de «Enviar desde» no es válido'::text;
  END IF;
  IF p ? 'welcome' THEN
    w := p -> 'welcome';
    IF jsonb_typeof(w) <> 'object' THEN v := v || 'la bienvenida no es válida'::text;
    ELSE v := v || app_servicio.unknown_keys(w, ARRAY['home_text','invite_subject','invite_body']);
    END IF;
  END IF;
  IF p ? 'login' THEN
    l := p -> 'login';
    IF jsonb_typeof(l) <> 'object' OR (l ? 'password_allowed' AND jsonb_typeof(l -> 'password_allowed') <> 'boolean') THEN v := v || '«Cómo entran» no es válido'::text; END IF;
  END IF;
  IF p ? 'support_whatsapp' AND jsonb_typeof(p -> 'support_whatsapp') <> 'null' AND NOT (jsonb_typeof(p -> 'support_whatsapp') = 'string' AND (p ->> 'support_whatsapp') ~ '^\+\d{6,15}$') THEN
    v := v || 'el WhatsApp de soporte tiene que empezar con + y el código de país'::text;
  END IF;
  IF p ? 'extensions' THEN
    e := p -> 'extensions';
    IF jsonb_typeof(e) <> 'object' OR (e ? 'projects' AND jsonb_typeof(e -> 'projects') <> 'boolean') THEN v := v || 'las extensiones no son válidas'::text; END IF;
  END IF;
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.validate_workspace_portal_settings(p jsonb, p_workspace_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.validate_workspace_portal_settings(p jsonb, p_workspace_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_servicio.variant_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v text[] := ARRAY[]::text[];
BEGIN
  IF TG_OP = 'INSERT' OR NEW.service_settings IS DISTINCT FROM OLD.service_settings THEN
    v := v || app_servicio.validate_service_settings(NEW.service_settings, NEW.id);
  END IF;
  IF TG_OP = 'INSERT' OR NEW.journey_template IS DISTINCT FROM OLD.journey_template THEN
    v := v || app_servicio.validate_journey_template(NEW.journey_template, NEW.id);
  END IF;
  IF TG_OP = 'INSERT' OR NEW.portal_settings IS DISTINCT FROM OLD.portal_settings THEN
    v := v || app_servicio.validate_variant_portal_settings(NEW.portal_settings, NEW.id);
  END IF;
  IF array_length(v, 1) > 0 THEN
    RAISE EXCEPTION 'La configuración no es válida: %', array_to_string(v, '; ') USING ERRCODE = 'SV001';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.variant_validate() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.workspace_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v text[];
BEGIN
  v := app_servicio.validate_workspace_portal_settings(NEW.portal_settings, NEW.id);
  IF array_length(v, 1) > 0 THEN
    RAISE EXCEPTION 'La configuración no es válida: %', array_to_string(v, '; ') USING ERRCODE = 'SV001';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.workspace_validate() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_servicio.ws_tz(p_workspace_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(NULLIF((SELECT w.timezone FROM public.workspaces w WHERE w.id = p_workspace_id), ''), 'UTC');
$function$;
REVOKE ALL ON FUNCTION app_servicio.ws_tz(p_workspace_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.ws_tz(p_workspace_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.assistant_month_spend(p_contact_id uuid, p_agent_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(sum(r.cost_usd), 0)::numeric
    FROM public.agent_runs r
    JOIN public.agents a ON a.id = r.agent_id
   WHERE r.agent_id = p_agent_id AND r.contact_id = p_contact_id AND r.source = 'portal_tutor'
     AND r.created_at >= (date_trunc('month', now() AT TIME ZONE app_servicio.ws_tz(a.workspace_id)) AT TIME ZONE app_servicio.ws_tz(a.workspace_id));
$function$;
REVOKE ALL ON FUNCTION app_servicio.assistant_month_spend(p_contact_id uuid, p_agent_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.assistant_month_spend(p_contact_id uuid, p_agent_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.local_date(p_ts timestamp with time zone, p_workspace_id uuid)
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN p_ts IS NULL THEN NULL ELSE (p_ts AT TIME ZONE app_servicio.ws_tz(p_workspace_id))::date END;
$function$;
REVOKE ALL ON FUNCTION app_servicio.local_date(p_ts timestamp with time zone, p_workspace_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.local_date(p_ts timestamp with time zone, p_workspace_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.today_in(p_workspace_id uuid)
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT (now() AT TIME ZONE app_servicio.ws_tz(p_workspace_id))::date;
$function$;
REVOKE ALL ON FUNCTION app_servicio.today_in(p_workspace_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_servicio.today_in(p_workspace_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION private.enqueue_svc_daily(p_now timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws record;
  v_local timestamp;
  v_key text;
  v_n integer := 0;
BEGIN
  FOR v_ws IN SELECT w.id, COALESCE(w.timezone, 'UTC') AS tz FROM public.workspaces w WHERE w.services_enabled IS TRUE LOOP
    BEGIN
      BEGIN
        v_local := p_now AT TIME ZONE v_ws.tz;
      EXCEPTION WHEN OTHERS THEN
        v_local := p_now AT TIME ZONE 'UTC';
      END;
      CONTINUE WHEN v_local::time < time '02:00';
      v_key := 'svc_daily:' || v_ws.id::text || ':' || v_local::date::text;
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.scheduled_jobs j WHERE j.dedupe_key = v_key);
      INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
      VALUES ('svc_daily', jsonb_build_object('workspace_id', v_ws.id, 'local_date', v_local::date::text), p_now, v_key)
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
      IF FOUND THEN v_n := v_n + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enqueue_svc_daily: no pude encolar el negocio %: %', v_ws.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION private.enqueue_svc_daily(p_now timestamp with time zone) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- Indices
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_community_posts_contact ON app_servicio_portal.community_posts USING btree (author_contact_id);

CREATE INDEX IF NOT EXISTS idx_community_posts_deleted ON app_servicio_portal.community_posts USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_community_posts_feed ON app_servicio_portal.community_posts USING btree (product_id, space_key, created_at DESC) WHERE ((parent_id IS NULL) AND (deleted_at IS NULL));

CREATE INDEX IF NOT EXISTS idx_community_posts_item ON app_servicio_portal.community_posts USING btree (program_item_id) WHERE (program_item_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_community_posts_parent ON app_servicio_portal.community_posts USING btree (parent_id) WHERE (parent_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_community_reports_open ON app_servicio_portal.community_reactions USING btree (post_id) WHERE ((kind = 'report'::text) AND (resolved_at IS NULL));

CREATE INDEX IF NOT EXISTS idx_link_clicks_contact ON app_servicio.link_clicks USING btree (contact_id);

CREATE INDEX IF NOT EXISTS idx_link_clicks_target ON app_servicio.link_clicks USING btree (target_type, target_id, target_date);

CREATE INDEX IF NOT EXISTS idx_live_attendance_contact ON app_servicio_portal.live_attendance USING btree (contact_id);

CREATE INDEX IF NOT EXISTS idx_live_sessions_product ON app_servicio.live_sessions USING btree (product_id) WHERE (archived_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_portal_access_contact ON app_servicio_portal.portal_access USING btree (contact_id, product_id, section);

CREATE INDEX IF NOT EXISTS idx_portal_access_service ON app_servicio_portal.portal_access USING btree (service_id);

CREATE INDEX IF NOT EXISTS idx_portal_accounts_invite ON app_servicio_portal.portal_accounts USING btree (invite_token_hash) WHERE (invite_token_hash IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_portal_sessions_account ON app_servicio_portal.portal_sessions USING btree (account_id) WHERE (revoked_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_program_items_tree ON app_servicio.program_items USING btree (product_id, parent_id, "position");

CREATE INDEX IF NOT EXISTS idx_program_items_ws ON app_servicio.program_items USING btree (workspace_id);

CREATE INDEX IF NOT EXISTS idx_program_progress_item ON app_servicio_portal.program_progress USING btree (program_item_id);

CREATE INDEX IF NOT EXISTS idx_service_items_form ON app_servicio.service_items USING btree (((ref ->> 'form_id'::text))) WHERE (ref ? 'form_id'::text);

CREATE INDEX IF NOT EXISTS idx_service_items_phase ON app_servicio.service_items USING btree (phase_id);

CREATE INDEX IF NOT EXISTS idx_service_items_service ON app_servicio.service_items USING btree (service_id, "position");

CREATE INDEX IF NOT EXISTS idx_service_items_status_due ON app_servicio.service_items USING btree (status, due_on);

CREATE INDEX IF NOT EXISTS idx_service_items_task ON app_servicio.service_items USING btree (task_id) WHERE (task_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_service_items_ws ON app_servicio.service_items USING btree (workspace_id);

CREATE INDEX IF NOT EXISTS idx_service_phases_service ON app_servicio.service_phases USING btree (service_id, "position");

CREATE INDEX IF NOT EXISTS idx_service_phases_ws ON app_servicio.service_phases USING btree (workspace_id);

CREATE INDEX IF NOT EXISTS idx_services_contact_product ON app_servicio.services USING btree (contact_id, product_id);

CREATE INDEX IF NOT EXISTS idx_services_extension_sales ON app_servicio.services USING gin (extension_sale_ids);

CREATE INDEX IF NOT EXISTS idx_services_owner_open ON app_servicio.services USING btree (owner_user_id) WHERE (status = ANY (ARRAY['active'::text, 'paused'::text]));

CREATE INDEX IF NOT EXISTS idx_services_previous ON app_servicio.services USING btree (previous_service_id) WHERE (previous_service_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_services_variant ON app_servicio.services USING btree (product_variant_id);

CREATE INDEX IF NOT EXISTS idx_services_ws_status ON app_servicio.services USING btree (workspace_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_community_reactions ON app_servicio_portal.community_reactions USING btree (post_id, COALESCE(contact_id, user_id), kind);

CREATE UNIQUE INDEX IF NOT EXISTS uq_live_attendance ON app_servicio_portal.live_attendance USING btree (live_session_id, occurs_on, contact_id) WHERE (removed_at IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_live_session_dates ON app_servicio.live_session_dates USING btree (live_session_id, occurs_on);

CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_access_live ON app_servicio_portal.portal_access USING btree (service_id, product_id, section) WHERE (revoked_at IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_accounts_contact ON app_servicio_portal.portal_accounts USING btree (workspace_id, contact_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_accounts_email ON app_servicio_portal.portal_accounts USING btree (workspace_id, email);

CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_sessions_token ON app_servicio_portal.portal_sessions USING btree (token_hash);

CREATE UNIQUE INDEX IF NOT EXISTS uq_program_progress ON app_servicio_portal.program_progress USING btree (contact_id, program_item_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_items_key ON app_servicio.service_items USING btree (service_id, template_key) WHERE (parent_item_id IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_items_occurrence ON app_servicio.service_items USING btree (parent_item_id, occurrence_index) WHERE (parent_item_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_phases_in_progress ON app_servicio.service_phases USING btree (service_id) WHERE (status = 'in_progress'::text);

CREATE UNIQUE INDEX IF NOT EXISTS uq_services_sale ON app_servicio.services USING btree (sale_id) WHERE (sale_id IS NOT NULL);

-- ----------------------------------------------------------------------------
-- Disparadores
-- ----------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER trg_community_post_structure BEFORE INSERT OR UPDATE OF parent_id, program_item_id, product_id ON app_servicio_portal.community_posts FOR EACH ROW EXECUTE FUNCTION app_servicio.community_post_structure();

CREATE OR REPLACE TRIGGER trg_program_progress AFTER INSERT OR UPDATE OF completed_at ON app_servicio_portal.program_progress FOR EACH ROW EXECUTE FUNCTION app_servicio.program_progress_hook();

CREATE OR REPLACE TRIGGER trg_program_items_structure BEFORE INSERT OR UPDATE ON app_servicio.program_items FOR EACH ROW EXECUTE FUNCTION app_servicio.program_items_structure();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON app_servicio.service_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER trg_svc_item_access AFTER UPDATE OF status ON app_servicio.service_items FOR EACH ROW EXECUTE FUNCTION app_servicio.svc_item_access_hook();

CREATE OR REPLACE TRIGGER trg_svc_items_progress AFTER INSERT OR DELETE OR UPDATE OF status, required ON app_servicio.service_items FOR EACH ROW EXECUTE FUNCTION app_servicio.svc_progress_trigger();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON app_servicio.service_phases FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER trg_app_servicio_phase_certificate AFTER INSERT OR UPDATE OF status ON app_servicio.service_phases FOR EACH ROW WHEN ((new.status = 'in_progress'::text)) EXECUTE FUNCTION app_servicio.phase_certificate_hook();

CREATE OR REPLACE TRIGGER trg_svc_phase_access AFTER UPDATE OF status ON app_servicio.service_phases FOR EACH ROW EXECUTE FUNCTION app_servicio.svc_phase_access_hook();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON app_servicio.services FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER trg_app_servicio_tutor_agent_guard BEFORE INSERT OR UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION app_servicio.tutor_agent_guard();

CREATE OR REPLACE TRIGGER trg_app_servicio_booking_area_clase AFTER INSERT ON public.booking_categories FOR EACH ROW WHEN ((new.system_key = 'servicio'::text)) EXECUTE FUNCTION app_servicio.booking_area_clase_hook();

CREATE OR REPLACE TRIGGER trg_app_servicio_booking AFTER INSERT OR UPDATE OF status ON public.bookings FOR EACH ROW EXECUTE FUNCTION app_servicio.booking_hook();

CREATE OR REPLACE TRIGGER trg_app_servicio_contact_email AFTER UPDATE OF email ON public.contacts FOR EACH ROW EXECUTE FUNCTION app_servicio.contact_email_portal_hook();

CREATE OR REPLACE TRIGGER trg_app_servicio_keep_contacts BEFORE DELETE ON public.contacts FOR EACH ROW EXECUTE FUNCTION app_servicio.keep_contacts_with_services();

CREATE OR REPLACE TRIGGER trg_app_servicio_signature AFTER INSERT ON public.contract_signatures FOR EACH ROW EXECUTE FUNCTION app_servicio.signature_hook();

CREATE OR REPLACE TRIGGER trg_app_servicio_portal_form_after AFTER INSERT ON public.form_submissions FOR EACH ROW EXECUTE FUNCTION app_servicio.portal_form_after_hook();

CREATE OR REPLACE TRIGGER trg_app_servicio_portal_form_before BEFORE INSERT ON public.form_submissions FOR EACH ROW EXECUTE FUNCTION app_servicio.portal_form_before_hook();

CREATE OR REPLACE TRIGGER trg_app_servicio_submission AFTER INSERT ON public.form_submissions FOR EACH ROW EXECUTE FUNCTION app_servicio.submission_hook();

CREATE OR REPLACE TRIGGER trg_app_servicio_submission_item BEFORE INSERT OR UPDATE OF service_item_id ON public.form_submissions FOR EACH ROW EXECUTE FUNCTION app_servicio.submission_item_hook();

CREATE OR REPLACE TRIGGER trg_app_servicio_payment AFTER INSERT OR UPDATE OF status ON public.payments FOR EACH ROW EXECUTE FUNCTION app_servicio.payment_hook();

CREATE OR REPLACE TRIGGER trg_app_servicio_config_guard BEFORE INSERT OR UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION app_servicio.config_guard();

CREATE OR REPLACE TRIGGER trg_app_servicio_portal_enabled AFTER INSERT OR DELETE OR UPDATE OF portal_settings, archived_at ON public.product_variants FOR EACH ROW EXECUTE FUNCTION app_servicio.sync_product_portal_enabled();

CREATE OR REPLACE TRIGGER trg_app_servicio_variant_validate BEFORE INSERT OR UPDATE OF service_settings, journey_template, portal_settings ON public.product_variants FOR EACH ROW EXECUTE FUNCTION app_servicio.variant_validate();

CREATE OR REPLACE TRIGGER trg_app_servicio_config_guard BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION app_servicio.config_guard();

CREATE OR REPLACE TRIGGER trg_app_servicio_product_validate BEFORE INSERT OR UPDATE OF portal_settings ON public.products FOR EACH ROW EXECUTE FUNCTION app_servicio.product_validate();

CREATE OR REPLACE TRIGGER trg_app_servicio_tutor_guard BEFORE INSERT OR UPDATE OF tutor_agent_id ON public.products FOR EACH ROW EXECUTE FUNCTION app_servicio.tutor_guard();

CREATE OR REPLACE TRIGGER trg_app_servicio_sale AFTER UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION app_servicio.sale_hook();

CREATE OR REPLACE TRIGGER trg_app_servicio_task AFTER UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION app_servicio.task_hook();

CREATE OR REPLACE TRIGGER trg_app_servicio_member_removed AFTER DELETE ON public.workspace_members FOR EACH ROW EXECUTE FUNCTION app_servicio.member_removed_hook();

CREATE OR REPLACE TRIGGER trg_app_servicio_config_guard BEFORE INSERT OR UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION app_servicio.config_guard();

CREATE OR REPLACE TRIGGER trg_app_servicio_module_clase AFTER UPDATE OF services_enabled ON public.workspaces FOR EACH ROW WHEN (((new.services_enabled IS TRUE) AND (old.services_enabled IS DISTINCT FROM true))) EXECUTE FUNCTION app_servicio.module_enabled_clase_hook();

CREATE OR REPLACE TRIGGER trg_app_servicio_workspace_validate BEFORE INSERT OR UPDATE OF portal_settings ON public.workspaces FOR EACH ROW EXECUTE FUNCTION app_servicio.workspace_validate();

-- ----------------------------------------------------------------------------
-- Reglas de acceso (RLS)
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE POLICY link_clicks_select ON app_servicio.link_clicks FOR SELECT TO authenticated
    USING ((public.is_workspace_member(workspace_id) AND (contact_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE ((c.id = link_clicks.contact_id) AND public.can_see_contact(c.*))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY live_session_dates_select ON app_servicio.live_session_dates FOR SELECT TO authenticated
    USING ((public.is_workspace_member(workspace_id) AND (public.has_permission(workspace_id, 'live_sessions.manage'::text) OR public.has_permission(workspace_id, 'services.view'::text) OR public.has_permission(workspace_id, 'portal.view'::text))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY live_sessions_select ON app_servicio.live_sessions FOR SELECT TO authenticated
    USING ((public.is_workspace_member(workspace_id) AND (public.has_permission(workspace_id, 'live_sessions.manage'::text) OR public.has_permission(workspace_id, 'services.view'::text) OR public.has_permission(workspace_id, 'portal.view'::text))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY program_items_select ON app_servicio.program_items FOR SELECT TO authenticated
    USING ((public.is_workspace_member(workspace_id) AND (public.has_permission(workspace_id, 'program.manage'::text) OR public.has_permission(workspace_id, 'services.configure'::text) OR public.has_permission(workspace_id, 'services.view'::text) OR public.has_permission(workspace_id, 'portal.view'::text))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY service_items_select ON app_servicio.service_items FOR SELECT TO authenticated
    USING (app_servicio.can_see_service(service_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY service_phases_select ON app_servicio.service_phases FOR SELECT TO authenticated
    USING (app_servicio.can_see_service(service_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY services_select ON app_servicio.services FOR SELECT TO authenticated
    USING (app_servicio.can_see_service_row(services.*));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY audit_log_select_services ON public.audit_log FOR SELECT TO authenticated
    USING (((entity_type = ANY (ARRAY['service'::text, 'service_phase'::text, 'service_item'::text])) AND ( SELECT public.is_workspace_member(audit_log.workspace_id) AS is_workspace_member) AND app_servicio.can_see_audit_entity(entity_type, entity_id)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
