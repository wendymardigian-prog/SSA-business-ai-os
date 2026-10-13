-- ============================================================================
-- 00190 — create_booking pasa ad_id, adset_id, campaign_id y los extras al toque  (M5 del Extra L)
-- ============================================================================
-- Hoy cada agenda que llega desde un anuncio PIERDE el dato del anuncio, y eso no se recupera: el toque
-- que anota create_booking solo lleva las UTMs y los ids de clic. Esta migracion reescribe la funcion
-- copiando la version VIGENTE letra por letra (pg_get_functiondef de la base viva, md5
-- b81db84edb30ee7853efa2d42385593a, 25 parametros) y cambia SOLO el bloque que arma el toque:
--
--   - al toque: 'ad_id', 'adset_id' y 'campaign_id' (de p_utm);
--   - en raw: utm_id, placement, fbp, fbc, ga_client_id y first_visit (si vinieron).
--
-- Todo lo demas queda igual: la firma (25 parametros), la exclusion de manual / agent, el EXCEPTION que
-- impide que una falla de atribucion tumbe la reserva, la auditoria, el evento y los jobs. El codigo viejo
-- llama con la misma firma, asi que esta migracion es compatible con el.
--
-- La referencia de huella de scripts/verify-forms.impl.ts se actualiza en el MISMO commit.
--
-- Como volver atras: recrear la funcion con la definicion vieja, copiada completa abajo.
-- Riesgo: ALTO (es la funcion de cada agenda), por eso la copia es exacta y se corren verify-scheduling,
-- verify-booking-concurrency, verify-forms y verify-sales antes y despues.
--
-- Definicion VIEJA (la de la base viva el 13/10/2026):
-- CREATE OR REPLACE FUNCTION public.create_booking(p_workspace_id uuid, p_event_type_id uuid, p_host_user_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_title text, p_name text, p_email text, p_phone text, p_timezone text, p_host_timezone text, p_location_type text, p_location_text text, p_responses jsonb, p_origin text, p_utm jsonb, p_referrer_url text, p_uid text, p_category_id uuid, p_category_snapshot jsonb, p_contact_assignment text, p_created_by uuid DEFAULT NULL::uuid, p_contact_id uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT '{}'::jsonb, p_landing_page text DEFAULT NULL::text)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO ''
-- AS $function$
-- DECLARE
--   v_contact_id   uuid := p_contact_id;
--   v_created      boolean := false;
--   v_booking_id   uuid;
--   v_email        text := nullif(btrim(lower(p_email)), '');
--   v_phone        text := nullif(btrim(p_phone), '');
--   v_dnc          boolean := false;
--   v_setter       uuid;
--   v_vendedor     uuid;
--   v_assigned     boolean := false;
-- BEGIN
--   -- Serializa los pedidos del mismo anfitrion dentro de la transaccion.
--   PERFORM pg_advisory_xact_lock(hashtextextended(p_host_user_id::text, 0));
--
--   -- a. El contacto. Si viene dado (agendar manual, agente), se usa tal cual.
--   IF v_contact_id IS NULL THEN
--     IF v_phone IS NOT NULL THEN
--       SELECT id INTO v_contact_id FROM public.contacts
--       WHERE workspace_id = p_workspace_id AND deleted_at IS NULL
--         AND (phone = v_phone OR whatsapp_phone = v_phone)
--       ORDER BY created_at ASC LIMIT 1;
--     END IF;
--
--     IF v_contact_id IS NULL AND v_email IS NOT NULL THEN
--       SELECT id INTO v_contact_id FROM public.contacts
--       WHERE workspace_id = p_workspace_id AND deleted_at IS NULL
--         AND (lower(email) = v_email OR lower(secondary_email) = v_email)
--       ORDER BY created_at ASC LIMIT 1;
--     END IF;
--
--     IF v_contact_id IS NULL THEN
--       INSERT INTO public.contacts (workspace_id, display_name, email, phone, timezone, attribution, last_interaction_at)
--       VALUES (
--         p_workspace_id,
--         nullif(btrim(p_name), ''),
--         v_email,
--         v_phone,
--         nullif(p_timezone, ''),
--         coalesce(p_utm, '{}'::jsonb) || jsonb_build_object('source', 'scheduling', 'referrer', p_referrer_url),
--         now()
--       )
--       RETURNING id INTO v_contact_id;
--       v_created := true;
--     END IF;
--   END IF;
--
--   -- Completa SOLO los campos vacios: nunca pisa lo que ya hay.
--   IF NOT v_created THEN
--     UPDATE public.contacts
--     SET display_name = coalesce(display_name, nullif(btrim(p_name), '')),
--         email        = coalesce(email, v_email),
--         phone        = coalesce(phone, v_phone),
--         timezone     = coalesce(timezone, nullif(p_timezone, '')),
--         last_interaction_at = now()
--     WHERE id = v_contact_id;
--   END IF;
--
--   SELECT do_not_contact, setter_id, vendedor_id INTO v_dnc, v_setter, v_vendedor
--   FROM public.contacts WHERE id = v_contact_id;
--
--   -- b. La asignacion (F22): solo si el campo esta vacio. El UPDATE dispara el
--   -- trigger de la 00039, que emite assignment_changed en automation_events.
--   IF p_contact_assignment = 'setter_if_empty' AND v_setter IS NULL THEN
--     UPDATE public.contacts SET setter_id = p_host_user_id WHERE id = v_contact_id;
--     v_assigned := true;
--   ELSIF p_contact_assignment = 'vendedor_if_empty' AND v_vendedor IS NULL THEN
--     UPDATE public.contacts SET vendedor_id = p_host_user_id WHERE id = v_contact_id;
--     v_assigned := true;
--   END IF;
--
--   -- c. La agenda.
--   INSERT INTO public.bookings (
--     workspace_id, uid, event_type_id, category_id, category_snapshot, metadata,
--     host_user_id, contact_id, title, start_at, end_at, status,
--     booker_name, booker_email, booker_phone, booker_timezone, host_timezone,
--     location_type, location_text, responses, origin, utm, referrer_url,
--     created_by, is_do_not_contact_at_booking, google_sync_status
--   ) VALUES (
--     p_workspace_id, p_uid, p_event_type_id, p_category_id, p_category_snapshot, coalesce(p_metadata, '{}'::jsonb),
--     p_host_user_id, v_contact_id, p_title, p_start_at, p_end_at, 'scheduled',
--     nullif(btrim(p_name), ''), v_email, v_phone, nullif(p_timezone, ''), nullif(p_host_timezone, ''),
--     p_location_type, p_location_text, coalesce(p_responses, '{}'::jsonb), p_origin,
--     coalesce(p_utm, '{}'::jsonb), p_referrer_url,
--     p_created_by, coalesce(v_dnc, false), 'pending'
--   )
--   RETURNING id INTO v_booking_id;
--
--   -- c2. El toque de atribucion (Contenido v3, F87; Agenda v2). Vale para el
--   -- contacto nuevo Y para el que ya existia: una reserva es una interaccion
--   -- mas de esa persona. NO se registra para 'manual' ni 'agent': ahi no hay
--   -- forma de saber de donde vino el lead, y un toque `web/booking` inventado
--   -- pisaria el toque real (el DM o el comentario que lo trajo).
--   -- Va protegido: una falla de atribucion NUNCA puede impedir una reserva.
--   IF p_origin NOT IN ('manual', 'agent') THEN
--     BEGIN
--       PERFORM public.record_contact_touch(
--         p_workspace_id,
--         v_contact_id,
--         jsonb_build_object(
--           'occurred_at',  now(),
--           'source',       coalesce(nullif(lower(btrim(p_utm->>'utm_source')), ''), 'web'),
--           'medium',       'booking',
--           'campaign',     nullif(btrim(p_utm->>'utm_campaign'), ''),
--           'content',      nullif(btrim(p_utm->>'utm_content'), ''),
--           'term',         nullif(btrim(p_utm->>'utm_term'), ''),
--           'fbclid',       nullif(btrim(p_utm->>'fbclid'), ''),
--           'gclid',        nullif(btrim(p_utm->>'gclid'), ''),
--           'ttclid',       nullif(btrim(p_utm->>'ttclid'), ''),
--           'li_fat_id',    nullif(btrim(p_utm->>'li_fat_id'), ''),
--           'referrer_url', nullif(btrim(p_referrer_url), ''),
--           'landing_page', nullif(btrim(p_landing_page), ''),
--           'origin',       'booking',
--           'dedupe_key',   'booking:' || v_booking_id::text,
--           'raw',          jsonb_build_object('utm', coalesce(p_utm, '{}'::jsonb), 'booking_origin', p_origin)
--         )
--       );
--     EXCEPTION WHEN OTHERS THEN
--       RAISE WARNING 'create_booking: no pude registrar el toque de atribucion: %', SQLERRM;
--     END;
--   END IF;
--
--   -- d. El historial.
--   INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
--   VALUES (
--     p_workspace_id, 'booking', v_booking_id, 'booking.created',
--     jsonb_build_object('start_at', p_start_at, 'end_at', p_end_at),
--     jsonb_build_object('origin', p_origin, 'actor_type', CASE WHEN p_created_by IS NULL THEN 'invitee' ELSE 'user' END),
--     p_created_by
--   );
--
--   -- e. El evento de automatizacion.
--   INSERT INTO public.automation_events (workspace_id, event_type, contact_id, payload)
--   VALUES (
--     p_workspace_id, 'booking_created', v_contact_id,
--     jsonb_build_object(
--       'booking_id', v_booking_id,
--       'event_type_id', p_event_type_id,
--       'host_user_id', p_host_user_id,
--       'origin', p_origin
--     )
--   );
--
--   -- f. Los jobs: crear el evento en Google y avisar cuando la agenda termine.
--   INSERT INTO public.scheduled_jobs (type, payload, run_at, status)
--   VALUES (
--     'booking_google_sync',
--     jsonb_build_object('booking_id', v_booking_id, 'action', 'create', 'attempt', 0),
--     now(), 'pending'
--   );
--   INSERT INTO public.scheduled_jobs (type, payload, run_at, status, dedupe_key)
--   VALUES (
--     'booking_ended',
--     jsonb_build_object('booking_id', v_booking_id),
--     p_end_at, 'pending', 'ended:' || v_booking_id::text || ':0'
--   );
--
--   RETURN jsonb_build_object(
--     'booking_id', v_booking_id,
--     'contact_id', v_contact_id,
--     'created_contact', v_created,
--     'assignment_changed', v_assigned,
--     'do_not_contact', coalesce(v_dnc, false)
--   );
-- END;
-- $function$
-- ============================================================================

SET search_path = '';

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
