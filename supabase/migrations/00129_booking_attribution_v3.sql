-- 00129: atribucion v3 de agendas (Agenda v2).
--
-- Aditiva. Dos arreglos sobre `create_booking` (hoy, la de la 00115) y dos
-- piezas nuevas de solo lectura para el widget de filtros.
--
-- 1. `create_booking` es la de la 00115 LETRA POR LETRA, con tres cambios:
--    a. El toque de atribucion NO se registra cuando `p_origin` es 'manual'
--       o 'agent': ahi no se sabe de donde vino el lead (si lo agenda el
--       equipo a mano o el agente, el toque real ya lo tiene el DM o el
--       comentario que lo trajo), y el toque falso `web/booking` pisaba ese
--       toque real en `contacts.attribution.last_touch`.
--    b. Se suman `ttclid`, `li_fat_id` (ya en `contact_touches` desde la
--       00114, pero nada los escribia) y `landing_page` (la pagina donde
--       vivia el formulario o el embed, nueva: `p_landing_page`).
--    c. `p_landing_page text DEFAULT NULL`: parametro nuevo al final, con
--       default. PostgREST llama a las funciones por nombre (no por
--       posicion), asi que esto no rompe ninguna llamada existente.
--    La definicion anterior (00115) esta completa en el comentario de abajo
--    por si hace falta volver atras.
-- 2. Un indice por fuente y por campana del UTM de la agenda, para que el
--    filtro "UTM" de Agenda no escanee toda la tabla.
-- 3. `booking_utm_options`: los valores de fuente/medio/campana que de verdad
--    existen en el workspace, para las opciones del filtro. SECURITY INVOKER
--    (no DEFINER): lee `bookings` con el cliente de quien llama, así que
--    respeta el mismo alcance que ya aplica `bookings_select`.
--
-- Definicion anterior completa (00115_attribution_v2_and_backfill.sql),
-- por si hace falta volver atras:
--
-- CREATE OR REPLACE FUNCTION public.create_booking(
--   p_workspace_id   uuid,
--   p_event_type_id  uuid,
--   p_host_user_id   uuid,
--   p_start_at       timestamptz,
--   p_end_at         timestamptz,
--   p_title          text,
--   p_name           text,
--   p_email          text,
--   p_phone          text,
--   p_timezone       text,
--   p_host_timezone  text,
--   p_location_type  text,
--   p_location_text  text,
--   p_responses      jsonb,
--   p_origin         text,
--   p_utm            jsonb,
--   p_referrer_url   text,
--   p_uid            text,
--   p_category_id    uuid,
--   p_category_snapshot jsonb,
--   p_contact_assignment text,
--   p_created_by     uuid DEFAULT NULL,
--   p_contact_id     uuid DEFAULT NULL,
--   p_metadata       jsonb DEFAULT '{}'::jsonb
-- )
-- RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
-- [...] (el cuerpo entero, igual al de abajo salvo por el bloque "c2" del
-- toque, que ahi SIEMPRE lo registraba y no llevaba ttclid/li_fat_id/landing_page)
-- $$;

-- ---------------------------------------------------------------------------
-- 1. create_booking: la de la 00115 + el filtro por origen + los campos nuevos
-- ---------------------------------------------------------------------------
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
  p_metadata       jsonb DEFAULT '{}'::jsonb,
  p_landing_page   text DEFAULT NULL
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

  -- c2. El toque de atribucion (Contenido v3, F87; Agenda v2). Vale para el
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
          'referrer_url', nullif(btrim(p_referrer_url), ''),
          'landing_page', nullif(btrim(p_landing_page), ''),
          'origin',       'booking',
          'dedupe_key',   'booking:' || v_booking_id::text,
          'raw',          jsonb_build_object('utm', coalesce(p_utm, '{}'::jsonb), 'booking_origin', p_origin)
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
$$;

REVOKE ALL ON FUNCTION public.create_booking(uuid, uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, text, text, jsonb, text, jsonb, text, text, uuid, jsonb, text, uuid, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking(uuid, uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, text, text, jsonb, text, jsonb, text, text, uuid, jsonb, text, uuid, uuid, jsonb, text) TO service_role;

-- La firma vieja (sin `p_landing_page`) queda huerfana: Postgres no permite
-- dos funciones con el mismo nombre y la misma lista de tipos, pero esta es
-- una lista distinta (24 tipos contra 25), asi que la de la 00115 sigue
-- existiendo como una sobrecarga separada. Se borra para que nadie la llame
-- sin querer desde una conexion vieja en caliente.
DROP FUNCTION IF EXISTS public.create_booking(uuid, uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, text, text, jsonb, text, jsonb, text, text, uuid, jsonb, text, uuid, uuid, jsonb);

-- ---------------------------------------------------------------------------
-- 2. Indices para el filtro "UTM" de Agenda
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_bookings_utm_source
  ON public.bookings (workspace_id, (utm ->> 'utm_source'), start_at);
CREATE INDEX IF NOT EXISTS idx_bookings_utm_campaign
  ON public.bookings (workspace_id, (utm ->> 'utm_campaign'), start_at);

-- ---------------------------------------------------------------------------
-- 3. Las opciones del filtro UTM: SECURITY INVOKER, respeta `bookings_select`
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_utm_options(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'sources',   coalesce((SELECT jsonb_agg(DISTINCT v ORDER BY v) FROM public.bookings b, lateral (SELECT b.utm ->> 'utm_source' AS v) s WHERE b.workspace_id = p_workspace_id AND s.v IS NOT NULL), '[]'::jsonb),
    'mediums',   coalesce((SELECT jsonb_agg(DISTINCT v ORDER BY v) FROM public.bookings b, lateral (SELECT b.utm ->> 'utm_medium' AS v) s WHERE b.workspace_id = p_workspace_id AND s.v IS NOT NULL), '[]'::jsonb),
    'campaigns', coalesce((SELECT jsonb_agg(DISTINCT v ORDER BY v) FROM public.bookings b, lateral (SELECT b.utm ->> 'utm_campaign' AS v) s WHERE b.workspace_id = p_workspace_id AND s.v IS NOT NULL), '[]'::jsonb)
  )
$$;

REVOKE ALL ON FUNCTION public.booking_utm_options(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_utm_options(uuid) TO authenticated, service_role;
