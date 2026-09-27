-- ============================================================================
-- 00096 — Disponibilidad: horarios y tiempo fuera (Etapa 4, Bloque 2, F9)
-- ============================================================================
--  1. availability_schedules: los horarios de cada persona, con las reglas
--     semanales (`weekly_hours`) y las excepciones por fecha (`date_overrides`)
--     como jsonb (§9.0: pocas filas que siempre se leen con su horario). Un
--     solo horario por defecto por persona, garantizado con un unico parcial.
--  2. out_of_office: los periodos bloqueados de la persona, en UTC. Aplican a
--     todos sus horarios y eventos.
--  3. set_default_schedule(): marcar por defecto en UNA transaccion (el
--     anterior deja de serlo y el nuevo pasa a serlo, sin ventana en la que
--     haya dos o ninguno).
--  4. ensure_default_schedule(): crea "Horario normal" (lun a vie, 9 a 17, en
--     la zona del perfil) si la persona no tiene ningun horario. Backfill para
--     los perfiles que ya existen (F3: "al crear el perfil se crea Horario
--     normal"; el perfil llego en la 00095 y la tabla recien ahora).
--  5. purge_soft_deleted() suma las dos tablas (retencion de 30 dias).
--
-- Idempotente y aditiva.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. availability_schedules
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.availability_schedules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  -- Zona IANA en la que estan escritas las reglas ("09:00" es 09:00 ACA).
  timezone       text NOT NULL,
  is_default     boolean NOT NULL DEFAULT false,
  -- { "1": [{"start":"09:00","end":"13:00"}], ... } clave = dia (0 = domingo).
  weekly_hours   jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- [{ "date": "2026-10-12", "ranges": [] }, ...] ranges vacio = no disponible.
  date_overrides jsonb NOT NULL DEFAULT '[]'::jsonb,
  deleted_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.availability_schedules IS
  'Horarios de disponibilidad de cada persona. Las reglas van en hora local + la zona del horario; el motor las convierte a UTC.';
COMMENT ON COLUMN public.availability_schedules.weekly_hours IS
  'Rangos por dia de la semana (clave 0=domingo..6=sabado). Dia ausente o vacio = no trabaja. Validado con Zod en la Server Action.';
COMMENT ON COLUMN public.availability_schedules.date_overrides IS
  'Excepciones por fecha: reemplazan la regla semanal de ese dia. ranges vacio = no disponible todo el dia.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'availability_schedules_name_check') THEN
    ALTER TABLE public.availability_schedules ADD CONSTRAINT availability_schedules_name_check
      CHECK (char_length(btrim(name)) BETWEEN 1 AND 60);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'availability_schedules_weekly_hours_object') THEN
    ALTER TABLE public.availability_schedules ADD CONSTRAINT availability_schedules_weekly_hours_object
      CHECK (jsonb_typeof(weekly_hours) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'availability_schedules_date_overrides_array') THEN
    ALTER TABLE public.availability_schedules ADD CONSTRAINT availability_schedules_date_overrides_array
      CHECK (jsonb_typeof(date_overrides) = 'array');
  END IF;
END $$;

-- Exactamente un horario por defecto por persona, entre los no borrados.
CREATE UNIQUE INDEX IF NOT EXISTS uq_availability_schedules_default
  ON public.availability_schedules (user_id)
  WHERE is_default AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_availability_schedules_ws_user
  ON public.availability_schedules (workspace_id, user_id)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.availability_schedules;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.availability_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.availability_schedules ENABLE ROW LEVEL SECURITY;

-- La persona dueña o quien tiene scheduling.manage_others (F9). Sin DELETE:
-- se marca deleted_at.
DROP POLICY IF EXISTS "availability_schedules_select" ON public.availability_schedules;
CREATE POLICY "availability_schedules_select" ON public.availability_schedules
  FOR SELECT USING (public.scheduling_can_manage(workspace_id, user_id));

DROP POLICY IF EXISTS "availability_schedules_insert" ON public.availability_schedules;
CREATE POLICY "availability_schedules_insert" ON public.availability_schedules
  FOR INSERT WITH CHECK (public.scheduling_can_manage(workspace_id, user_id));

DROP POLICY IF EXISTS "availability_schedules_update" ON public.availability_schedules;
CREATE POLICY "availability_schedules_update" ON public.availability_schedules
  FOR UPDATE USING (public.scheduling_can_manage(workspace_id, user_id))
  WITH CHECK (public.scheduling_can_manage(workspace_id, user_id));

-- El horario por defecto del perfil (la columna existe desde la 00095).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduling_profiles_default_schedule_fk') THEN
    ALTER TABLE public.scheduling_profiles
      ADD CONSTRAINT scheduling_profiles_default_schedule_fk
      FOREIGN KEY (default_schedule_id) REFERENCES public.availability_schedules(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. out_of_office
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.out_of_office (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  all_day      boolean NOT NULL DEFAULT true,
  reason       text NOT NULL DEFAULT 'other',
  note         text,
  deleted_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.out_of_office IS
  'Tiempo fuera de una persona (vacaciones, viajes). Bloquea todos sus horarios y eventos. Instantes en UTC.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'out_of_office_range_check') THEN
    ALTER TABLE public.out_of_office ADD CONSTRAINT out_of_office_range_check CHECK (ends_at > starts_at);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'out_of_office_reason_check') THEN
    ALTER TABLE public.out_of_office ADD CONSTRAINT out_of_office_reason_check
      CHECK (reason IN ('vacation', 'travel', 'sick', 'other'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_out_of_office_user_range
  ON public.out_of_office (user_id, starts_at, ends_at)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.out_of_office;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.out_of_office
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.out_of_office ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "out_of_office_select" ON public.out_of_office;
CREATE POLICY "out_of_office_select" ON public.out_of_office
  FOR SELECT USING (public.scheduling_can_manage(workspace_id, user_id));

DROP POLICY IF EXISTS "out_of_office_insert" ON public.out_of_office;
CREATE POLICY "out_of_office_insert" ON public.out_of_office
  FOR INSERT WITH CHECK (public.scheduling_can_manage(workspace_id, user_id));

DROP POLICY IF EXISTS "out_of_office_update" ON public.out_of_office;
CREATE POLICY "out_of_office_update" ON public.out_of_office
  FOR UPDATE USING (public.scheduling_can_manage(workspace_id, user_id))
  WITH CHECK (public.scheduling_can_manage(workspace_id, user_id));

-- ------------------------------------------------------------
-- 3. Marcar por defecto, en una sola transaccion
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_default_schedule(p_schedule_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws   uuid;
  v_user uuid;
BEGIN
  SELECT workspace_id, user_id INTO v_ws, v_user
  FROM public.availability_schedules
  WHERE id = p_schedule_id AND deleted_at IS NULL;

  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'schedule_not_found';
  END IF;
  IF NOT public.scheduling_can_manage(v_ws, v_user) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  -- Primero se apaga el anterior: el unico parcial no admite dos a la vez.
  UPDATE public.availability_schedules
  SET is_default = false
  WHERE user_id = v_user AND deleted_at IS NULL AND is_default AND id <> p_schedule_id;

  UPDATE public.availability_schedules
  SET is_default = true
  WHERE id = p_schedule_id;

  UPDATE public.scheduling_profiles
  SET default_schedule_id = p_schedule_id
  WHERE workspace_id = v_ws AND user_id = v_user;
END;
$$;

REVOKE ALL ON FUNCTION public.set_default_schedule(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_default_schedule(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4. "Horario normal" si la persona no tiene ninguno (F3)
-- ------------------------------------------------------------
-- Lun a vie, 9 a 17, en la zona del perfil. Es el mismo valor que
-- defaultWeeklyHours() en lib/scheduling/availability-schema.ts (hay un test
-- que compara los dos).

CREATE OR REPLACE FUNCTION public.ensure_default_schedule(p_workspace_id uuid, p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing uuid;
  v_tz       text;
  v_id       uuid;
BEGIN
  IF NOT public.scheduling_can_manage(p_workspace_id, p_user_id) AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  SELECT id INTO v_existing
  FROM public.availability_schedules
  WHERE workspace_id = p_workspace_id AND user_id = p_user_id AND deleted_at IS NULL
  ORDER BY is_default DESC, created_at ASC
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    -- Hay horarios pero ninguno por defecto: el mas viejo pasa a serlo.
    IF NOT EXISTS (
      SELECT 1 FROM public.availability_schedules
      WHERE user_id = p_user_id AND deleted_at IS NULL AND is_default
    ) THEN
      UPDATE public.availability_schedules SET is_default = true WHERE id = v_existing;
      UPDATE public.scheduling_profiles SET default_schedule_id = v_existing
      WHERE workspace_id = p_workspace_id AND user_id = p_user_id;
    END IF;
    RETURN v_existing;
  END IF;

  SELECT timezone INTO v_tz FROM public.scheduling_profiles
  WHERE workspace_id = p_workspace_id AND user_id = p_user_id;
  IF v_tz IS NULL THEN
    SELECT timezone INTO v_tz FROM public.workspaces WHERE id = p_workspace_id;
  END IF;

  INSERT INTO public.availability_schedules (workspace_id, user_id, name, timezone, is_default, weekly_hours, date_overrides)
  VALUES (
    p_workspace_id, p_user_id, 'Horario normal', COALESCE(v_tz, 'America/Costa_Rica'), true,
    '{"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}]}'::jsonb,
    '[]'::jsonb
  )
  RETURNING id INTO v_id;

  UPDATE public.scheduling_profiles SET default_schedule_id = v_id
  WHERE workspace_id = p_workspace_id AND user_id = p_user_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_default_schedule(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_default_schedule(uuid, uuid) TO authenticated, service_role;

-- Backfill: los perfiles creados con la 00095 todavia no tienen horario.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT workspace_id, user_id FROM public.scheduling_profiles LOOP
    PERFORM public.ensure_default_schedule(r.workspace_id, r.user_id);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 5. Purga de borrados logicos (30 dias)
-- ------------------------------------------------------------
-- Copia de la definicion vigente mas las dos tablas nuevas. El resultado
-- conserva las claves de siempre y suma las nuevas.

CREATE OR REPLACE FUNCTION public.purge_soft_deleted(p_retention_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cutoff     timestamptz := now() - make_interval(days => GREATEST(p_retention_days, 0));
  v_contacts   integer := 0;
  v_notes      integer := 0;
  v_convs      integer := 0;
  v_templates  integer := 0;
  v_schedules  integer := 0;
  v_ooo        integer := 0;
BEGIN
  DELETE FROM public.contacts WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_contacts = ROW_COUNT;

  DELETE FROM public.conversations WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_convs = ROW_COUNT;

  DELETE FROM public.contact_notes WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_notes = ROW_COUNT;

  DELETE FROM public.response_templates WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_templates = ROW_COUNT;

  DELETE FROM public.availability_schedules WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_schedules = ROW_COUNT;

  DELETE FROM public.out_of_office WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_ooo = ROW_COUNT;

  RETURN jsonb_build_object(
    'cutoff', v_cutoff,
    'contacts', v_contacts,
    'conversations', v_convs,
    'contact_notes', v_notes,
    'response_templates', v_templates,
    'availability_schedules', v_schedules,
    'out_of_office', v_ooo
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_soft_deleted(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_soft_deleted(integer) TO service_role;
