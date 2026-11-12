-- ============================================================================
-- Grabaciones (Fathom y el analizador de llamadas)
--
-- Las llamadas que graba cada persona en Fathom (calls) y los analizadores por tipo
-- de reunion. La copia de lo que dijo la IA solo cambia con una corrida nueva. El refresh
-- token de una conexion se renueva con un candado en la base (es de un solo uso).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tablas
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.call_analysis_profiles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  category_id uuid NOT NULL,
  shape text DEFAULT 'general'::text NOT NULL,
  mode text DEFAULT 'manual'::text NOT NULL,
  rules jsonb DEFAULT '{}'::jsonb NOT NULL,
  rubric jsonb,
  auto_summary boolean DEFAULT true NOT NULL,
  auto_memory boolean DEFAULT true NOT NULL,
  auto_knowledge boolean DEFAULT false NOT NULL,
  active_prompt_version integer,
  archived_at timestamp with time zone,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT call_analysis_profiles_pkey PRIMARY KEY (id),
  CONSTRAINT call_analysis_profiles_mode_check CHECK ((mode = ANY (ARRAY['manual'::text, 'auto'::text]))),
  CONSTRAINT call_analysis_profiles_shape_check CHECK ((shape = ANY (ARRAY['sales'::text, 'general'::text]))),
  CONSTRAINT call_analysis_profiles_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.booking_categories(id) ON DELETE CASCADE,
  CONSTRAINT call_analysis_profiles_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT call_analysis_profiles_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT call_analysis_profiles_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.call_analysis_profiles ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.call_analysis_profiles IS 'Un analizador por tipo de reunion o area: formato, rubrica, instrucciones y cuando corre. Sin perfil, la grabacion no se analiza.';
REVOKE ALL ON TABLE public.call_analysis_profiles FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.call_analysis_profiles FROM authenticated;

CREATE TABLE IF NOT EXISTS public.calls (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  source text NOT NULL,
  external_id text,
  connection_id uuid,
  title text NOT NULL,
  fathom_url text,
  share_url text,
  recorded_at timestamp with time zone NOT NULL,
  scheduled_start_at timestamp with time zone,
  scheduled_end_at timestamp with time zone,
  duration_seconds integer,
  recorded_by_email text,
  recorded_by_user_id uuid,
  attendees jsonb DEFAULT '[]'::jsonb NOT NULL,
  transcript jsonb DEFAULT '[]'::jsonb NOT NULL,
  transcript_language text,
  participants_count smallint,
  speakers_count smallint,
  people_count smallint,
  contact_id uuid,
  booking_id uuid,
  link_method text DEFAULT 'none'::text NOT NULL,
  linked_by uuid,
  linked_at timestamp with time zone,
  analysis_status text DEFAULT 'classifying'::text NOT NULL,
  analysis_status_reason text,
  analysis_error text,
  analysis_ai jsonb,
  analysis jsonb,
  analysis_edited boolean DEFAULT false NOT NULL,
  closer_score smallint,
  lead_score smallint,
  lead_qualification text,
  outcome text,
  main_objection text,
  followup_at timestamp with time zone,
  has_open_alerts boolean DEFAULT false NOT NULL,
  quotes_total smallint,
  quotes_verified smallint,
  analysis_prompt_version integer,
  rubric_snapshot jsonb,
  rubric_version integer,
  analysis_model text,
  analysis_run_id uuid,
  analyzed_at timestamp with time zone,
  summary jsonb,
  summary_status text DEFAULT 'none'::text NOT NULL,
  memory_status text DEFAULT 'none'::text NOT NULL,
  memory_applied_at timestamp with time zone,
  ideas_created_at timestamp with time zone,
  knowledge_document_id uuid,
  objections jsonb DEFAULT '[]'::jsonb NOT NULL,
  raw_payload jsonb,
  created_by uuid,
  archived_at timestamp with time zone,
  archived_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  imported_from_history boolean DEFAULT false NOT NULL,
  area_id uuid,
  category_id uuid,
  category_snapshot jsonb,
  classification_source text,
  no_show boolean DEFAULT false NOT NULL,
  analyzed_category_id uuid,
  analysis_profile_id uuid,
  classification_rule text,
  classification_confidence numeric(3,2),
  CONSTRAINT calls_pkey PRIMARY KEY (id),
  CONSTRAINT calls_analysis_status_check CHECK ((analysis_status = ANY (ARRAY['classifying'::text, 'needs_review'::text, 'pending'::text, 'analyzing'::text, 'analyzed'::text, 'not_applicable'::text, 'error'::text]))),
  CONSTRAINT calls_classification_confidence_check CHECK (((classification_confidence IS NULL) OR ((classification_confidence >= (0)::numeric) AND (classification_confidence <= (1)::numeric)))),
  CONSTRAINT calls_classification_source_check CHECK (((classification_source IS NULL) OR (classification_source = ANY (ARRAY['human'::text, 'booking'::text, 'rule'::text, 'connection'::text, 'ai'::text])))),
  CONSTRAINT calls_closer_score_check CHECK (((closer_score IS NULL) OR ((closer_score >= 0) AND (closer_score <= 100)))),
  CONSTRAINT calls_duration_seconds_check CHECK (((duration_seconds IS NULL) OR (duration_seconds >= 0))),
  CONSTRAINT calls_lead_qualification_check CHECK ((lead_qualification = ANY (ARRAY['calificado'::text, 'con_reservas'::text, 'no_calificado'::text]))),
  CONSTRAINT calls_lead_score_check CHECK (((lead_score IS NULL) OR ((lead_score >= 0) AND (lead_score <= 100)))),
  CONSTRAINT calls_link_method_check CHECK ((link_method = ANY (ARRAY['auto_email'::text, 'auto_booking'::text, 'auto_email_booking'::text, 'manual'::text, 'none'::text]))),
  CONSTRAINT calls_memory_status_check CHECK ((memory_status = ANY (ARRAY['none'::text, 'applied'::text, 'conflict'::text, 'skipped'::text]))),
  CONSTRAINT calls_source_check CHECK ((source = ANY (ARRAY['fathom'::text, 'manual'::text]))),
  CONSTRAINT calls_summary_status_check CHECK ((summary_status = ANY (ARRAY['none'::text, 'pending'::text, 'done'::text, 'error'::text]))),
  CONSTRAINT calls_analyzed_category_id_fkey FOREIGN KEY (analyzed_category_id) REFERENCES public.booking_categories(id) ON DELETE SET NULL,
  CONSTRAINT calls_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.booking_categories(id) ON DELETE SET NULL,
  CONSTRAINT calls_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL,
  CONSTRAINT calls_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.booking_categories(id) ON DELETE SET NULL,
  CONSTRAINT calls_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.oauth_connections(id) ON DELETE SET NULL,
  CONSTRAINT calls_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL,
  CONSTRAINT calls_knowledge_document_id_fkey FOREIGN KEY (knowledge_document_id) REFERENCES public.knowledge_base(id) ON DELETE SET NULL,
  CONSTRAINT calls_recorded_by_user_id_fkey FOREIGN KEY (recorded_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT calls_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.calls IS 'Llamadas de venta (Fathom o importadas a mano) con su transcripcion y su analisis. Se archivan, no se borran. Escribe solo el servidor; las lee quien pasa can_see_call().';
COMMENT ON COLUMN public.calls.analysis_ai IS 'La salida original de la IA. Inmutable salvo corrida nueva (trigger calls_protect_analysis_ai). Lo que se muestra y se corrige es `analysis`.';
COMMENT ON COLUMN public.calls.rubric_snapshot IS 'Copia completa de la rubrica con la que se analizo ({version, closer[], lead[]}). Un cambio posterior de la rubrica no altera puntajes viejos.';
COMMENT ON COLUMN public.calls.analysis_run_id IS 'agent_runs.id de la corrida que escribio analysis_ai. Si no hay corrida registrada, un uuid nuevo: tiene que cambiar en cada analisis.';
COMMENT ON COLUMN public.calls.imported_from_history IS 'Entro por una importacion del historial: no dispara automatizaciones y no se analiza sola.';
COMMENT ON COLUMN public.calls.area_id IS 'El area de la grabacion. null = Sin clasificar.';
COMMENT ON COLUMN public.calls.category_id IS 'El tipo de reunion o, si solo se sabe el area, el area.';
COMMENT ON COLUMN public.calls.category_snapshot IS 'Area y tipo con sus nombres, con la misma forma que bookings.category_snapshot.';
COMMENT ON COLUMN public.calls.classification_source IS 'Quien decidio: human, booking, rule, connection o ai. Lo elegido a mano nunca se pisa.';
COMMENT ON COLUMN public.calls.no_show IS 'Nadie se presento. Es una marca y no un tipo: una llamada de ventas sigue siendo de ventas. Evita el analisis y el resumen.';
COMMENT ON COLUMN public.calls.analyzed_category_id IS 'Con que clasificacion se hizo el ultimo analisis: si cambio despues, la ficha ofrece regenerarlo.';
COMMENT ON COLUMN public.calls.analysis_profile_id IS 'El perfil con el que se hizo el ultimo analisis. La rubrica de ese momento esta en rubric_snapshot.';
COMMENT ON COLUMN public.calls.classification_rule IS 'La regla que decidio el area y el tipo, o la que marco el no show.';
COMMENT ON COLUMN public.calls.classification_confidence IS 'La seguridad de la IA al clasificar, de 0 a 1. Vacia si no decidio la IA.';
REVOKE ALL ON TABLE public.calls FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.calls FROM authenticated;

-- ----------------------------------------------------------------------------
-- Claves foraneas hacia tablas de esta area
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  ALTER TABLE public.ai_task_prompt_versions ADD CONSTRAINT ai_task_prompt_versions_variant_fkey FOREIGN KEY (variant) REFERENCES public.call_analysis_profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.calls ADD CONSTRAINT calls_analysis_profile_id_fkey FOREIGN KEY (analysis_profile_id) REFERENCES public.call_analysis_profiles(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.content_ideas ADD CONSTRAINT content_ideas_call_id_fkey FOREIGN KEY (call_id) REFERENCES public.calls(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Funciones
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.enqueue_fathom_sync()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_conn record;
  v_slot bigint := floor(extract(epoch FROM now()) / 600);
  v_enqueued integer := 0;
BEGIN
  FOR v_conn IN
    SELECT c.id
    FROM public.oauth_connections c
    WHERE c.provider = 'fathom'
      AND c.status = 'active'
      AND EXISTS (
        SELECT 1 FROM public.workspace_members m
        WHERE m.workspace_id = c.workspace_id AND m.user_id = c.user_id
      )
  LOOP
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM public.scheduled_jobs j
        WHERE j.type = 'fathom_sync'
          AND j.status IN ('pending', 'processing')
          AND j.dedupe_key LIKE 'fathom_sync:' || v_conn.id::text || ':%'
      ) THEN
        INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
        VALUES (
          'fathom_sync',
          jsonb_build_object('connectionId', v_conn.id),
          now(),
          'fathom_sync:' || v_conn.id::text || ':' || v_slot::text
        )
        ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
        IF FOUND THEN
          v_enqueued := v_enqueued + 1;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enqueue_fathom_sync: no pude encolar la conexion %: %', v_conn.id, SQLERRM;
    END;
  END LOOP;

  -- Un analisis que se quedo en `analyzing` (el proceso murio a la mitad) vuelve a la fila.
  BEGIN
    UPDATE public.calls
       SET analysis_status = 'pending', analysis_status_reason = 'stuck'
     WHERE analysis_status = 'analyzing'
       AND updated_at < now() - interval '15 minutes';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_fathom_sync: no pude barrer los analisis trabados: %', SQLERRM;
  END;

  RETURN v_enqueued;
END;
$function$;
REVOKE ALL ON FUNCTION private.enqueue_fathom_sync() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.calls_protect_analysis_ai()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF (NEW.analysis_ai IS DISTINCT FROM OLD.analysis_ai
      OR NEW.rubric_snapshot IS DISTINCT FROM OLD.rubric_snapshot)
     AND NEW.analysis_run_id IS NOT DISTINCT FROM OLD.analysis_run_id THEN
    RAISE EXCEPTION 'analysis_ai y rubric_snapshot solo cambian con una corrida de analisis nueva (analysis_run_id)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.can_see_call(c public.calls)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT public.is_workspace_member(c.workspace_id)
     AND (
       public.is_workspace_admin(c.workspace_id)
       OR c.recorded_by_user_id = auth.uid()
       OR (
         c.contact_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM public.contacts ct
           WHERE ct.id = c.contact_id AND public.can_see_contact(ct)
         )
       )
       OR (
         public.has_permission(c.workspace_id, 'calls.view')
         AND public.permission_scope(c.workspace_id, 'calls') = 'all'
       )
       OR (
         public.permission_scope(c.workspace_id, 'calls') = 'areas'
         AND public.has_permission(c.workspace_id, 'calls.view')
         AND private.role_sees_call_area(private.my_call_permissions(c.workspace_id), c.area_id)
       )
     );
$function$;
REVOKE ALL ON FUNCTION public.can_see_call(c public.calls) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.can_see_call_id(p_call_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(
    (SELECT public.can_see_call(c) FROM public.calls c WHERE c.id = p_call_id),
    false
  );
$function$;
REVOKE ALL ON FUNCTION public.can_see_call_id(p_call_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.claim_oauth_refresh(p_connection_id uuid, p_seconds integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_taken boolean;
BEGIN
  UPDATE public.oauth_connections
     SET refresh_locked_until = now() + make_interval(secs => GREATEST(p_seconds, 1))
   WHERE id = p_connection_id
     AND (refresh_locked_until IS NULL OR refresh_locked_until < now())
  RETURNING true INTO v_taken;
  RETURN COALESCE(v_taken, false);
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_oauth_refresh(p_connection_id uuid, p_seconds integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.release_oauth_refresh(p_connection_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  UPDATE public.oauth_connections SET refresh_locked_until = NULL WHERE id = p_connection_id;
$function$;
REVOKE ALL ON FUNCTION public.release_oauth_refresh(p_connection_id uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_ai_background_task_settings(p_workspace_id uuid, p_task text, p_value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_old jsonb;
BEGIN
  IF p_task NOT IN ('call_classification', 'call_analysis') THEN
    RAISE EXCEPTION 'tarea no admitida: %', p_task USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT ai_background_settings -> p_task INTO v_old
    FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace inexistente' USING ERRCODE = 'no_data_found';
  END IF;

  -- Solo esa clave: las demas tareas quedan como estaban.
  UPDATE public.workspaces
     SET ai_background_settings = jsonb_set(COALESCE(ai_background_settings, '{}'::jsonb), ARRAY[p_task], p_value, true)
   WHERE id = p_workspace_id;

  RETURN v_old;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_ai_background_task_settings(p_workspace_id uuid, p_task text, p_value jsonb) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Indices
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_calls_area ON public.calls USING btree (workspace_id, area_id, recorded_at DESC) WHERE (archived_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_calls_booking ON public.calls USING btree (booking_id) WHERE (booking_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_calls_category ON public.calls USING btree (workspace_id, category_id, recorded_at DESC) WHERE (archived_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_calls_connection ON public.calls USING btree (connection_id) WHERE (connection_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_calls_contact ON public.calls USING btree (contact_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_calls_outcome ON public.calls USING btree (workspace_id, outcome);

CREATE INDEX IF NOT EXISTS idx_calls_recorded ON public.calls USING btree (workspace_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_calls_recorder ON public.calls USING btree (recorded_by_user_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_calls_status ON public.calls USING btree (workspace_id, analysis_status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_call_analysis_profiles_category ON public.call_analysis_profiles USING btree (workspace_id, category_id) WHERE (archived_at IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_calls_external ON public.calls USING btree (workspace_id, source, external_id) WHERE (external_id IS NOT NULL);

-- ----------------------------------------------------------------------------
-- Disparadores
-- ----------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER calls_protect_analysis_ai BEFORE UPDATE ON public.calls FOR EACH ROW EXECUTE FUNCTION public.calls_protect_analysis_ai();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.calls FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ----------------------------------------------------------------------------
-- Reglas de acceso (RLS)
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE POLICY audit_log_select_calls ON public.audit_log FOR SELECT TO authenticated
    USING ((public.is_workspace_member(workspace_id) AND (entity_type = 'call'::text) AND public.can_see_call_id(entity_id)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY call_analysis_profiles_select ON public.call_analysis_profiles FOR SELECT TO authenticated
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY calls_select ON public.calls FOR SELECT TO authenticated
    USING (public.can_see_call(calls.*));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
