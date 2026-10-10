-- ============================================================================
-- 00145 — Llamadas: la tabla `calls`, quien ve cada una, y lo que necesita Fathom
-- ============================================================================
-- Modulo Llamadas (Fathom + analizador de llamadas con IA), F2 y F3.
--
-- Una sola tabla nueva: `calls`. Todo lo demas son columnas y funciones:
--
--   1. `calls` (con RLS: solo lectura para los usuarios; escribe el servidor).
--      - Unico (workspace_id, source, external_id): la misma llamada de Fathom
--        no entra dos veces.
--      - SIN unico sobre booking_id: varias llamadas pueden colgar de la misma
--        agenda (bug de prevxcrm, que fallaba en silencio).
--      - Trigger `calls_protect_analysis_ai`: `analysis_ai` y `rubric_snapshot`
--        (lo que dijo la IA y con que rubrica) solo cambian junto con un
--        `analysis_run_id` NUEVO, es decir, con una corrida nueva.
--   2. `can_see_call(calls)` y `can_see_call_id(uuid)`: la copia del patron de
--      `can_see_booking`. Una llamada la ve: Owner/Admin, quien la grabo, quien
--      puede ver su contacto (`can_see_contact`) y un rol con `calls.view` de
--      alcance `all`. Las ramas "propias" NO dependen de `has_permission`
--      (que no conoce los permisos del Member de sistema).
--   3. `oauth_connections`: el CHECK de `provider` suma 'fathom' y 5 columnas
--      de sincronizacion (marca de agua, cursor, ultimo error, candado).
--   4. `claim_oauth_refresh` / `release_oauth_refresh`: el refresh token de
--      Fathom es de UN SOLO USO; dos procesos renovando a la vez dejan la
--      conexion muerta. El candado vive en la base. Solo `service_role`.
--   5. `workspace_members.is_closer` y `closer_emails`: quien graba llamadas
--      de venta y con que correos alternos.
--
-- NO se toca ninguna funcion ni policy existente. Aditiva (salvo el CHECK de
-- `provider`, que conserva todos sus valores) e idempotente.
--
-- Como volver atras:
--   ALTER TABLE public.oauth_connections DROP CONSTRAINT IF EXISTS oauth_connections_provider_check;
--   ALTER TABLE public.oauth_connections ADD CONSTRAINT oauth_connections_provider_check
--     CHECK (provider = ANY (ARRAY['google'::text, 'linkedin'::text, 'threads'::text, 'google_calendar'::text]));
--   (antes: borrar las conexiones con provider = 'fathom')
--   DROP FUNCTION IF EXISTS public.claim_oauth_refresh(uuid, integer);
--   DROP FUNCTION IF EXISTS public.release_oauth_refresh(uuid);
--   ALTER TABLE public.oauth_connections
--     DROP COLUMN IF EXISTS refresh_locked_until, DROP COLUMN IF EXISTS sync_last_error,
--     DROP COLUMN IF EXISTS sync_cursor, DROP COLUMN IF EXISTS sync_watermark, DROP COLUMN IF EXISTS last_synced_at;
--   ALTER TABLE public.workspace_members DROP COLUMN IF EXISTS closer_emails, DROP COLUMN IF EXISTS is_closer;
--   DROP POLICY IF EXISTS calls_select ON public.calls;
--   DROP TABLE IF EXISTS public.calls;           -- despues de las dos funciones can_see_call*
--   DROP FUNCTION IF EXISTS public.can_see_call_id(uuid);
--   DROP FUNCTION IF EXISTS public.can_see_call(public.calls);
--   DROP FUNCTION IF EXISTS public.calls_protect_analysis_ai();
-- ============================================================================

-- ------------------------------------------------------------
-- 1. La tabla
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  source text NOT NULL CHECK (source IN ('fathom', 'manual')),
  external_id text,
  connection_id uuid REFERENCES public.oauth_connections(id) ON DELETE SET NULL,

  title text NOT NULL,
  fathom_url text,
  share_url text,
  recorded_at timestamptz NOT NULL,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  recorded_by_email text,
  recorded_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  attendees jsonb NOT NULL DEFAULT '[]'::jsonb,
  transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
  transcript_language text,
  participants_count smallint,
  speakers_count smallint,
  people_count smallint,

  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  link_method text NOT NULL DEFAULT 'none'
    CHECK (link_method IN ('auto_email', 'auto_booking', 'auto_email_booking', 'manual', 'none')),
  linked_by uuid,
  linked_at timestamptz,

  call_type text,
  call_type_source text CHECK (call_type_source IN ('rule', 'ai', 'human')),
  call_type_rule text,
  call_type_confidence numeric(3, 2) CHECK (call_type_confidence IS NULL OR (call_type_confidence >= 0 AND call_type_confidence <= 1)),
  call_type_alternative text,
  call_type_proposed text,

  analysis_status text NOT NULL DEFAULT 'classifying'
    CHECK (analysis_status IN ('classifying', 'needs_review', 'pending', 'analyzing', 'analyzed', 'not_applicable', 'error')),
  analysis_status_reason text,
  analysis_error text,
  analysis_ai jsonb,
  analysis jsonb,
  analysis_edited boolean NOT NULL DEFAULT false,
  closer_score smallint CHECK (closer_score IS NULL OR (closer_score >= 0 AND closer_score <= 100)),
  lead_score smallint CHECK (lead_score IS NULL OR (lead_score >= 0 AND lead_score <= 100)),
  lead_qualification text CHECK (lead_qualification IN ('calificado', 'con_reservas', 'no_calificado')),
  outcome text,
  main_objection text,
  followup_at timestamptz,
  has_open_alerts boolean NOT NULL DEFAULT false,
  quotes_total smallint,
  quotes_verified smallint,
  analysis_prompt_version integer,
  rubric_snapshot jsonb,
  rubric_version integer,
  analysis_model text,
  analysis_run_id uuid,
  analyzed_at timestamptz,

  summary jsonb,
  summary_status text NOT NULL DEFAULT 'none' CHECK (summary_status IN ('none', 'pending', 'done', 'error')),
  memory_status text NOT NULL DEFAULT 'none' CHECK (memory_status IN ('none', 'applied', 'conflict', 'skipped')),
  memory_applied_at timestamptz,
  ideas_created_at timestamptz,
  knowledge_document_id uuid REFERENCES public.knowledge_base(id) ON DELETE SET NULL,

  objections jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_payload jsonb,
  created_by uuid,
  archived_at timestamptz,
  archived_by uuid,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.calls IS
  'Llamadas de venta (Fathom o importadas a mano) con su transcripcion y su analisis. Se archivan, no se borran. Escribe solo el servidor; las lee quien pasa can_see_call().';
COMMENT ON COLUMN public.calls.analysis_ai IS
  'La salida original de la IA. Inmutable salvo corrida nueva (trigger calls_protect_analysis_ai). Lo que se muestra y se corrige es `analysis`.';
COMMENT ON COLUMN public.calls.rubric_snapshot IS
  'Copia completa de la rubrica con la que se analizo ({version, closer[], lead[]}). Un cambio posterior de la rubrica no altera puntajes viejos.';
COMMENT ON COLUMN public.calls.analysis_run_id IS
  'agent_runs.id de la corrida que escribio analysis_ai. Si no hay corrida registrada, un uuid nuevo: tiene que cambiar en cada analisis.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_calls_external
  ON public.calls (workspace_id, source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calls_recorded ON public.calls (workspace_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_status ON public.calls (workspace_id, analysis_status);
CREATE INDEX IF NOT EXISTS idx_calls_contact ON public.calls (contact_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_booking ON public.calls (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calls_recorder ON public.calls (recorded_by_user_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_outcome ON public.calls (workspace_id, outcome);
CREATE INDEX IF NOT EXISTS idx_calls_connection ON public.calls (connection_id) WHERE connection_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.calls;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.calls
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 2. Lo que dijo la IA no se edita nunca
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calls_protect_analysis_ai()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (NEW.analysis_ai IS DISTINCT FROM OLD.analysis_ai
      OR NEW.rubric_snapshot IS DISTINCT FROM OLD.rubric_snapshot)
     AND NEW.analysis_run_id IS NOT DISTINCT FROM OLD.analysis_run_id THEN
    RAISE EXCEPTION 'analysis_ai y rubric_snapshot solo cambian con una corrida de analisis nueva (analysis_run_id)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS calls_protect_analysis_ai ON public.calls;
CREATE TRIGGER calls_protect_analysis_ai BEFORE UPDATE ON public.calls
  FOR EACH ROW EXECUTE FUNCTION public.calls_protect_analysis_ai();

-- ------------------------------------------------------------
-- 3. Quien ve cada llamada
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_see_call(c public.calls)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
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
     );
$$;

REVOKE ALL ON FUNCTION public.can_see_call(public.calls) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_call(public.calls) TO authenticated, service_role;

-- La misma regla, por id: la usa la politica de lectura del historial (00147).
CREATE OR REPLACE FUNCTION public.can_see_call_id(p_call_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT public.can_see_call(c) FROM public.calls c WHERE c.id = p_call_id),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.can_see_call_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_call_id(uuid) TO authenticated, service_role;

ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

-- Solo lectura para los usuarios: escribir es del servidor (las acciones
-- verifican el permiso antes). Sin DELETE: las llamadas se archivan.
DROP POLICY IF EXISTS calls_select ON public.calls;
CREATE POLICY calls_select ON public.calls
  FOR SELECT TO authenticated USING (public.can_see_call(calls));

REVOKE ALL ON public.calls FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.calls FROM authenticated;

-- ------------------------------------------------------------
-- 4. oauth_connections: Fathom y su sincronizacion
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'oauth_connections_provider_check'
      AND conrelid = 'public.oauth_connections'::regclass
      AND pg_get_constraintdef(oid) LIKE '%fathom%'
  ) THEN
    ALTER TABLE public.oauth_connections DROP CONSTRAINT IF EXISTS oauth_connections_provider_check;
    ALTER TABLE public.oauth_connections ADD CONSTRAINT oauth_connections_provider_check
      CHECK (provider = ANY (ARRAY['google'::text, 'linkedin'::text, 'threads'::text, 'google_calendar'::text, 'fathom'::text]));
  END IF;
END $$;

ALTER TABLE public.oauth_connections
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_watermark timestamptz,
  ADD COLUMN IF NOT EXISTS sync_cursor text,
  ADD COLUMN IF NOT EXISTS sync_last_error text,
  ADD COLUMN IF NOT EXISTS refresh_locked_until timestamptz;

COMMENT ON COLUMN public.oauth_connections.sync_watermark IS
  'Hasta donde se leyo de la fuente (Fathom). Solo avanza al terminar una pasada completa.';
COMMENT ON COLUMN public.oauth_connections.sync_cursor IS
  'Cursor de paginacion de una pasada a medias (Fathom). Null = no hay pasada pendiente.';
COMMENT ON COLUMN public.oauth_connections.refresh_locked_until IS
  'Candado de renovacion: el refresh token de Fathom es de un solo uso, solo un proceso renueva a la vez (claim_oauth_refresh).';

-- ------------------------------------------------------------
-- 5. El candado de renovacion (solo service_role)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_oauth_refresh(p_connection_id uuid, p_seconds integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.release_oauth_refresh(p_connection_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.oauth_connections SET refresh_locked_until = NULL WHERE id = p_connection_id;
$$;

REVOKE ALL ON FUNCTION public.claim_oauth_refresh(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_oauth_refresh(uuid, integer) TO service_role;
REVOKE ALL ON FUNCTION public.release_oauth_refresh(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_oauth_refresh(uuid) TO service_role;

-- ------------------------------------------------------------
-- 6. Equipo: quien es closer
-- ------------------------------------------------------------
ALTER TABLE public.workspace_members
  ADD COLUMN IF NOT EXISTS is_closer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS closer_emails text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.workspace_members.is_closer IS
  'Graba llamadas de venta. Solo las llamadas de quien es closer entran desde Fathom.';
COMMENT ON COLUMN public.workspace_members.closer_emails IS
  'Correos alternos con los que esta persona graba en Fathom o Zoom (normalizados, en minuscula).';
