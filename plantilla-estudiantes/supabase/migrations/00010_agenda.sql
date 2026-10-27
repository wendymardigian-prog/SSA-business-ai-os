-- ============================================================================
-- Agenda
--
-- Agendamiento: areas y tipos de reunion, horarios de disponibilidad, calendarios de
-- Google de cada persona, perfiles de agenda, tipos de evento, reuniones y tiempo fuera.
--
-- La doble reserva la evita la base, con una restriccion de exclusion por anfitrion y
-- horario. Cancelar es un estado: una reunion nunca se borra.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tablas
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.availability_schedules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  timezone text NOT NULL,
  is_default boolean DEFAULT false NOT NULL,
  weekly_hours jsonb DEFAULT '{}'::jsonb NOT NULL,
  date_overrides jsonb DEFAULT '[]'::jsonb NOT NULL,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT availability_schedules_pkey PRIMARY KEY (id),
  CONSTRAINT availability_schedules_date_overrides_array CHECK ((jsonb_typeof(date_overrides) = 'array'::text)),
  CONSTRAINT availability_schedules_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 60))),
  CONSTRAINT availability_schedules_weekly_hours_object CHECK ((jsonb_typeof(weekly_hours) = 'object'::text)),
  CONSTRAINT availability_schedules_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT availability_schedules_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.availability_schedules ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.availability_schedules IS 'Horarios de disponibilidad de cada persona. Las reglas van en hora local + la zona del horario; el motor las convierte a UTC.';
COMMENT ON COLUMN public.availability_schedules.weekly_hours IS 'Rangos por dia de la semana (clave 0=domingo..6=sabado). Dia ausente o vacio = no trabaja. Validado con Zod en la Server Action.';
COMMENT ON COLUMN public.availability_schedules.date_overrides IS 'Excepciones por fecha: reemplazan la regla semanal de ese dia. ranges vacio = no disponible todo el dia.';

CREATE TABLE IF NOT EXISTS public.booking_categories (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  parent_id uuid,
  name text NOT NULL,
  color text,
  "position" integer DEFAULT 0 NOT NULL,
  is_system boolean DEFAULT false NOT NULL,
  archived_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT booking_categories_pkey PRIMARY KEY (id),
  CONSTRAINT booking_categories_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 40))),
  CONSTRAINT booking_categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.booking_categories(id) ON DELETE CASCADE,
  CONSTRAINT booking_categories_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.booking_categories ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.booking_categories IS 'Areas (parent_id null) y tipos (con parent_id) con los que se clasifican eventos y agendas. Maximo dos niveles.';
COMMENT ON COLUMN public.booking_categories.is_system IS 'Ventas, Servicio, Equipo y Otros vienen precargadas: se renombran pero no se archivan.';

CREATE TABLE IF NOT EXISTS public.calendars (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  user_id uuid NOT NULL,
  external_calendar_id text NOT NULL,
  name text NOT NULL,
  color text,
  access_role text NOT NULL,
  is_primary boolean DEFAULT false NOT NULL,
  check_conflicts boolean DEFAULT false NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  push_channel_id text,
  push_channel_expires_at timestamp with time zone,
  sync_token text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT calendars_pkey PRIMARY KEY (id),
  CONSTRAINT calendars_access_role_check CHECK ((access_role = ANY (ARRAY['owner'::text, 'writer'::text, 'reader'::text, 'freeBusyReader'::text]))),
  CONSTRAINT calendars_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.oauth_connections(id) ON DELETE CASCADE,
  CONSTRAINT calendars_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT calendars_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.calendars ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.calendars IS 'Los calendarios de cada cuenta de Google conectada por una persona. check_conflicts = se leen sus horarios ocupados; is_active = sigue existiendo en la cuenta.';

CREATE TABLE IF NOT EXISTS public.event_types (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  category_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  title text NOT NULL,
  slug text NOT NULL,
  description_md text,
  duration_minutes integer DEFAULT 30 NOT NULL,
  color text,
  location_type text DEFAULT 'google_meet'::text NOT NULL,
  location_text text,
  hide_location_until_booked boolean DEFAULT false NOT NULL,
  status text DEFAULT 'inactive'::text NOT NULL,
  scheduling_type text DEFAULT 'individual'::text NOT NULL,
  schedule_id uuid,
  destination_calendar_id uuid,
  conflict_calendar_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  before_buffer_minutes integer DEFAULT 0 NOT NULL,
  after_buffer_minutes integer DEFAULT 0 NOT NULL,
  minimum_notice_minutes integer DEFAULT 120 NOT NULL,
  slot_interval_minutes integer,
  max_per_day integer,
  max_per_week integer,
  period_type text DEFAULT 'rolling_calendar'::text NOT NULL,
  period_days integer DEFAULT 60,
  period_start_date date,
  period_end_date date,
  contact_assignment text DEFAULT 'none'::text NOT NULL,
  success_redirect_url text,
  redirect_with_params boolean DEFAULT false NOT NULL,
  change_min_notice_minutes integer,
  booking_fields jsonb DEFAULT '[]'::jsonb NOT NULL,
  unavailable_messages jsonb,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT event_types_pkey PRIMARY KEY (id),
  CONSTRAINT event_types_assignment_check CHECK ((contact_assignment = ANY (ARRAY['none'::text, 'setter_if_empty'::text, 'vendedor_if_empty'::text]))),
  CONSTRAINT event_types_booking_fields_array CHECK ((jsonb_typeof(booking_fields) = 'array'::text)),
  CONSTRAINT event_types_duration_check CHECK (((duration_minutes >= 5) AND (duration_minutes <= 480))),
  CONSTRAINT event_types_location_check CHECK ((location_type = ANY (ARRAY['google_meet'::text, 'manual'::text]))),
  CONSTRAINT event_types_period_check CHECK ((period_type = ANY (ARRAY['rolling_calendar'::text, 'rolling_business'::text, 'range'::text, 'unlimited'::text]))),
  CONSTRAINT event_types_scheduling_type_check CHECK ((scheduling_type = ANY (ARRAY['individual'::text, 'round_robin'::text, 'collective'::text]))),
  CONSTRAINT event_types_slug_check CHECK (((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND (char_length(slug) <= 60))),
  CONSTRAINT event_types_status_check CHECK ((status = ANY (ARRAY['active'::text, 'hidden'::text, 'inactive'::text]))),
  CONSTRAINT event_types_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.booking_categories(id),
  CONSTRAINT event_types_destination_calendar_id_fkey FOREIGN KEY (destination_calendar_id) REFERENCES public.calendars(id) ON DELETE SET NULL,
  CONSTRAINT event_types_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT event_types_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.availability_schedules(id) ON DELETE SET NULL,
  CONSTRAINT event_types_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.event_types ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.event_types IS 'Los tipos de llamada que se pueden agendar. El anfitrion es owner_user_id.';
COMMENT ON COLUMN public.event_types.conflict_calendar_ids IS 'Calendarios de conflicto propios del evento. Vacio = los del perfil. Los ids inactivos se ignoran al leer.';
COMMENT ON COLUMN public.event_types.booking_fields IS 'Formulario de reserva, validado con Zod: [{id, type, system, label, visibility, options?, identifier, ...}].';
COMMENT ON COLUMN public.event_types.unavailable_messages IS 'Que ve el invitado cuando no puede agendar. null = textos por defecto.';

CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  uid text NOT NULL,
  event_type_id uuid NOT NULL,
  category_id uuid,
  category_snapshot jsonb,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  host_user_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  title text NOT NULL,
  start_at timestamp with time zone NOT NULL,
  end_at timestamp with time zone NOT NULL,
  status text DEFAULT 'scheduled'::text NOT NULL,
  status_changed_at timestamp with time zone,
  status_changed_by uuid,
  booker_name text,
  booker_email text,
  booker_phone text,
  booker_timezone text,
  host_timezone text,
  location_type text,
  location_text text,
  meet_url text,
  responses jsonb DEFAULT '{}'::jsonb NOT NULL,
  origin text DEFAULT 'public_page'::text NOT NULL,
  utm jsonb DEFAULT '{}'::jsonb NOT NULL,
  referrer_url text,
  created_by uuid,
  reschedule_count integer DEFAULT 0 NOT NULL,
  cancelled_at timestamp with time zone,
  cancelled_by_type text,
  cancelled_by_user_id uuid,
  cancellation_reason text,
  internal_notes text,
  google_sync_status text DEFAULT 'pending'::text NOT NULL,
  google_sync_error text,
  google_connection_id uuid,
  google_calendar_id uuid,
  google_event_id text,
  ical_uid text,
  google_event_deleted_at timestamp with time zone,
  is_do_not_contact_at_booking boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  status_group text GENERATED ALWAYS AS (
CASE
    WHEN (status = ANY (ARRAY['scheduled'::text, 'confirmed'::text, 'rescheduled'::text])) THEN 'active'::text
    WHEN (status = 'no_show'::text) THEN 'no_show'::text
    WHEN (status = ANY (ARRAY['followup_warm'::text, 'followup_cold'::text, 'sale'::text, 'not_qualified'::text])) THEN 'outcome'::text
    ELSE 'cancelled'::text
END) STORED,
  slot_released_at timestamp with time zone,
  slot_released_by uuid,
  google_host_connection_id uuid,
  google_host_calendar_id uuid,
  CONSTRAINT bookings_pkey PRIMARY KEY (id),
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (host_user_id WITH =, tstzrange(start_at, end_at) WITH &&) WHERE (((status = ANY (ARRAY['scheduled'::text, 'confirmed'::text, 'rescheduled'::text])) AND (slot_released_at IS NULL))),
  CONSTRAINT bookings_cancelled_by_check CHECK (((cancelled_by_type IS NULL) OR (cancelled_by_type = ANY (ARRAY['invitee'::text, 'host'::text, 'system'::text])))),
  CONSTRAINT bookings_origin_check CHECK ((origin = ANY (ARRAY['public_page'::text, 'embed'::text, 'manual'::text, 'agent'::text, 'api'::text]))),
  CONSTRAINT bookings_range_check CHECK ((end_at > start_at)),
  CONSTRAINT bookings_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'confirmed'::text, 'rescheduled'::text, 'no_show'::text, 'followup_warm'::text, 'followup_cold'::text, 'sale'::text, 'not_qualified'::text, 'cancelled_not_qualified'::text, 'cancelled_no_response'::text, 'cancelled_other'::text]))),
  CONSTRAINT bookings_sync_status_check CHECK ((google_sync_status = ANY (ARRAY['pending'::text, 'synced'::text, 'failed'::text, 'not_applicable'::text]))),
  CONSTRAINT bookings_cancelled_by_user_id_fkey FOREIGN KEY (cancelled_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT bookings_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.booking_categories(id),
  CONSTRAINT bookings_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
  CONSTRAINT bookings_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT bookings_event_type_id_fkey FOREIGN KEY (event_type_id) REFERENCES public.event_types(id),
  CONSTRAINT bookings_google_calendar_id_fkey FOREIGN KEY (google_calendar_id) REFERENCES public.calendars(id) ON DELETE SET NULL,
  CONSTRAINT bookings_google_connection_id_fkey FOREIGN KEY (google_connection_id) REFERENCES public.oauth_connections(id) ON DELETE SET NULL,
  CONSTRAINT bookings_google_host_calendar_id_fkey FOREIGN KEY (google_host_calendar_id) REFERENCES public.calendars(id) ON DELETE SET NULL,
  CONSTRAINT bookings_google_host_connection_id_fkey FOREIGN KEY (google_host_connection_id) REFERENCES public.oauth_connections(id) ON DELETE SET NULL,
  CONSTRAINT bookings_host_user_id_fkey FOREIGN KEY (host_user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT bookings_slot_released_by_fkey FOREIGN KEY (slot_released_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT bookings_status_changed_by_fkey FOREIGN KEY (status_changed_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT bookings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.bookings IS 'Una fila por reunion agendada. No se borran: cancelar es un estado. El historial vive en audit_log con entity_type = booking.';
COMMENT ON COLUMN public.bookings.uid IS 'Token publico de 22 caracteres (unos 131 bits): con el se cancela y se reagenda sin sesion. Nunca se le entrega al agente de IA.';
COMMENT ON COLUMN public.bookings.status_group IS 'Calculada desde status. active / no_show / outcome / cancelled. Solo las active ocupan el horario.';

CREATE TABLE IF NOT EXISTS public.out_of_office (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  starts_at timestamp with time zone NOT NULL,
  ends_at timestamp with time zone NOT NULL,
  all_day boolean DEFAULT true NOT NULL,
  reason text DEFAULT 'other'::text NOT NULL,
  note text,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT out_of_office_pkey PRIMARY KEY (id),
  CONSTRAINT out_of_office_range_check CHECK ((ends_at > starts_at)),
  CONSTRAINT out_of_office_reason_check CHECK ((reason = ANY (ARRAY['vacation'::text, 'travel'::text, 'sick'::text, 'other'::text]))),
  CONSTRAINT out_of_office_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT out_of_office_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.out_of_office ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.out_of_office IS 'Tiempo fuera de una persona (vacaciones, viajes). Bloquea todos sus horarios y eventos. Instantes en UTC.';

CREATE TABLE IF NOT EXISTS public.scheduling_profiles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  username text NOT NULL,
  display_name text NOT NULL,
  avatar_url text,
  timezone text NOT NULL,
  time_format text DEFAULT '24h'::text NOT NULL,
  welcome_message text,
  default_schedule_id uuid,
  default_destination_calendar_id uuid,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT scheduling_profiles_pkey PRIMARY KEY (id),
  CONSTRAINT scheduling_profiles_time_format_check CHECK ((time_format = ANY (ARRAY['12h'::text, '24h'::text]))),
  CONSTRAINT scheduling_profiles_username_check CHECK ((username ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'::text)),
  CONSTRAINT scheduling_profiles_default_destination_fk FOREIGN KEY (default_destination_calendar_id) REFERENCES public.calendars(id) ON DELETE SET NULL,
  CONSTRAINT scheduling_profiles_default_schedule_fk FOREIGN KEY (default_schedule_id) REFERENCES public.availability_schedules(id) ON DELETE SET NULL,
  CONSTRAINT scheduling_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT scheduling_profiles_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.scheduling_profiles ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.scheduling_profiles IS 'El perfil de agenda de cada persona: usuario de los links, zona horaria, formato de hora, horario y calendario destino por defecto.';
COMMENT ON COLUMN public.scheduling_profiles.username IS 'Slug de 3 a 40 caracteres, unico en el workspace sin distinguir mayusculas. Palabras reservadas: agenda, embed, api, equipo, admin.';

-- ----------------------------------------------------------------------------
-- Claves foraneas hacia tablas de esta area
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  ALTER TABLE public.flows ADD CONSTRAINT flows_event_type_id_fkey FOREIGN KEY (event_type_id) REFERENCES public.event_types(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Funciones
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.booking_categories_two_levels()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_grandparent uuid; v_parent_ws uuid;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT parent_id, workspace_id INTO v_grandparent, v_parent_ws
  FROM public.booking_categories WHERE id = NEW.parent_id;

  IF v_parent_ws IS NULL THEN
    RAISE EXCEPTION 'la categoria padre no existe';
  END IF;
  IF v_parent_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'la categoria padre es de otro negocio';
  END IF;
  IF v_grandparent IS NOT NULL THEN
    RAISE EXCEPTION 'solo hay dos niveles: un tipo no puede tener tipos adentro';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.booking_utm_options(p_workspace_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'sources',   coalesce((SELECT jsonb_agg(DISTINCT v ORDER BY v) FROM public.bookings b, lateral (SELECT b.utm ->> 'utm_source' AS v) s WHERE b.workspace_id = p_workspace_id AND s.v IS NOT NULL), '[]'::jsonb),
    'mediums',   coalesce((SELECT jsonb_agg(DISTINCT v ORDER BY v) FROM public.bookings b, lateral (SELECT b.utm ->> 'utm_medium' AS v) s WHERE b.workspace_id = p_workspace_id AND s.v IS NOT NULL), '[]'::jsonb),
    'campaigns', coalesce((SELECT jsonb_agg(DISTINCT v ORDER BY v) FROM public.bookings b, lateral (SELECT b.utm ->> 'utm_campaign' AS v) s WHERE b.workspace_id = p_workspace_id AND s.v IS NOT NULL), '[]'::jsonb)
  )
$function$;
REVOKE ALL ON FUNCTION public.booking_utm_options(p_workspace_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.can_see_booking(b public.bookings)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT public.is_workspace_member(b.workspace_id)
     AND (
       public.is_workspace_admin(b.workspace_id)
       OR b.host_user_id = auth.uid()
       OR EXISTS (
         SELECT 1
           FROM public.contacts c
          WHERE c.id = b.contact_id
            AND c.workspace_id = b.workspace_id
            AND c.setter_id = auth.uid()
            AND c.deleted_at IS NULL
       )
       OR (
         public.has_permission(b.workspace_id, 'bookings.view')
         AND public.permission_scope(b.workspace_id, 'bookings') = 'all'
       )
     );
$function$;
REVOKE ALL ON FUNCTION public.can_see_booking(b public.bookings) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.create_booking(p_workspace_id uuid, p_event_type_id uuid, p_host_user_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_title text, p_name text, p_email text, p_phone text, p_timezone text, p_host_timezone text, p_location_type text, p_location_text text, p_responses jsonb, p_origin text, p_utm jsonb, p_referrer_url text, p_uid text, p_category_id uuid, p_category_snapshot jsonb, p_contact_assignment text, p_created_by uuid DEFAULT NULL::uuid, p_contact_id uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT '{}'::jsonb, p_landing_page text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_contact_id   uuid := p_contact_id;
  v_created      boolean := false;
  v_booking_id   uuid;
  v_email        text := public.normalize_email(p_email);
  v_phone        text := nullif(btrim(p_phone), '');
  v_nphone       text := public.normalize_phone(p_phone);
  v_central      jsonb;
  v_dnc          boolean := false;
  v_setter       uuid;
  v_vendedor     uuid;
  v_assigned     boolean := false;
BEGIN
  -- Serializa los pedidos del mismo anfitrion dentro de la transaccion.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_host_user_id::text, 0));

  -- a. El contacto. Si viene dado (agendar manual, agente), se usa tal cual. Si no, la regla central
  -- (find_or_create_contact): busca por telefono y email y, si no esta, lo crea, con bloqueo por dato (dos reservas
  -- simultaneas de la misma persona dan UN contacto). Sin email ni telefono NO se crea nada: la reserva
  -- se rechaza con el codigo CB001 (createBooking lo traduce a "Necesitamos un email o un telefono").
  IF v_contact_id IS NULL THEN
    v_central := public.find_or_create_contact(
      p_workspace_id,
      jsonb_build_object('phone', p_phone, 'email', p_email),
      jsonb_strip_nulls(jsonb_build_object(
        'display_name', nullif(btrim(p_name), ''),
        'timezone', nullif(p_timezone, ''),
        'attribution', coalesce(p_utm, '{}'::jsonb) || jsonb_build_object('source', 'scheduling', 'referrer', p_referrer_url),
        'last_interaction_at', now()
      )),
      'create'
    );
    IF v_central ->> 'status' = 'no_identity' THEN
      RAISE EXCEPTION 'Necesitamos un email o un telefono para agendar' USING ERRCODE = 'CB001';
    END IF;
    v_contact_id := (v_central ->> 'contact_id')::uuid;
    v_created := (v_central ->> 'created')::boolean;
  END IF;

  -- Completa SOLO los campos vacios: nunca pisa lo que ya hay. Un telefono o email que ya es de OTRO
  -- contacto no se escribe en este.
  IF NOT v_created THEN
    UPDATE public.contacts
    SET display_name = coalesce(display_name, nullif(btrim(p_name), '')),
        email        = CASE WHEN private.contact_value_taken(p_workspace_id, v_contact_id, 'email', v_email) THEN email ELSE coalesce(email, v_email) END,
        phone        = CASE WHEN private.contact_value_taken(p_workspace_id, v_contact_id, 'phone', v_nphone) THEN phone ELSE coalesce(phone, v_nphone) END,
        timezone     = coalesce(timezone, nullif(p_timezone, '')),
        last_interaction_at = now()
    WHERE id = v_contact_id;
  END IF;

  SELECT do_not_contact, setter_id, vendedor_id INTO v_dnc, v_setter, v_vendedor
  FROM public.contacts WHERE id = v_contact_id;

  -- b. La asignacion: solo si el campo esta vacio. El UPDATE dispara el
  -- disparador de contacts que emite assignment_changed en automation_events.
  IF p_contact_assignment = 'setter_if_empty' AND v_setter IS NULL THEN
    UPDATE public.contacts SET setter_id = p_host_user_id WHERE id = v_contact_id;
    v_assigned := true;
  ELSIF p_contact_assignment = 'vendedor_if_empty' AND v_vendedor IS NULL THEN
    UPDATE public.contacts SET vendedor_id = p_host_user_id WHERE id = v_contact_id;
    v_assigned := true;
  END IF;

  -- c. La agenda.
  INSERT INTO public.bookings (
    workspace_id, uid, event_type_id, category_id, category_snapshot, metadata,
    host_user_id, contact_id, title, start_at, end_at, status,
    booker_name, booker_email, booker_phone, booker_timezone, host_timezone,
    location_type, location_text, responses, origin, utm, referrer_url,
    created_by, is_do_not_contact_at_booking, google_sync_status
  ) VALUES (
    p_workspace_id, p_uid, p_event_type_id, p_category_id, p_category_snapshot, coalesce(p_metadata, '{}'::jsonb),
    p_host_user_id, v_contact_id, p_title, p_start_at, p_end_at, 'scheduled',
    nullif(btrim(p_name), ''), v_email, v_phone, nullif(p_timezone, ''), nullif(p_host_timezone, ''),
    p_location_type, p_location_text, coalesce(p_responses, '{}'::jsonb), p_origin,
    coalesce(p_utm, '{}'::jsonb), p_referrer_url,
    p_created_by, coalesce(v_dnc, false), 'pending'
  )
  RETURNING id INTO v_booking_id;

  -- c2. El toque de atribucion. Vale para el
  -- contacto nuevo Y para el que ya existia: una reserva es una interaccion
  -- mas de esa persona. NO se registra para 'manual' ni 'agent': ahi no hay
  -- forma de saber de donde vino el lead, y un toque `web/booking` inventado
  -- pisaria el toque real (el DM o el comentario que lo trajo).
  -- Va protegido: una falla de atribucion NUNCA puede impedir una reserva.
  IF p_origin NOT IN ('manual', 'agent') THEN
    BEGIN
      PERFORM public.record_contact_touch(
        p_workspace_id,
        v_contact_id,
        jsonb_build_object(
          'occurred_at',  now(),
          'source',       coalesce(nullif(lower(btrim(p_utm->>'utm_source')), ''), 'web'),
          'medium',       'booking',
          'campaign',     nullif(btrim(p_utm->>'utm_campaign'), ''),
          'content',      nullif(btrim(p_utm->>'utm_content'), ''),
          'term',         nullif(btrim(p_utm->>'utm_term'), ''),
          'fbclid',       nullif(btrim(p_utm->>'fbclid'), ''),
          'gclid',        nullif(btrim(p_utm->>'gclid'), ''),
          'ttclid',       nullif(btrim(p_utm->>'ttclid'), ''),
          'li_fat_id',    nullif(btrim(p_utm->>'li_fat_id'), ''),
          'ad_id',        nullif(btrim(p_utm->>'ad_id'), ''),
          'adset_id',     nullif(btrim(p_utm->>'adset_id'), ''),
          'campaign_id',  nullif(btrim(p_utm->>'campaign_id'), ''),
          'referrer_url', nullif(btrim(p_referrer_url), ''),
          'landing_page', nullif(btrim(p_landing_page), ''),
          'origin',       'booking',
          'dedupe_key',   'booking:' || v_booking_id::text,
          'raw',          jsonb_build_object('utm', coalesce(p_utm, '{}'::jsonb), 'booking_origin', p_origin)
                          || jsonb_strip_nulls(jsonb_build_object(
                               'utm_id',       nullif(btrim(p_utm->>'utm_id'), ''),
                               'placement',    nullif(btrim(p_utm->>'placement'), ''),
                               'fbp',          nullif(btrim(p_utm->>'fbp'), ''),
                               'fbc',          nullif(btrim(p_utm->>'fbc'), ''),
                               'ga_client_id', nullif(btrim(p_utm->>'ga_client_id'), ''),
                               'first_visit',  CASE WHEN jsonb_typeof(p_utm->'first_visit') = 'object' THEN p_utm->'first_visit' END))
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'create_booking: no pude registrar el toque de atribucion: %', SQLERRM;
    END;
  END IF;

  -- d. El historial.
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (
    p_workspace_id, 'booking', v_booking_id, 'booking.created',
    jsonb_build_object('start_at', p_start_at, 'end_at', p_end_at),
    jsonb_build_object('origin', p_origin, 'actor_type', CASE WHEN p_created_by IS NULL THEN 'invitee' ELSE 'user' END),
    p_created_by
  );

  -- e. El evento de automatizacion.
  INSERT INTO public.automation_events (workspace_id, event_type, contact_id, payload)
  VALUES (
    p_workspace_id, 'booking_created', v_contact_id,
    jsonb_build_object(
      'booking_id', v_booking_id,
      'event_type_id', p_event_type_id,
      'host_user_id', p_host_user_id,
      'origin', p_origin
    )
  );

  -- f. Los jobs: crear el evento en Google y avisar cuando la agenda termine.
  INSERT INTO public.scheduled_jobs (type, payload, run_at, status)
  VALUES (
    'booking_google_sync',
    jsonb_build_object('booking_id', v_booking_id, 'action', 'create', 'attempt', 0),
    now(), 'pending'
  );
  INSERT INTO public.scheduled_jobs (type, payload, run_at, status, dedupe_key)
  VALUES (
    'booking_ended',
    jsonb_build_object('booking_id', v_booking_id),
    p_end_at, 'pending', 'ended:' || v_booking_id::text || ':0'
  );

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'contact_id', v_contact_id,
    'created_contact', v_created,
    'assignment_changed', v_assigned,
    'do_not_contact', coalesce(v_dnc, false)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.create_booking(p_workspace_id uuid, p_event_type_id uuid, p_host_user_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_title text, p_name text, p_email text, p_phone text, p_timezone text, p_host_timezone text, p_location_type text, p_location_text text, p_responses jsonb, p_origin text, p_utm jsonb, p_referrer_url text, p_uid text, p_category_id uuid, p_category_snapshot jsonb, p_contact_assignment text, p_created_by uuid, p_contact_id uuid, p_metadata jsonb, p_landing_page text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ensure_default_schedule(p_workspace_id uuid, p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.ensure_default_schedule(p_workspace_id uuid, p_user_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.scheduling_can_manage(p_workspace_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT public.is_workspace_member(p_workspace_id)
     AND (
       auth.uid() = p_user_id
       OR public.is_workspace_admin(p_workspace_id)
       OR public.has_permission(p_workspace_id, 'scheduling.manage_others')
     );
$function$;
REVOKE ALL ON FUNCTION public.scheduling_can_manage(p_workspace_id uuid, p_user_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.seed_booking_categories_for_workspace(p_workspace uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_area uuid;
  v_pos integer;
  a record;
  t text;
  t_pos integer;
BEGIN
  FOR a IN
    SELECT * FROM (VALUES
      ('Ventas',   '#2563eb', ARRAY['Triaje', 'Cierre', 'Seguimiento']),
      ('Servicio', '#0d9488', ARRAY['Onboarding', 'Uno a uno']),
      ('Equipo',   '#7c3aed', ARRAY['Reunión interna', 'Uno a uno', 'Entrevista']),
      ('Otros',    '#ca8a04', ARRAY['General'])
    ) AS x(name, color, types)
  LOOP
    SELECT id INTO v_area
    FROM public.booking_categories
    WHERE workspace_id = p_workspace AND parent_id IS NULL AND archived_at IS NULL AND lower(name) = lower(a.name)
    LIMIT 1;

    -- Ya existe (de sistema o creada por el negocio): se respeta tal cual, sin tocar sus tipos.
    IF v_area IS NOT NULL THEN
      CONTINUE;
    END IF;

    SELECT coalesce(max(position), -1) + 1 INTO v_pos
    FROM public.booking_categories
    WHERE workspace_id = p_workspace AND parent_id IS NULL;

    INSERT INTO public.booking_categories (workspace_id, name, color, position, is_system)
    VALUES (p_workspace, a.name, a.color, v_pos, true)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_area;

    IF v_area IS NULL THEN
      CONTINUE;
    END IF;

    t_pos := 0;
    FOREACH t IN ARRAY a.types LOOP
      INSERT INTO public.booking_categories (workspace_id, parent_id, name, position, is_system)
      VALUES (p_workspace, v_area, t, t_pos, true)
      ON CONFLICT DO NOTHING;
      t_pos := t_pos + 1;
    END LOOP;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.seed_booking_categories_for_workspace(p_workspace uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.seed_booking_categories()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.seed_booking_categories_for_workspace(NEW.id);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_default_schedule(p_schedule_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.set_default_schedule(p_schedule_id uuid) FROM PUBLIC, anon;

-- ----------------------------------------------------------------------------
-- Indices
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_availability_schedules_ws_user ON public.availability_schedules USING btree (workspace_id, user_id) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_booking_categories_ws ON public.booking_categories USING btree (workspace_id, parent_id, "position");

CREATE INDEX IF NOT EXISTS idx_bookings_contact_start ON public.bookings USING btree (contact_id, start_at);

CREATE INDEX IF NOT EXISTS idx_bookings_event_start ON public.bookings USING btree (event_type_id, start_at);

CREATE INDEX IF NOT EXISTS idx_bookings_host_start ON public.bookings USING btree (host_user_id, start_at);

CREATE INDEX IF NOT EXISTS idx_bookings_slot_released ON public.bookings USING btree (host_user_id, start_at) WHERE (slot_released_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_bookings_utm_campaign ON public.bookings USING btree (workspace_id, ((utm ->> 'utm_campaign'::text)), start_at);

CREATE INDEX IF NOT EXISTS idx_bookings_utm_source ON public.bookings USING btree (workspace_id, ((utm ->> 'utm_source'::text)), start_at);

CREATE INDEX IF NOT EXISTS idx_bookings_ws_category_start ON public.bookings USING btree (workspace_id, category_id, start_at);

CREATE INDEX IF NOT EXISTS idx_bookings_ws_created ON public.bookings USING btree (workspace_id, created_at);

CREATE INDEX IF NOT EXISTS idx_bookings_ws_start ON public.bookings USING btree (workspace_id, start_at);

CREATE INDEX IF NOT EXISTS idx_bookings_ws_status_start ON public.bookings USING btree (workspace_id, status, start_at);

CREATE INDEX IF NOT EXISTS idx_calendars_ws_user ON public.calendars USING btree (workspace_id, user_id, is_active);

CREATE INDEX IF NOT EXISTS idx_event_types_category ON public.event_types USING btree (workspace_id, category_id) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_event_types_owner ON public.event_types USING btree (owner_user_id) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_event_types_ws_status ON public.event_types USING btree (workspace_id, status) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_out_of_office_user_range ON public.out_of_office USING btree (user_id, starts_at, ends_at) WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_availability_schedules_default ON public.availability_schedules USING btree (user_id) WHERE (is_default AND (deleted_at IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_categories_name ON public.booking_categories USING btree (workspace_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) WHERE (archived_at IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_uid ON public.bookings USING btree (uid);

CREATE UNIQUE INDEX IF NOT EXISTS uq_calendars_connection_external ON public.calendars USING btree (connection_id, external_calendar_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_event_types_owner_slug ON public.event_types USING btree (owner_user_id, slug) WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduling_profiles_username_global ON public.scheduling_profiles USING btree (lower(username));

CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduling_profiles_ws_user ON public.scheduling_profiles USING btree (workspace_id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduling_profiles_ws_username ON public.scheduling_profiles USING btree (workspace_id, lower(username));

-- ----------------------------------------------------------------------------
-- Disparadores
-- ----------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.availability_schedules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER booking_categories_two_levels BEFORE INSERT OR UPDATE OF parent_id ON public.booking_categories FOR EACH ROW EXECUTE FUNCTION public.booking_categories_two_levels();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.booking_categories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.calendars FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.event_types FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.out_of_office FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.scheduling_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER seed_booking_categories AFTER INSERT ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.seed_booking_categories();

-- ----------------------------------------------------------------------------
-- Reglas de acceso (RLS)
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE POLICY availability_schedules_insert ON public.availability_schedules FOR INSERT TO public
    WITH CHECK (public.scheduling_can_manage(workspace_id, user_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY availability_schedules_select ON public.availability_schedules FOR SELECT TO public
    USING (public.scheduling_can_manage(workspace_id, user_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY availability_schedules_update ON public.availability_schedules FOR UPDATE TO public
    USING (public.scheduling_can_manage(workspace_id, user_id))
    WITH CHECK (public.scheduling_can_manage(workspace_id, user_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY booking_categories_insert ON public.booking_categories FOR INSERT TO public
    WITH CHECK ((public.is_workspace_admin(workspace_id) OR public.has_permission(workspace_id, 'scheduling.manage_categories'::text)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY booking_categories_select ON public.booking_categories FOR SELECT TO public
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY booking_categories_update ON public.booking_categories FOR UPDATE TO public
    USING ((public.is_workspace_admin(workspace_id) OR public.has_permission(workspace_id, 'scheduling.manage_categories'::text)))
    WITH CHECK ((public.is_workspace_admin(workspace_id) OR public.has_permission(workspace_id, 'scheduling.manage_categories'::text)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY bookings_select ON public.bookings FOR SELECT TO public
    USING (public.can_see_booking(bookings.*));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY calendars_select ON public.calendars FOR SELECT TO public
    USING (public.scheduling_can_manage(workspace_id, user_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY calendars_update_own ON public.calendars FOR UPDATE TO public
    USING (((user_id = auth.uid()) AND public.is_workspace_member(workspace_id)))
    WITH CHECK (((user_id = auth.uid()) AND public.is_workspace_member(workspace_id)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY event_types_insert ON public.event_types FOR INSERT TO public
    WITH CHECK (public.scheduling_can_manage(workspace_id, owner_user_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY event_types_select ON public.event_types FOR SELECT TO public
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY event_types_update ON public.event_types FOR UPDATE TO public
    USING (public.scheduling_can_manage(workspace_id, owner_user_id))
    WITH CHECK (public.scheduling_can_manage(workspace_id, owner_user_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY out_of_office_insert ON public.out_of_office FOR INSERT TO public
    WITH CHECK (public.scheduling_can_manage(workspace_id, user_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY out_of_office_select ON public.out_of_office FOR SELECT TO public
    USING (public.scheduling_can_manage(workspace_id, user_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY out_of_office_update ON public.out_of_office FOR UPDATE TO public
    USING (public.scheduling_can_manage(workspace_id, user_id))
    WITH CHECK (public.scheduling_can_manage(workspace_id, user_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY scheduling_profiles_insert ON public.scheduling_profiles FOR INSERT TO public
    WITH CHECK (public.scheduling_can_manage(workspace_id, user_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY scheduling_profiles_select ON public.scheduling_profiles FOR SELECT TO public
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY scheduling_profiles_update ON public.scheduling_profiles FOR UPDATE TO public
    USING (public.scheduling_can_manage(workspace_id, user_id))
    WITH CHECK (public.scheduling_can_manage(workspace_id, user_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
