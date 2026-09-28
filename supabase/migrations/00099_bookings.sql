-- ============================================================================
-- 00099 — Agendas (Etapa 4, Bloque 4a, F26)
-- ============================================================================
--  1. `bookings` (§9.4): una fila por reunion. `status_group` es una columna
--     CALCULADA (el CASE sale de groupOf() en booking-status.ts; hay un test
--     que compara las dos listas). La proteccion contra doble reserva es una
--     restriccion de EXCLUSION sobre los estados activos, que es lo unico que
--     funciona de verdad con dos pedidos simultaneos.
--  2. `rate_limits`: generica, para cualquier endpoint publico. Sin
--     workspace_id, sin policies: solo service role.
--  3. `can_see_booking(id)`: la regla de quien ve una agenda.
--  4. Una rama nueva en `audit_log_select`: el historial de la agenda es el
--     audit_log con `entity_type = 'booking'`, visible para quien ve la agenda.
--  5. `scheduled_jobs.status` suma `cancelled` (anular los jobs relativos) y
--     un indice de expresion por `payload->>'booking_id'`.
--  6. `create_booking(...)`: crea el contacto (o lo encuentra), aplica la
--     asignacion, inserta la agenda, el historial, el evento de automatizacion
--     y los jobs. Todo en UNA transaccion, con advisory lock por anfitrion.
--
-- Idempotente y aditiva.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- ------------------------------------------------------------
-- 1. bookings
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.bookings (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- 22 caracteres URL-safe: es el token secreto de cancelar y reagendar.
  uid                         text NOT NULL,
  event_type_id               uuid NOT NULL REFERENCES public.event_types(id),
  category_id                 uuid REFERENCES public.booking_categories(id),
  category_snapshot           jsonb,
  metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  host_user_id                uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id                  uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  title                       text NOT NULL,
  start_at                    timestamptz NOT NULL,
  end_at                      timestamptz NOT NULL,
  status                      text NOT NULL DEFAULT 'scheduled',
  status_changed_at           timestamptz,
  status_changed_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  booker_name                 text,
  booker_email                text,
  booker_phone                text,
  booker_timezone             text,
  host_timezone               text,
  location_type               text,
  location_text               text,
  meet_url                    text,
  responses                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  origin                      text NOT NULL DEFAULT 'public_page',
  utm                         jsonb NOT NULL DEFAULT '{}'::jsonb,
  referrer_url                text,
  created_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reschedule_count            integer NOT NULL DEFAULT 0,
  cancelled_at                timestamptz,
  cancelled_by_type           text,
  cancelled_by_user_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancellation_reason         text,
  internal_notes              text,
  google_sync_status          text NOT NULL DEFAULT 'pending',
  google_sync_error           text,
  google_connection_id        uuid REFERENCES public.oauth_connections(id) ON DELETE SET NULL,
  google_calendar_id          uuid REFERENCES public.calendars(id) ON DELETE SET NULL,
  google_event_id             text,
  ical_uid                    text,
  google_event_deleted_at     timestamptz,
  is_do_not_contact_at_booking boolean NOT NULL DEFAULT false,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  -- Calculada: el CASE es groupOf() de lib/scheduling/booking-status.ts.
  status_group                text GENERATED ALWAYS AS (
    CASE
      WHEN status IN ('scheduled', 'confirmed', 'rescheduled') THEN 'active'
      WHEN status = 'no_show' THEN 'no_show'
      WHEN status IN ('followup_warm', 'followup_cold', 'sale', 'not_qualified') THEN 'outcome'
      ELSE 'cancelled'
    END
  ) STORED
);

COMMENT ON TABLE public.bookings IS
  'Una fila por reunion agendada. No se borran: cancelar es un estado. El historial vive en audit_log con entity_type = booking.';
COMMENT ON COLUMN public.bookings.uid IS
  'Token publico de 22 caracteres (unos 131 bits): con el se cancela y se reagenda sin sesion. Nunca se le entrega al agente de IA.';
COMMENT ON COLUMN public.bookings.status_group IS
  'Calculada desde status. active / no_show / outcome / cancelled. Solo las active ocupan el horario.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_status_check') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check CHECK (status IN (
      'scheduled', 'confirmed', 'rescheduled',
      'no_show',
      'followup_warm', 'followup_cold', 'sale', 'not_qualified',
      'cancelled_not_qualified', 'cancelled_no_response', 'cancelled_other'
    ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_origin_check') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_origin_check
      CHECK (origin IN ('public_page', 'embed', 'manual', 'agent', 'api'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_cancelled_by_check') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_cancelled_by_check
      CHECK (cancelled_by_type IS NULL OR cancelled_by_type IN ('invitee', 'host', 'system'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_sync_status_check') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_sync_status_check
      CHECK (google_sync_status IN ('pending', 'synced', 'failed', 'not_applicable'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_range_check') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_range_check CHECK (end_at > start_at);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_uid ON public.bookings (uid);
CREATE INDEX IF NOT EXISTS idx_bookings_ws_start ON public.bookings (workspace_id, start_at);
CREATE INDEX IF NOT EXISTS idx_bookings_ws_category_start ON public.bookings (workspace_id, category_id, start_at);
CREATE INDEX IF NOT EXISTS idx_bookings_host_start ON public.bookings (host_user_id, start_at);
CREATE INDEX IF NOT EXISTS idx_bookings_contact_start ON public.bookings (contact_id, start_at);
CREATE INDEX IF NOT EXISTS idx_bookings_ws_status_start ON public.bookings (workspace_id, status, start_at);
CREATE INDEX IF NOT EXISTS idx_bookings_event_start ON public.bookings (event_type_id, start_at);

-- La proteccion de verdad contra la doble reserva: dos agendas ACTIVAS del
-- mismo anfitrion no pueden superponerse. El advisory lock de create_booking
-- evita el reintento perdido; esto evita la carrera.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_overlap') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_no_overlap
      EXCLUDE USING gist (
        host_user_id WITH =,
        tstzrange(start_at, end_at) WITH &&
      ) WHERE (status IN ('scheduled', 'confirmed', 'rescheduled'));
  END IF;
END $$;

DROP TRIGGER IF EXISTS set_updated_at ON public.bookings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 2. can_see_booking
-- ------------------------------------------------------------
-- Owner o Admin; o `bookings.view` con alcance `all`; o es el anfitrion.
-- Para el rol Member de sistema, has_permission da false (sus permisos viven
-- en TypeScript) y cae al tercer caso, que es justo su alcance `own`.

CREATE OR REPLACE FUNCTION public.can_see_booking(b public.bookings)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_workspace_member(b.workspace_id)
     AND (
       public.is_workspace_admin(b.workspace_id)
       OR b.host_user_id = auth.uid()
       OR (
         public.has_permission(b.workspace_id, 'bookings.view')
         AND public.permission_scope(b.workspace_id, 'bookings') = 'all'
       )
     );
$$;

REVOKE ALL ON FUNCTION public.can_see_booking(public.bookings) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_booking(public.bookings) TO authenticated, service_role;

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Solo lectura para los usuarios: escribir es del servidor (las acciones ya
-- verifican el permiso). Sin DELETE: las agendas no se borran.
DROP POLICY IF EXISTS "bookings_select" ON public.bookings;
CREATE POLICY "bookings_select" ON public.bookings
  FOR SELECT USING (public.can_see_booking(bookings));

-- ------------------------------------------------------------
-- 3. audit_log: el historial de la agenda
-- ------------------------------------------------------------
-- Se copia la politica vigente (00068) y se suma una rama: las filas de
-- entity_type = 'booking' las ve quien ve la agenda.

DROP POLICY IF EXISTS "audit_log_select" ON public.audit_log;
CREATE POLICY "audit_log_select" ON public.audit_log
  FOR SELECT TO authenticated
  USING (
    public.is_workspace_admin(workspace_id)
    OR (public.is_workspace_member(workspace_id) AND performed_by = auth.uid())
    OR (
      public.is_workspace_member(workspace_id)
      AND performed_by_agent_id IS NOT NULL
      AND (
        (entity_type = 'contact' AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = audit_log.entity_id))
        OR (entity_type = 'conversation' AND EXISTS (SELECT 1 FROM public.conversations cv WHERE cv.id = audit_log.entity_id))
      )
    )
    -- Etapa 4: el historial de una agenda lo ve quien ve la agenda.
    OR (
      public.is_workspace_member(workspace_id)
      AND entity_type = 'booking'
      AND EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = audit_log.entity_id)
    )
  );

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON public.audit_log (entity_type, entity_id, performed_at DESC);

-- ------------------------------------------------------------
-- 4. rate_limits
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rate_limits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- prefijo del modulo + accion + hash de IP: "scheduling:create:<sha256>".
  key          text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.rate_limits IS
  'Tope por IP de los endpoints publicos. La IP va como hash con sal, nunca en texto. Se purga a las 24 h.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_rate_limits_key_window ON public.rate_limits (key, window_start);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON public.rate_limits (window_start);

-- Sin policies: solo el service role entra.
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

/** Suma uno y devuelve cuantos van en la ventana. Solo service role. */
CREATE OR REPLACE FUNCTION public.bump_rate_limit(p_key text, p_window_start timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_count integer;
BEGIN
  INSERT INTO public.rate_limits (key, window_start, count)
  VALUES (p_key, p_window_start, 1)
  ON CONFLICT (key, window_start) DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_rate_limit(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_rate_limit(text, timestamptz) TO service_role;

/** Purga lo que ya no sirve (24 h). La llama el cron diario. */
CREATE OR REPLACE FUNCTION public.purge_rate_limits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v integer;
BEGIN
  DELETE FROM public.rate_limits WHERE window_start < now() - interval '24 hours';
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_rate_limits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_rate_limits() TO service_role;

-- ------------------------------------------------------------
-- 5. scheduled_jobs: estado `cancelled` e indice por agenda
-- ------------------------------------------------------------
-- Aditivo: se suma un valor al CHECK. El runner solo toma `pending`, asi que
-- un job `cancelled` queda fuera sin tocar nada mas.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_jobs_status_check') THEN
    ALTER TABLE public.scheduled_jobs DROP CONSTRAINT scheduled_jobs_status_check;
  END IF;
  ALTER TABLE public.scheduled_jobs ADD CONSTRAINT scheduled_jobs_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled'));
END $$;

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_booking
  ON public.scheduled_jobs ((payload->>'booking_id'))
  WHERE payload ? 'booking_id';

-- ------------------------------------------------------------
-- 6. create_booking
-- ------------------------------------------------------------
-- Una sola transaccion: contacto, asignacion, agenda, historial, evento de
-- automatizacion y jobs. El advisory lock serializa los pedidos del mismo
-- anfitrion; la exclusion es la garantia final.
--
-- La deduplicacion reproduce la prioridad de find_or_link_contact (telefono,
-- despues email) sin exigir un canal: una reserva publica no viene de uno.

CREATE OR REPLACE FUNCTION public.create_booking(
  p_workspace_id   uuid,
  p_event_type_id  uuid,
  p_host_user_id   uuid,
  p_start_at       timestamptz,
  p_end_at         timestamptz,
  p_title          text,
  p_name           text,
  p_email          text,
  p_phone          text,
  p_timezone       text,
  p_host_timezone  text,
  p_location_type  text,
  p_location_text  text,
  p_responses      jsonb,
  p_origin         text,
  p_utm            jsonb,
  p_referrer_url   text,
  p_uid            text,
  p_category_id    uuid,
  p_category_snapshot jsonb,
  p_contact_assignment text,
  p_created_by     uuid DEFAULT NULL,
  p_contact_id     uuid DEFAULT NULL,
  p_metadata       jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact_id   uuid := p_contact_id;
  v_created      boolean := false;
  v_booking_id   uuid;
  v_email        text := nullif(btrim(lower(p_email)), '');
  v_phone        text := nullif(btrim(p_phone), '');
  v_dnc          boolean := false;
  v_setter       uuid;
  v_vendedor     uuid;
  v_assigned     boolean := false;
BEGIN
  -- Serializa los pedidos del mismo anfitrion dentro de la transaccion.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_host_user_id::text, 0));

  -- a. El contacto. Si viene dado (agendar manual, agente), se usa tal cual.
  IF v_contact_id IS NULL THEN
    IF v_phone IS NOT NULL THEN
      SELECT id INTO v_contact_id FROM public.contacts
      WHERE workspace_id = p_workspace_id AND deleted_at IS NULL
        AND (phone = v_phone OR whatsapp_phone = v_phone)
      ORDER BY created_at ASC LIMIT 1;
    END IF;

    IF v_contact_id IS NULL AND v_email IS NOT NULL THEN
      SELECT id INTO v_contact_id FROM public.contacts
      WHERE workspace_id = p_workspace_id AND deleted_at IS NULL
        AND (lower(email) = v_email OR lower(secondary_email) = v_email)
      ORDER BY created_at ASC LIMIT 1;
    END IF;

    IF v_contact_id IS NULL THEN
      INSERT INTO public.contacts (workspace_id, display_name, email, phone, timezone, attribution, last_interaction_at)
      VALUES (
        p_workspace_id,
        nullif(btrim(p_name), ''),
        v_email,
        v_phone,
        nullif(p_timezone, ''),
        coalesce(p_utm, '{}'::jsonb) || jsonb_build_object('source', 'scheduling', 'referrer', p_referrer_url),
        now()
      )
      RETURNING id INTO v_contact_id;
      v_created := true;
    END IF;
  END IF;

  -- Completa SOLO los campos vacios: nunca pisa lo que ya hay.
  IF NOT v_created THEN
    UPDATE public.contacts
    SET display_name = coalesce(display_name, nullif(btrim(p_name), '')),
        email        = coalesce(email, v_email),
        phone        = coalesce(phone, v_phone),
        timezone     = coalesce(timezone, nullif(p_timezone, '')),
        last_interaction_at = now()
    WHERE id = v_contact_id;
  END IF;

  SELECT do_not_contact, setter_id, vendedor_id INTO v_dnc, v_setter, v_vendedor
  FROM public.contacts WHERE id = v_contact_id;

  -- b. La asignacion (F22): solo si el campo esta vacio. El UPDATE dispara el
  -- trigger de la 00039, que emite assignment_changed en automation_events.
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
$$;

REVOKE ALL ON FUNCTION public.create_booking(uuid, uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, text, text, jsonb, text, jsonb, text, text, uuid, jsonb, text, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking(uuid, uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, text, text, jsonb, text, jsonb, text, text, uuid, jsonb, text, uuid, uuid, jsonb) TO service_role;
