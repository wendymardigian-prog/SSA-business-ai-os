-- ============================================================================
-- 00098 — Tipos de evento (Etapa 4, Bloque 3, F16)
-- ============================================================================
--  1. event_types (§9.3 completa): el anfitrion es `owner_user_id` (no se crea
--     `event_type_hosts` en esta etapa), los calendarios de conflicto son una
--     lista de ids, el formulario y los mensajes de "no se puede agendar" van
--     en jsonb.
--  2. flows.event_type_id y flows.template_key (para los flujos por evento, B7).
--  3. workspaces.scheduling_auto_create_flows y scheduling_public_base_url.
--  4. Los eventos entran en la purga de borrados logicos, SALVO los que tienen
--     agendas (§16: "los eventos con agendas se conservan"). Como `bookings`
--     llega en la 00099, la condicion se escribe con to_regclass para que la
--     funcion valga antes y despues.
--
-- Idempotente y aditiva.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.event_types (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  category_id                 uuid NOT NULL REFERENCES public.booking_categories(id),
  owner_user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title                       text NOT NULL,
  slug                        text NOT NULL,
  description_md              text,
  duration_minutes            integer NOT NULL DEFAULT 30,
  color                       text,
  location_type               text NOT NULL DEFAULT 'google_meet',
  location_text               text,
  hide_location_until_booked  boolean NOT NULL DEFAULT false,
  status                      text NOT NULL DEFAULT 'inactive',
  -- Hoy siempre 'individual'. La fase de equipos suma round_robin y collective.
  scheduling_type             text NOT NULL DEFAULT 'individual',
  -- null = usa el horario por defecto de la persona.
  schedule_id                 uuid REFERENCES public.availability_schedules(id) ON DELETE SET NULL,
  -- null = usa el calendario destino del perfil.
  destination_calendar_id     uuid REFERENCES public.calendars(id) ON DELETE SET NULL,
  -- vacio = usa los calendarios de conflicto del perfil.
  conflict_calendar_ids       uuid[] NOT NULL DEFAULT '{}',
  before_buffer_minutes       integer NOT NULL DEFAULT 0,
  after_buffer_minutes        integer NOT NULL DEFAULT 0,
  minimum_notice_minutes      integer NOT NULL DEFAULT 120,
  -- null = igual a la duracion.
  slot_interval_minutes       integer,
  max_per_day                 integer,
  max_per_week                integer,
  period_type                 text NOT NULL DEFAULT 'rolling_calendar',
  period_days                 integer DEFAULT 60,
  period_start_date           date,
  period_end_date             date,
  contact_assignment          text NOT NULL DEFAULT 'none',
  success_redirect_url        text,
  redirect_with_params        boolean NOT NULL DEFAULT false,
  -- Reservada: sin limites para cancelar ni reagendar en esta etapa (F30 se elimino).
  change_min_notice_minutes   integer,
  booking_fields              jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- null = los textos por defecto (F58).
  unavailable_messages        jsonb,
  deleted_at                  timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.event_types IS
  'Los tipos de llamada que se pueden agendar. El anfitrion es owner_user_id; los eventos de equipo llegan en la fase futura.';
COMMENT ON COLUMN public.event_types.conflict_calendar_ids IS
  'Calendarios de conflicto propios del evento. Vacio = los del perfil. Los ids inactivos se ignoran al leer.';
COMMENT ON COLUMN public.event_types.booking_fields IS
  'Formulario de reserva (F20), validado con Zod: [{id, type, system, label, visibility, options?, identifier, ...}].';
COMMENT ON COLUMN public.event_types.unavailable_messages IS
  'Que ve el invitado cuando no puede agendar (F58). null = textos por defecto.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_types_status_check') THEN
    ALTER TABLE public.event_types ADD CONSTRAINT event_types_status_check
      CHECK (status IN ('active', 'hidden', 'inactive'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_types_location_check') THEN
    ALTER TABLE public.event_types ADD CONSTRAINT event_types_location_check
      CHECK (location_type IN ('google_meet', 'manual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_types_scheduling_type_check') THEN
    ALTER TABLE public.event_types ADD CONSTRAINT event_types_scheduling_type_check
      CHECK (scheduling_type IN ('individual', 'round_robin', 'collective'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_types_period_check') THEN
    ALTER TABLE public.event_types ADD CONSTRAINT event_types_period_check
      CHECK (period_type IN ('rolling_calendar', 'rolling_business', 'range', 'unlimited'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_types_assignment_check') THEN
    ALTER TABLE public.event_types ADD CONSTRAINT event_types_assignment_check
      CHECK (contact_assignment IN ('none', 'setter_if_empty', 'vendedor_if_empty'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_types_duration_check') THEN
    ALTER TABLE public.event_types ADD CONSTRAINT event_types_duration_check
      CHECK (duration_minutes BETWEEN 5 AND 480);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_types_slug_check') THEN
    ALTER TABLE public.event_types ADD CONSTRAINT event_types_slug_check
      CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 60);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_types_booking_fields_array') THEN
    ALTER TABLE public.event_types ADD CONSTRAINT event_types_booking_fields_array
      CHECK (jsonb_typeof(booking_fields) = 'array');
  END IF;
END $$;

-- El slug es unico por PERSONA (no por workspace): dos personas pueden tener
-- "llamada" y sus links no chocan porque llevan el usuario adelante.
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_types_owner_slug
  ON public.event_types (owner_user_id, slug)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_event_types_ws_status
  ON public.event_types (workspace_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_event_types_owner
  ON public.event_types (owner_user_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_event_types_category
  ON public.event_types (workspace_id, category_id)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.event_types;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.event_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.event_types ENABLE ROW LEVEL SECURITY;

-- Lectura: todos los miembros (hace falta para elegir eventos en los flows y
-- en el agendar manual). La lectura PUBLICA no pasa por aca: la hace el
-- servidor con service role y campos filtrados (§15: no hay policy para anon).
DROP POLICY IF EXISTS "event_types_select" ON public.event_types;
CREATE POLICY "event_types_select" ON public.event_types
  FOR SELECT USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "event_types_insert" ON public.event_types;
CREATE POLICY "event_types_insert" ON public.event_types
  FOR INSERT WITH CHECK (public.scheduling_can_manage(workspace_id, owner_user_id));

DROP POLICY IF EXISTS "event_types_update" ON public.event_types;
CREATE POLICY "event_types_update" ON public.event_types
  FOR UPDATE USING (public.scheduling_can_manage(workspace_id, owner_user_id))
  WITH CHECK (public.scheduling_can_manage(workspace_id, owner_user_id));

-- ------------------------------------------------------------
-- flows y workspaces
-- ------------------------------------------------------------

ALTER TABLE public.flows ADD COLUMN IF NOT EXISTS event_type_id uuid REFERENCES public.event_types(id) ON DELETE SET NULL;
ALTER TABLE public.flows ADD COLUMN IF NOT EXISTS template_key text;

COMMENT ON COLUMN public.flows.event_type_id IS
  'El evento de agenda al que pertenece este flujo (F48, F49). null = flujo general.';
COMMENT ON COLUMN public.flows.template_key IS
  'Cual de las 7 plantillas precreadas es (F49): confirmation, reminder_24h, ...';

CREATE INDEX IF NOT EXISTS idx_flows_event_type ON public.flows (event_type_id) WHERE event_type_id IS NOT NULL;

ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS scheduling_auto_create_flows boolean NOT NULL DEFAULT true;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS scheduling_public_base_url text;

COMMENT ON COLUMN public.workspaces.scheduling_auto_create_flows IS
  'Crear los 7 flujos sugeridos (apagados) al crear un evento (F49).';
COMMENT ON COLUMN public.workspaces.scheduling_public_base_url IS
  'Dominio propio de las paginas publicas de agenda (F42). null = NEXT_PUBLIC_APP_URL.';

-- ------------------------------------------------------------
-- Purga: los eventos borrados, salvo los que tienen agendas
-- ------------------------------------------------------------

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
  v_events     integer := 0;
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

  -- Un evento con agendas NO se purga: la agenda guarda su historia y apunta
  -- al evento. (bookings llega en la 00099; antes de eso la condicion de
  -- existencia da falso y se purgan todos los borrados.)
  IF to_regclass('public.bookings') IS NULL THEN
    DELETE FROM public.event_types WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  ELSE
    EXECUTE '
      DELETE FROM public.event_types e
      WHERE e.deleted_at IS NOT NULL AND e.deleted_at < $1
        AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.event_type_id = e.id)
    ' USING v_cutoff;
  END IF;
  GET DIAGNOSTICS v_events = ROW_COUNT;

  RETURN jsonb_build_object(
    'cutoff', v_cutoff,
    'contacts', v_contacts,
    'conversations', v_convs,
    'contact_notes', v_notes,
    'response_templates', v_templates,
    'availability_schedules', v_schedules,
    'out_of_office', v_ooo,
    'event_types', v_events
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_soft_deleted(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_soft_deleted(integer) TO service_role;
